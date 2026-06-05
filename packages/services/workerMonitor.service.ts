import { injectable, inject } from 'tsyringe';
import { WorkerService } from './worker.service';
import { ServerService } from './server.service';
import { SshService } from './ssh.service';
import { PasswordEncryptorService } from './passwordEncryptor.service';
import { IBalanceMonitorServer } from '@core/common/interfaces/IBalanceMonitorServer';
import { ConnectConfig } from 'ssh2';
import { IWorkerMonitor } from '@core/common/interfaces/IWorkerMonitor';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { CentrifugoService } from './centrifugo.service';
import { WorkerGrpcClientService } from './workerGrpcClient.service';
import {
  channelsConfigCentrifugo,
  workerCentrifugoQueue,
} from '@core/common/functions/centrifugoQueue';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { AccountService } from './account.service';
import { IPlanAccountStatus } from '@core/common/interfaces/IPlanAccountStatus';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { IConnectionFailureTracker } from '@core/common/interfaces/IConnectionFailureTracker';

const mapConcurrent = async <T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let index = 0;

  const worker = async (): Promise<void> => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
};

interface IRunningWorkerContainer {
  name: string;
  isWarmStandby: boolean;
  warmPoolId?: string;
}

@injectable()
export class WorkerMonitorService {
  private readonly timeoutMinutes = 5;
  private readonly maxConnectionFailures = 3;
  private readonly sshConcurrencyPerServer = 5;
  private readonly serverConcurrency = 2;
  private readonly connectionCheckIntervalMs = 60 * 1000;
  private readonly stoppedTimeoutMinutes = 24 * 60;
  private readonly connectionFailureTrackers = new Map<
    string,
    IConnectionFailureTracker
  >();
  private readonly activeContinuousChecks = new Set<string>();

  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(ServerService)
    private readonly serverService: ServerService,
    @inject(SshService)
    private readonly sshService: SshService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(WorkerGrpcClientService)
    private readonly workerGrpcClientService: WorkerGrpcClientService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(AccountService)
    private readonly accountService: AccountService
  ) {}

  run = async (): Promise<void> => {
    const servers = await this.serverService.listBalanceServers();
    const workers = await this.workerService.listWorkersForMonitor();

    if (!servers.length) {
      return;
    }

    const workersById = new Map<string, IWorkerMonitor>(
      workers.map((worker) => [worker.worker_id, worker])
    );

    const workersByServer = new Map<string, IWorkerMonitor[]>();
    for (const worker of workers) {
      const list = workersByServer.get(worker.server_id) ?? [];
      list.push(worker);
      workersByServer.set(worker.server_id, list);
    }

    await mapConcurrent(servers, this.serverConcurrency, (server) =>
      this.checkServer(server, workersById, workersByServer)
    );
  };

  private readonly checkServer = async (
    server: IBalanceMonitorServer,
    workersById: Map<string, IWorkerMonitor>,
    workersByServer: Map<string, IWorkerMonitor[]>
  ): Promise<void> => {
    const sshConfig = this.buildSshConfig(server);
    const containers = await this.listContainers(server.server_id, sshConfig);

    const workerIds = containers.filter(
      (name) => name && name !== 'under-balance-api'
    );
    const setContainers = new Set(workerIds);

    const serverWorkers = workersByServer.get(server.server_id) ?? [];
    const missingWorkers = serverWorkers.filter(
      (worker) => !setContainers.has(worker.worker_id)
    );

    const allItems = [
      ...workerIds.map(
        (workerId) => () =>
          this.processContainer(workerId, server, sshConfig, workersById)
      ),
      ...missingWorkers.map(
        (worker) => () => this.handleMissingContainer(worker, server, sshConfig)
      ),
    ];
    if (!allItems.length) {
      return;
    }

    await mapConcurrent(allItems, this.sshConcurrencyPerServer, (fn) => fn());
  };

  private readonly processContainer = async (
    workerId: string,
    server: IBalanceMonitorServer,
    sshConfig: ConnectConfig,
    workersById: Map<string, IWorkerMonitor>
  ): Promise<void> => {
    const worker = workersById.get(workerId);

    if (!worker) {
      await this.removeContainer(workerId, server.server_id, sshConfig);
      return;
    }

    if (this.shouldStopDueToInactivity(worker)) {
      await this.handleStop(worker, server, sshConfig);
      return;
    }

    await this.workerService.updateWorkerUpdatedAt(workerId);

    if (worker.deleted_at) {
      await this.removeContainer(workerId, server.server_id, sshConfig);
      return;
    }

    const planStatus = await this.accountService.viewPlanStatus(
      worker.account_id
    );
    const planCancelled = this.isPlanCancelled(planStatus);
    if (planCancelled) {
      await this.removeContainer(workerId, server.server_id, sshConfig);
      await this.removeStorage(workerId, server.server_id, sshConfig);
      return;
    }

    if (this.isDeletingTimeout(worker)) {
      await this.handleDeleting(worker, server, sshConfig);
      return;
    }

    if (this.isStuck(worker)) {
      await this.handleRecreate(worker, server);
      return;
    }

    if (worker.worker_status_id === EWorkerStatus.error) {
      await this.handleRecreate(worker, server);
      return;
    }

    const checkFastify = this.shouldCheckFastify(worker);
    if (checkFastify) {
      const healthy = await this.checkFastify(
        workerId,
        server.server_id,
        sshConfig
      );

      if (!healthy) {
        await this.handleRecreate(worker, server);
        return;
      }
    }

    const checkConnection = this.shouldCheckConnection(worker);

    if (!checkConnection) {
      return;
    }

    const connectionHealthy = await this.checkConnection(
      workerId,
      server.server_id,
      sshConfig
    );

    await this.syncConnectionStatusWithFailureTracking(
      worker,
      connectionHealthy,
      server.server_id,
      sshConfig
    );
  };

  private readonly handleMissingContainer = async (
    worker: IWorkerMonitor,
    server: IBalanceMonitorServer,
    sshConfig: ConnectConfig
  ): Promise<void> => {
    await this.workerService.updateWorkerUpdatedAt(worker.worker_id);

    if (worker.deleted_at) {
      return;
    }

    const planStatus = await this.accountService.viewPlanStatus(
      worker.account_id
    );
    const planCancelled = this.isPlanCancelled(planStatus);
    if (planCancelled) {
      await this.removeStorage(worker.worker_id, server.server_id, sshConfig);
      return;
    }

    const isDeleting = worker.worker_status_id === EWorkerStatus.deleting;
    if (isDeleting) {
      const timeout = this.isDeletingTimeout(worker);
      if (timeout) {
        await this.handleDeleting(worker, server, sshConfig);
      }
      return;
    }

    const isNotOnlineStatus =
      worker.worker_status_id === EWorkerStatus.offline ||
      worker.worker_status_id === EWorkerStatus.mismatched ||
      worker.worker_status_id === EWorkerStatus.disponible;
    if (isNotOnlineStatus) {
      if (this.shouldStopDueToInactivity(worker)) {
        await this.applyStoppedStatus(worker);
      }
      return;
    }

    const isError = worker.worker_status_id === EWorkerStatus.error;
    if (isError) {
      await this.handleRecreate(worker, server);
      return;
    }

    const stuck = this.isStuck(worker);
    const provisioning = this.isProvisioning(worker);
    if (provisioning && !stuck) {
      return;
    }

    await this.handleRecreate(worker, server);
  };

  private readonly handleDeleting = async (
    worker: IWorkerMonitor,
    server: IBalanceMonitorServer,
    sshConfig: ConnectConfig
  ): Promise<void> => {
    await this.removeContainer(worker.worker_id, server.server_id, sshConfig);
    await this.workerService.deleteWorkerById(
      worker.account_id,
      worker.worker_id
    );
    await this.workerService.updateStatusWorker(
      worker.worker_id,
      EWorkerStatus.delete
    );

    const payload: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: worker.worker_id,
      account_id: worker.account_id,
      worker_status_id: EWorkerStatus.delete,
    };

    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(worker.account_id),
      payload
    );
  };

  private readonly handleStop = async (
    worker: IWorkerMonitor,
    server: IBalanceMonitorServer,
    sshConfig: ConnectConfig
  ): Promise<void> => {
    await this.removeContainer(worker.worker_id, server.server_id, sshConfig);
    await this.applyStoppedStatus(worker);
  };

  private readonly handleRecreate = async (
    worker: IWorkerMonitor,
    server: IBalanceMonitorServer
  ): Promise<void> => {
    const payload: IWorkerPayload = {
      action: EWorkerAction.recreate,
      worker_id: worker.worker_id,
      server_id: server.server_id,
      account_id: worker.account_id,
      worker_status_id: EWorkerStatus.recreating,
    };

    await this.workerService.updateStatusWorker(
      worker.worker_id,
      EWorkerStatus.recreating
    );

    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(worker.account_id),
      payload
    );

    await this.centrifugoService.publish(channelsConfigCentrifugo(), payload);

    await this.workerGrpcClientService.recreateWorker(payload);
  };

  private readonly syncConnectionStatusWithFailureTracking = async (
    worker: IWorkerMonitor,
    connectionHealthy: boolean,
    serverId: string,
    sshConfig: ConnectConfig
  ): Promise<void> => {
    const now = Date.now();
    const tracker = this.connectionFailureTrackers.get(worker.worker_id);

    if (connectionHealthy) {
      if (tracker) {
        this.connectionFailureTrackers.delete(worker.worker_id);
      }

      await this.workerService.updateWorkerLastConnectionCheckAt(
        worker.worker_id
      );

      if (
        worker.worker_status_id === EWorkerStatus.offline ||
        worker.worker_status_id === EWorkerStatus.mismatched
      ) {
        await this.updateWorkerStatus(
          worker,
          EWorkerStatus.online,
          ECodeMessage.info,
          EBaileysConnectionStatus.info
        );
      }

      return;
    }

    if (!tracker) {
      this.connectionFailureTrackers.set(worker.worker_id, {
        failureCount: 1,
        lastCheckTimestamp: now,
      });

      if (!this.activeContinuousChecks.has(worker.worker_id)) {
        this.activeContinuousChecks.add(worker.worker_id);
        this.startContinuousConnectionCheck(
          worker,
          serverId,
          sshConfig
        ).finally(() => {
          this.activeContinuousChecks.delete(worker.worker_id);
        });
      }

      return;
    }

    const newFailureCount = tracker.failureCount + 1;
    this.connectionFailureTrackers.set(worker.worker_id, {
      failureCount: newFailureCount,
      lastCheckTimestamp: now,
    });

    if (newFailureCount >= this.maxConnectionFailures) {
      if (worker.worker_status_id !== EWorkerStatus.offline) {
        await this.updateWorkerStatus(
          worker,
          EWorkerStatus.offline,
          ECodeMessage.info,
          EBaileysConnectionStatus.info
        );
      }
    }
  };

  private readonly validateWorkerForCheck = (
    workerId: string,
    currentWorker: IWorkerMonitor | null
  ): currentWorker is IWorkerMonitor => {
    if (!currentWorker) {
      this.connectionFailureTrackers.delete(workerId);
      return false;
    }

    if (
      currentWorker.worker_status_id !== EWorkerStatus.online &&
      currentWorker.worker_status_id !== EWorkerStatus.offline &&
      currentWorker.worker_status_id !== EWorkerStatus.mismatched
    ) {
      this.connectionFailureTrackers.delete(workerId);
      return false;
    }

    return true;
  };

  private readonly handleHealthyConnection = async (
    workerId: string,
    currentWorker: IWorkerMonitor
  ): Promise<void> => {
    this.connectionFailureTrackers.delete(workerId);
    this.activeContinuousChecks.delete(workerId);

    await this.workerService.updateWorkerLastConnectionCheckAt(workerId);

    if (
      currentWorker.worker_status_id === EWorkerStatus.offline ||
      currentWorker.worker_status_id === EWorkerStatus.mismatched
    ) {
      await this.updateWorkerStatus(
        currentWorker,
        EWorkerStatus.online,
        ECodeMessage.info,
        EBaileysConnectionStatus.info
      );
    }
  };

  private readonly updateFailureTracker = (
    workerId: string,
    attempt: number
  ): void => {
    const updatedTracker = this.connectionFailureTrackers.get(workerId);
    if (updatedTracker) {
      updatedTracker.failureCount = attempt;
      updatedTracker.lastCheckTimestamp = Date.now();
      this.connectionFailureTrackers.set(workerId, updatedTracker);
    }
  };

  private readonly handleMaxFailuresReached = async (
    workerId: string,
    currentWorker: IWorkerMonitor
  ): Promise<void> => {
    this.activeContinuousChecks.delete(workerId);

    if (currentWorker.worker_status_id !== EWorkerStatus.offline) {
      await this.updateWorkerStatus(
        currentWorker,
        EWorkerStatus.offline,
        ECodeMessage.info,
        EBaileysConnectionStatus.info
      );
    }
  };

  private readonly startContinuousConnectionCheck = async (
    worker: IWorkerMonitor,
    serverId: string,
    sshConfig: ConnectConfig
  ): Promise<void> => {
    for (let attempt = 2; attempt <= this.maxConnectionFailures; attempt++) {
      await this.sleep(this.connectionCheckIntervalMs);

      const tracker = this.connectionFailureTrackers.get(worker.worker_id);
      if (!tracker) {
        return;
      }

      const currentWorker = await this.getCurrentWorkerStatus(worker.worker_id);
      if (!this.validateWorkerForCheck(worker.worker_id, currentWorker)) {
        return;
      }

      const connectionHealthy = await this.checkConnection(
        worker.worker_id,
        serverId,
        sshConfig
      );
      await this.workerService.updateWorkerUpdatedAt(worker.worker_id);

      if (connectionHealthy) {
        await this.handleHealthyConnection(worker.worker_id, currentWorker);
        return;
      }

      this.updateFailureTracker(worker.worker_id, attempt);

      if (attempt >= this.maxConnectionFailures) {
        await this.handleMaxFailuresReached(worker.worker_id, currentWorker);
      }
    }
  };

  private readonly getCurrentWorkerStatus = async (
    workerId: string
  ): Promise<IWorkerMonitor | null> => {
    const workers = await this.workerService.listWorkersForMonitor();
    const found = workers.find((w) => w.worker_id === workerId) || null;
    return found;
  };

  private readonly sleep = (ms: number): Promise<void> => {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };

  private readonly updateWorkerStatus = async (
    worker: IWorkerMonitor,
    status: EWorkerStatus,
    code: ECodeMessage,
    connectionStatus: EBaileysConnectionStatus
  ): Promise<void> => {
    await this.workerService.updateStatusWorker(worker.worker_id, status);

    const payload: IBaileysConnectionState = {
      code,
      status: connectionStatus,
      worker_id: worker.worker_id,
      account_id: worker.account_id,
      worker_status_id: status,
    };

    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(worker.account_id),
      payload
    );
  };

  private readonly buildSshConfig = (
    server: IBalanceMonitorServer
  ): ConnectConfig => ({
    host: server.ssh_ip,
    port: server.ssh_port,
    username: this.passwordEncryptorService.decrypt(server.ssh_username),
    password: this.passwordEncryptorService.decrypt(server.ssh_password),
  });

  private readonly parseRunningContainerLine = (
    line: string
  ): IRunningWorkerContainer | null => {
    const trimmed = line.trim();
    if (!trimmed) {
      return null;
    }

    const [rawName, rawWarmStandby, rawWarmPoolId] = trimmed.split('|');
    const name = rawName?.trim();
    if (!name) {
      return null;
    }

    const warmStandby = rawWarmStandby?.trim().toLowerCase() === 'true';
    const warmPoolId = rawWarmPoolId?.trim();
    const isWarmStandby =
      warmStandby || !!warmPoolId || name.startsWith('warm-');

    return {
      name,
      isWarmStandby,
      warmPoolId: warmPoolId || undefined,
    };
  };

  private readonly listContainers = async (
    serverId: string,
    sshConfig: ConnectConfig
  ): Promise<string[]> => {
    const command = `docker ps --format '{{.Names}}|{{.Label "underchat.warm_standby"}}|{{.Label "underchat.warm_pool_id"}}'`;
    const outputs = await this.sshService.runCommands(
      serverId,
      sshConfig,
      [command],
      false
    );

    const combined = outputs
      .map((item) => item.output)
      .join('\n')
      .trim();
    const list = combined
      .split('\n')
      .map((line) => this.parseRunningContainerLine(line))
      .filter(
        (container): container is IRunningWorkerContainer =>
          !!container && !container.isWarmStandby
      )
      .map((container) => container.name);
    const result = list.filter((name) => !!name);
    return result;
  };

  private readonly checkFastify = async (
    workerId: string,
    serverId: string,
    sshConfig: ConnectConfig
  ): Promise<boolean> => {
    const command = String.raw`bash -c "docker exec ${workerId} sh -c 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3005/v1/health/check'"`;

    const outputs = await this.sshService.runCommands(
      serverId,
      sshConfig,
      [command],
      false
    );

    const code = this.parseHttpCode(outputs.map((r) => r.output).join(''));
    const healthy = code === 200;
    return healthy;
  };

  private readonly checkConnection = async (
    workerId: string,
    serverId: string,
    sshConfig: ConnectConfig
  ): Promise<boolean> => {
    const command = String.raw`bash -c "docker exec ${workerId} sh -c 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3005/v1/connection/health/check'"`;

    try {
      const outputs = await this.sshService.runCommands(
        serverId,
        sshConfig,
        [command],
        false
      );

      const rawOutput = outputs.map((r) => r.output).join('');
      const code = this.parseHttpCode(rawOutput);
      const healthy = code === 200;
      return healthy;
    } catch {
      return false;
    }
  };

  private readonly parseHttpCode = (raw: string): number | null => {
    const trimmed = raw.trim();
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) {
      return null;
    }

    return numeric;
  };

  private readonly removeContainer = async (
    workerId: string,
    serverId: string,
    sshConfig: ConnectConfig
  ): Promise<void> => {
    const command = `docker rm -f ${workerId}`;

    await this.sshService.runCommands(serverId, sshConfig, [command], false);
  };

  private readonly removeStorage = async (
    workerId: string,
    serverId: string,
    sshConfig: ConnectConfig
  ): Promise<void> => {
    const command = `rm -rf /app/data/storage/${workerId}`;
    await this.sshService.runCommands(serverId, sshConfig, [command], false);
  };

  private readonly shouldCheckFastify = (worker: IWorkerMonitor): boolean => {
    const statuses = [
      EWorkerStatus.online,
      EWorkerStatus.offline,
      EWorkerStatus.disponible,
    ];

    const result = statuses.includes(worker.worker_status_id);
    return result;
  };

  private readonly shouldCheckConnection = (
    worker: IWorkerMonitor
  ): boolean => {
    const statuses = [
      EWorkerStatus.online,
      EWorkerStatus.offline,
      EWorkerStatus.mismatched,
    ];

    const result = statuses.includes(worker.worker_status_id);
    return result;
  };

  private readonly isProvisioning = (worker: IWorkerMonitor): boolean => {
    const statuses = [
      EWorkerStatus.new,
      EWorkerStatus.recreating,
      EWorkerStatus.creating,
    ];

    const result = statuses.includes(worker.worker_status_id);
    return result;
  };

  private readonly isStuck = (worker: IWorkerMonitor): boolean => {
    const statuses = [
      EWorkerStatus.new,
      EWorkerStatus.recreating,
      EWorkerStatus.creating,
    ];

    if (!statuses.includes(worker.worker_status_id)) {
      return false;
    }

    const result = this.isOlderThanTimeout(worker.updated_at);
    return result;
  };

  private readonly isDeletingTimeout = (worker: IWorkerMonitor): boolean => {
    if (worker.worker_status_id !== EWorkerStatus.deleting) {
      return false;
    }

    const result = this.isOlderThanTimeout(worker.updated_at);
    return result;
  };

  private readonly isPlanCancelled = (
    plan: IPlanAccountStatus | null
  ): boolean => {
    if (!plan) {
      return true;
    }

    const blocked = plan.account_status_id === EAccountStatus.blocked;
    if (blocked) {
      return true;
    }

    const nextPayment = plan.next_payment_date
      ? new Date(plan.next_payment_date)
      : null;
    const invalidDate = !nextPayment || Number.isNaN(nextPayment.getTime());
    if (invalidDate) {
      return true;
    }

    const expired = nextPayment.getTime() <= Date.now();
    if (expired) {
      return true;
    }

    const inactive = plan.account_status_id === EAccountStatus.inactive;
    if (inactive && plan.cancellation_date) {
      return true;
    }

    return false;
  };

  private readonly isOlderThanTimeout = (dateIso: string | null): boolean => {
    if (!dateIso) {
      return true;
    }

    const parsed = new Date(dateIso);
    if (Number.isNaN(parsed.getTime())) {
      return true;
    }

    const diff = Date.now() - parsed.getTime();
    const minutes = diff / 1000 / 60;
    const result = minutes > this.timeoutMinutes;
    return result;
  };

  private readonly isConnectionCheckTimeout = (
    worker: IWorkerMonitor
  ): boolean => {
    if (!worker.last_connection_check_at) {
      return false;
    }

    const parsed = new Date(worker.last_connection_check_at);
    if (Number.isNaN(parsed.getTime())) {
      return false;
    }

    const diff = Date.now() - parsed.getTime();
    const minutes = diff / 1000 / 60;
    const result = minutes > this.stoppedTimeoutMinutes;
    return result;
  };

  private readonly isLatestActivityOlderThanOneDay = (
    worker: IWorkerMonitor
  ): boolean => {
    const timestamps = [
      worker.last_connection_check_at,
      worker.updated_at,
      worker.created_at,
    ]
      .map((dateIso) => {
        if (!dateIso) {
          return null;
        }

        const parsed = new Date(dateIso);
        if (Number.isNaN(parsed.getTime())) {
          return null;
        }

        return parsed.getTime();
      })
      .filter((timestamp): timestamp is number => timestamp !== null);

    if (!timestamps.length) {
      return true;
    }

    const latestActivity = Math.max(...timestamps);
    const diff = Date.now() - latestActivity;
    const minutes = diff / 1000 / 60;

    return minutes > this.stoppedTimeoutMinutes;
  };

  private readonly shouldStopDueToInactivity = (
    worker: IWorkerMonitor
  ): boolean => {
    const statuses = [
      EWorkerStatus.offline,
      EWorkerStatus.mismatched,
      EWorkerStatus.disponible,
    ];

    if (!statuses.includes(worker.worker_status_id)) {
      return false;
    }

    return this.isLatestActivityOlderThanOneDay(worker);
  };

  private readonly applyStoppedStatus = async (
    worker: IWorkerMonitor
  ): Promise<void> => {
    await this.workerService.updateStatusWorker(
      worker.worker_id,
      EWorkerStatus.stopped
    );

    const payload: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: worker.worker_id,
      account_id: worker.account_id,
      worker_status_id: EWorkerStatus.stopped,
    };

    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(worker.account_id),
      payload
    );
  };
}
