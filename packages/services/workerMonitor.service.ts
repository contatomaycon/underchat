import { injectable } from 'tsyringe';
import { WorkerService } from './worker.service';
import { ServerService } from './server.service';
import { SshService } from './ssh.service';
import { PasswordEncryptorService } from './passwordEncryptor.service';
import { IBalanceMonitorServer } from '@core/common/interfaces/IBalanceMonitorServer';
import { ConnectConfig } from 'ssh2';
import { IWorkerMonitor } from '@core/common/interfaces/IWorkerMonitor';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { StreamProducerService } from './streamProducer.service';
import { KafkaBalanceQueueService } from './kafkaBalanceQueue.service';
import { CentrifugoService } from './centrifugo.service';
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

@injectable()
export class WorkerMonitorService {
  private readonly timeoutMinutes = 5;

  constructor(
    private readonly workerService: WorkerService,
    private readonly serverService: ServerService,
    private readonly sshService: SshService,
    private readonly passwordEncryptorService: PasswordEncryptorService,
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaBalanceQueueService: KafkaBalanceQueueService,
    private readonly centrifugoService: CentrifugoService,
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

    const tasks = servers.map((server) =>
      this.checkServer(server, workersById, workersByServer)
    );

    await Promise.all(tasks);
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

    const containerTasks = workerIds.map((workerId) =>
      this.processContainer(workerId, server, sshConfig, workersById)
    );

    const serverWorkers = workersByServer.get(server.server_id) ?? [];
    const missingWorkers = serverWorkers.filter(
      (worker) => !setContainers.has(worker.worker_id)
    );

    const missingTasks = missingWorkers.map((worker) =>
      this.handleMissingContainer(worker, server, sshConfig)
    );

    const allTasks = [...containerTasks, ...missingTasks];
    if (!allTasks.length) {
      return;
    }

    await Promise.all(allTasks);
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

    await this.syncConnectionStatus(worker, connectionHealthy);
  };

  private readonly handleMissingContainer = async (
    worker: IWorkerMonitor,
    server: IBalanceMonitorServer,
    sshConfig: ConnectConfig
  ): Promise<void> => {
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

    await this.streamProducerService.send(
      this.kafkaBalanceQueueService.worker(server.server_id),
      payload
    );
  };

  private readonly syncConnectionStatus = async (
    worker: IWorkerMonitor,
    connectionHealthy: boolean
  ): Promise<void> => {
    const desiredStatus = connectionHealthy
      ? EWorkerStatus.online
      : EWorkerStatus.offline;

    if (desiredStatus === worker.worker_status_id) {
      return;
    }

    await this.workerService.updateStatusWorker(
      worker.worker_id,
      desiredStatus
    );

    const payload: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: worker.worker_id,
      account_id: worker.account_id,
      worker_status_id: desiredStatus,
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

  private readonly listContainers = async (
    serverId: string,
    sshConfig: ConnectConfig
  ): Promise<string[]> => {
    const command = 'docker ps --format "{{.Names}}"';
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
    const list = combined.split('\n').map((name) => name.trim());

    return list.filter((name) => !!name);
  };

  private readonly checkFastify = async (
    workerId: string,
    serverId: string,
    sshConfig: ConnectConfig
  ): Promise<boolean> => {
    const command = `bash -c "docker exec ${workerId} sh -c 'curl -s -o /dev/null -w \\"%{http_code}\\" http://127.0.0.1:3005/v1/health/check'"`;

    const outputs = await this.sshService.runCommands(
      serverId,
      sshConfig,
      [command],
      false
    );

    const code = this.parseHttpCode(outputs.map((r) => r.output).join(''));

    return code === 200;
  };

  private readonly checkConnection = async (
    workerId: string,
    serverId: string,
    sshConfig: ConnectConfig
  ): Promise<boolean> => {
    const command = `bash -c "docker exec ${workerId} sh -c 'curl -s -o /dev/null -w \\"%{http_code}\\" http://127.0.0.1:3005/v1/connection/health/check'"`;

    const outputs = await this.sshService.runCommands(
      serverId,
      sshConfig,
      [command],
      false
    );

    const code = this.parseHttpCode(outputs.map((r) => r.output).join(''));

    return code === 200;
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

    return statuses.includes(worker.worker_status_id);
  };

  private readonly shouldCheckConnection = (
    worker: IWorkerMonitor
  ): boolean => {
    const statuses = [EWorkerStatus.online, EWorkerStatus.offline];

    return statuses.includes(worker.worker_status_id);
  };

  private readonly isProvisioning = (worker: IWorkerMonitor): boolean => {
    const statuses = [
      EWorkerStatus.new,
      EWorkerStatus.recreating,
      EWorkerStatus.creating,
    ];

    return statuses.includes(worker.worker_status_id);
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

    return this.isOlderThanTimeout(worker.updated_at);
  };

  private readonly isDeletingTimeout = (worker: IWorkerMonitor): boolean => {
    if (worker.worker_status_id !== EWorkerStatus.deleting) {
      return false;
    }

    return this.isOlderThanTimeout(worker.updated_at);
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

    return minutes > this.timeoutMinutes;
  };
}
