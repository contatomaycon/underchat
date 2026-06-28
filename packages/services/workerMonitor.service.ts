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
import { logLocalConnectionStatus } from '@core/common/functions/localConnectionStatusLog';
import { currentTime } from '@core/common/functions/currentTime';
import { WorkerCommandHandlerService } from './workerCommandHandler.service';

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

interface IConnectionHealthCheckResult {
  healthy: boolean;
  code: number | null;
  body: unknown;
  session_ready?: boolean;
  connected?: boolean;
  can_send?: boolean;
  can_receive_runtime?: boolean;
  authenticated?: boolean;
  provider_state?: string;
  degraded_reason?: string;
  last_probe_at?: string;
  probe_latency_ms?: number;
  phone?: string;
  kafka_unhealthy: boolean;
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
    private readonly accountService: AccountService,
    @inject(WorkerCommandHandlerService)
    private readonly workerCommandHandlerService: WorkerCommandHandlerService
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

    const connectionHealth = await this.checkConnection(
      worker,
      server.server_id,
      sshConfig
    );

    await this.syncConnectionStatusWithFailureTracking(
      worker,
      connectionHealth,
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
      worker_name: worker.name,
      account_id: worker.account_id,
      worker_type_id: worker.worker_type_id,
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
      worker_type_id: worker.worker_type_id,
      name: worker.name,
      worker_name: worker.name,
    };
    const statusPayload: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: worker.worker_id,
      worker_name: worker.name,
      account_id: worker.account_id,
      worker_type_id: worker.worker_type_id,
      worker_status_id: EWorkerStatus.recreating,
    };

    await this.workerService.updateStatusWorker(
      worker.worker_id,
      EWorkerStatus.recreating
    );

    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(worker.account_id),
      statusPayload
    );

    await this.centrifugoService.publish(channelsConfigCentrifugo(), payload);

    await this.workerGrpcClientService.recreateWorker(payload);
  };

  private readonly syncConnectionStatusWithFailureTracking = async (
    worker: IWorkerMonitor,
    connectionHealth: IConnectionHealthCheckResult,
    serverId: string,
    sshConfig: ConnectConfig
  ): Promise<void> => {
    const now = Date.now();
    const tracker = this.connectionFailureTrackers.get(worker.worker_id);
    const connectionHealthy = connectionHealth.healthy;

    if (connectionHealthy) {
      logLocalConnectionStatus('service.monitor.connection_check.healthy', {
        layer: 'service.monitor',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        worker_type_id: worker.worker_type_id,
        worker_status_id: worker.worker_status_id,
        connection_healthy: true,
        session_ready: connectionHealth.session_ready,
        connected: connectionHealth.connected,
        can_send: connectionHealth.can_send,
        can_receive_runtime: connectionHealth.can_receive_runtime,
        authenticated: connectionHealth.authenticated,
        provider_state: connectionHealth.provider_state,
        degraded_reason: connectionHealth.degraded_reason,
        phone: connectionHealth.phone,
        had_tracker: Boolean(tracker),
      });
      if (tracker) {
        this.connectionFailureTrackers.delete(worker.worker_id);
      }

      await this.workerService.updateWorkerLastConnectionCheckAt(
        worker.worker_id
      );

      if (this.shouldPromoteReadyWorkerToOnline(worker.worker_status_id)) {
        await this.promoteReadyWorkerToOnline(worker, connectionHealth);
      }

      return;
    }

    if (worker.worker_status_id === EWorkerStatus.disponible) {
      if (tracker) {
        this.connectionFailureTrackers.delete(worker.worker_id);
      }

      logLocalConnectionStatus('service.monitor.disponible_not_ready', {
        layer: 'service.monitor',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        worker_type_id: worker.worker_type_id,
        worker_status_id: worker.worker_status_id,
        connection_healthy: false,
        status_code: connectionHealth.code,
        session_ready: connectionHealth.session_ready,
        connected: connectionHealth.connected,
        can_send: connectionHealth.can_send,
        can_receive_runtime: connectionHealth.can_receive_runtime,
        authenticated: connectionHealth.authenticated,
        provider_state: connectionHealth.provider_state,
        degraded_reason: connectionHealth.degraded_reason,
        kafka_unhealthy: connectionHealth.kafka_unhealthy,
      });

      return;
    }

    if (!tracker) {
      this.connectionFailureTrackers.set(worker.worker_id, {
        failureCount: 1,
        lastCheckTimestamp: now,
      });
      logLocalConnectionStatus('service.monitor.connection_check.failure', {
        layer: 'service.monitor',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        worker_type_id: worker.worker_type_id,
        worker_status_id: worker.worker_status_id,
        connection_healthy: false,
        failure_count: 1,
        max_failures: this.maxConnectionFailures,
        started_continuous_check: !this.activeContinuousChecks.has(
          worker.worker_id
        ),
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
    logLocalConnectionStatus('service.monitor.connection_check.failure', {
      layer: 'service.monitor',
      worker_id: worker.worker_id,
      account_id: worker.account_id,
      worker_type_id: worker.worker_type_id,
      worker_status_id: worker.worker_status_id,
      connection_healthy: false,
      failure_count: newFailureCount,
      max_failures: this.maxConnectionFailures,
    });

    if (newFailureCount >= this.maxConnectionFailures) {
      await this.handlePersistentConnectionDegradation(
        worker,
        connectionHealth
      );
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
    currentWorker: IWorkerMonitor,
    connectionHealth: IConnectionHealthCheckResult
  ): Promise<void> => {
    this.connectionFailureTrackers.delete(workerId);
    this.activeContinuousChecks.delete(workerId);

    await this.workerService.updateWorkerLastConnectionCheckAt(workerId);

    if (this.shouldPromoteReadyWorkerToOnline(currentWorker.worker_status_id)) {
      await this.promoteReadyWorkerToOnline(currentWorker, connectionHealth);
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

    const tracker = this.connectionFailureTrackers.get(workerId);
    await this.handlePersistentConnectionDegradation(currentWorker, {
      healthy: false,
      code: null,
      body: null,
      kafka_unhealthy: false,
      degraded_reason: tracker
        ? `connection_check_failed_${tracker.failureCount}`
        : 'connection_check_failed',
    });
  };

  private readonly handlePersistentConnectionDegradation = async (
    worker: IWorkerMonitor,
    connectionHealth: IConnectionHealthCheckResult
  ): Promise<void> => {
    this.connectionFailureTrackers.delete(worker.worker_id);
    this.activeContinuousChecks.delete(worker.worker_id);

    await this.updateWorkerDegradedStatus(worker, connectionHealth);
    await this.requestExternalSelfHealing(worker, connectionHealth);
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

      const connectionHealth = await this.checkConnection(
        currentWorker,
        serverId,
        sshConfig
      );
      await this.workerService.updateWorkerUpdatedAt(worker.worker_id);

      if (connectionHealth.healthy) {
        await this.handleHealthyConnection(
          worker.worker_id,
          currentWorker,
          connectionHealth
        );
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
    logLocalConnectionStatus('service.monitor.status_update', {
      layer: 'service.monitor',
      worker_id: worker.worker_id,
      account_id: worker.account_id,
      worker_type_id: worker.worker_type_id,
      previous_worker_status_id: worker.worker_status_id,
      worker_status_id: status,
      status: connectionStatus,
      code,
    });

    const payload: IBaileysConnectionState = {
      code,
      status: connectionStatus,
      worker_id: worker.worker_id,
      worker_name: worker.name,
      account_id: worker.account_id,
      worker_type_id: worker.worker_type_id,
      worker_status_id: status,
    };

    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(worker.account_id),
      payload
    );
  };

  private readonly updateWorkerDegradedStatus = async (
    worker: IWorkerMonitor,
    connectionHealth: IConnectionHealthCheckResult
  ): Promise<void> => {
    const degradedReason =
      connectionHealth.degraded_reason ??
      (connectionHealth.kafka_unhealthy
        ? 'kafka_unhealthy'
        : 'connection_health_failed');

    if (worker.worker_status_id !== EWorkerStatus.disponible) {
      await this.workerService.updateStatusWorker(
        worker.worker_id,
        EWorkerStatus.disponible
      );
    }

    const payload: IBaileysConnectionState = {
      code: ECodeMessage.awaitConnection,
      status: EBaileysConnectionStatus.connecting,
      worker_id: worker.worker_id,
      worker_name: worker.name,
      account_id: worker.account_id,
      worker_type_id: worker.worker_type_id,
      worker_status_id: EWorkerStatus.disponible,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      provider_state: connectionHealth.provider_state ?? 'degraded',
      degraded_reason: degradedReason,
    };

    logLocalConnectionStatus('service.monitor.degraded_status_update', {
      layer: 'service.monitor',
      worker_id: worker.worker_id,
      account_id: worker.account_id,
      worker_type_id: worker.worker_type_id,
      previous_worker_status_id: worker.worker_status_id,
      worker_status_id: EWorkerStatus.disponible,
      session_ready: connectionHealth.session_ready,
      can_send: connectionHealth.can_send,
      can_receive_runtime: connectionHealth.can_receive_runtime,
      authenticated: connectionHealth.authenticated,
      provider_state: payload.provider_state,
      degraded_reason: degradedReason,
      kafka_unhealthy: connectionHealth.kafka_unhealthy,
      status_code: connectionHealth.code,
    });

    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(worker.account_id),
      payload
    );
  };

  private readonly requestExternalSelfHealing = async (
    worker: IWorkerMonitor,
    connectionHealth: IConnectionHealthCheckResult
  ): Promise<void> => {
    const reason =
      connectionHealth.degraded_reason ??
      (connectionHealth.kafka_unhealthy
        ? 'kafka_unhealthy'
        : 'external_monitor_degraded');

    logLocalConnectionStatus('service.monitor.self_heal_requested', {
      layer: 'service.monitor',
      worker_id: worker.worker_id,
      account_id: worker.account_id,
      worker_type_id: worker.worker_type_id,
      source: 'external_monitor',
      reason,
      provider_state: connectionHealth.provider_state,
      kafka_unhealthy: connectionHealth.kafka_unhealthy,
    });

    await this.workerCommandHandlerService
      .requestWorkerSelfHealing({
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        worker_type_id: worker.worker_type_id,
        source: 'external_monitor',
        reason,
        provider_state: connectionHealth.provider_state ?? '',
        degraded_reason: reason,
        kafka_unhealthy: connectionHealth.kafka_unhealthy,
      })
      .catch((error) => {
        logLocalConnectionStatus('service.monitor.self_heal_request_failed', {
          layer: 'service.monitor',
          worker_id: worker.worker_id,
          account_id: worker.account_id,
          worker_type_id: worker.worker_type_id,
          source: 'external_monitor',
          reason,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  };

  private readonly shouldPromoteReadyWorkerToOnline = (
    status: EWorkerStatus
  ): boolean => {
    return [
      EWorkerStatus.offline,
      EWorkerStatus.mismatched,
      EWorkerStatus.disponible,
    ].includes(status);
  };

  private readonly promoteReadyWorkerToOnline = async (
    worker: IWorkerMonitor,
    connectionHealth: IConnectionHealthCheckResult
  ): Promise<void> => {
    const view = await this.workerService.viewWorkerPhoneConnectionDate(
      worker.worker_id
    );
    const phone =
      this.normalizePhone(connectionHealth.phone) ??
      this.normalizePhone(view?.number) ??
      null;
    const connectionDate = currentTime();

    await this.workerService.updateWorkerPhoneStatusConnectionDate({
      worker_id: worker.worker_id,
      status: EWorkerStatus.online,
      number: phone,
      connection_date: connectionDate,
    });

    logLocalConnectionStatus('service.monitor.ready_worker_promoted_online', {
      layer: 'service.monitor',
      worker_id: worker.worker_id,
      account_id: worker.account_id,
      worker_type_id: worker.worker_type_id,
      previous_worker_status_id: worker.worker_status_id,
      worker_status_id: EWorkerStatus.online,
      session_ready: connectionHealth.session_ready,
      can_send: connectionHealth.can_send,
      can_receive_runtime: connectionHealth.can_receive_runtime,
      authenticated: connectionHealth.authenticated,
      provider_state: connectionHealth.provider_state,
      degraded_reason: connectionHealth.degraded_reason,
      phone,
      previous_phone: view?.number ?? null,
      connection_date: connectionDate,
      previous_connection_date: view?.connection_date ?? null,
    });

    const payload: IBaileysConnectionState = {
      code: ECodeMessage.connectionEstablished,
      status: EBaileysConnectionStatus.connected,
      worker_id: worker.worker_id,
      worker_name: worker.name,
      account_id: worker.account_id,
      worker_type_id: worker.worker_type_id,
      phone: phone ?? undefined,
      worker_status_id: EWorkerStatus.online,
      session_ready: true,
      can_send: connectionHealth.can_send ?? true,
      can_receive_runtime: connectionHealth.can_receive_runtime ?? true,
      authenticated: connectionHealth.authenticated ?? true,
      provider_state: connectionHealth.provider_state,
      degraded_reason: connectionHealth.degraded_reason,
      last_probe_at: connectionHealth.last_probe_at,
      probe_latency_ms: connectionHealth.probe_latency_ms,
    };

    await Promise.all([
      this.centrifugoService.publishSub(
        workerCentrifugoQueue(worker.account_id),
        payload
      ),
      this.centrifugoService.publish(channelsConfigCentrifugo(), payload),
    ]);
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
    const isActivatedWorkerName =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        name
      );
    const isWarmStandby =
      name.startsWith('warm-') ||
      (!isActivatedWorkerName && (warmStandby || !!warmPoolId));

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
    worker: IWorkerMonitor,
    serverId: string,
    sshConfig: ConnectConfig
  ): Promise<IConnectionHealthCheckResult> => {
    const workerId = worker.worker_id;
    const command = String.raw`bash -c "docker exec ${workerId} sh -c 'curl -s -w \"__HTTP_STATUS__%{http_code}\" http://127.0.0.1:3005/v1/connection/health/check'"`;

    try {
      const outputs = await this.sshService.runCommands(
        serverId,
        sshConfig,
        [command],
        false
      );

      const rawOutput = outputs.map((r) => r.output).join('');
      const health = this.parseHttpResponse(rawOutput);
      const code = health.code;
      const healthy = code === 200 && this.hasSessionReadyBody(health.body);
      const result = this.buildConnectionHealthCheckResult(
        healthy,
        code,
        health.body
      );
      logLocalConnectionStatus('service.monitor.connection_health_http', {
        layer: 'service.monitor',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        worker_type_id: worker.worker_type_id,
        worker_status_id: worker.worker_status_id,
        status_code: code,
        connection_healthy: result.healthy,
        session_ready: result.session_ready,
        connected: result.connected,
        can_send: result.can_send,
        can_receive_runtime: result.can_receive_runtime,
        authenticated: result.authenticated,
        provider_state: result.provider_state,
        degraded_reason: result.degraded_reason,
        last_probe_at: result.last_probe_at,
        probe_latency_ms: result.probe_latency_ms,
        phone: result.phone,
        kafka_unhealthy: result.kafka_unhealthy,
      });
      return result;
    } catch (error) {
      logLocalConnectionStatus('service.monitor.connection_health_error', {
        layer: 'service.monitor',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        worker_type_id: worker.worker_type_id,
        worker_status_id: worker.worker_status_id,
        reason: error instanceof Error ? error.message : String(error),
      });
      return {
        healthy: false,
        code: null,
        body: null,
        kafka_unhealthy: false,
        degraded_reason: error instanceof Error ? error.message : String(error),
      };
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

  private readonly parseHttpResponse = (
    raw: string
  ): { code: number | null; body: unknown } => {
    const marker = '__HTTP_STATUS__';
    const markerIndex = raw.lastIndexOf(marker);
    if (markerIndex < 0) {
      return {
        code: this.parseHttpCode(raw),
        body: null,
      };
    }

    const bodyRaw = raw.slice(0, markerIndex).trim();
    const code = this.parseHttpCode(raw.slice(markerIndex + marker.length));
    return {
      code,
      body: this.parseJsonBody(bodyRaw),
    };
  };

  private readonly parseJsonBody = (raw: string): unknown => {
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  };

  private readonly hasSessionReadyBody = (body: unknown): boolean => {
    const payload = this.getConnectionHealthPayload(body);
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    const record = payload as {
      session_ready?: unknown;
      connected?: unknown;
      can_send?: unknown;
      can_receive_runtime?: unknown;
      authenticated?: unknown;
      kafka_unhealthy?: unknown;
      phone?: unknown;
    };

    return (
      record.session_ready === true &&
      record.connected === true &&
      record.can_send === true &&
      record.can_receive_runtime === true &&
      record.authenticated === true &&
      typeof record.phone === 'string' &&
      record.phone.trim().length > 0 &&
      record.kafka_unhealthy !== true
    );
  };

  private readonly getConnectionHealthPayload = (body: unknown): unknown => {
    if (!body || typeof body !== 'object') {
      return body;
    }

    const data = (body as Record<string, unknown>).data;
    if (data && typeof data === 'object') {
      return data;
    }

    return body;
  };

  private readonly readBooleanBody = (
    body: unknown,
    key: string
  ): boolean | undefined => {
    const payload = this.getConnectionHealthPayload(body);
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }

    const value = (payload as Record<string, unknown>)[key];
    return typeof value === 'boolean' ? value : undefined;
  };

  private readonly readStringBody = (
    body: unknown,
    key: string
  ): string | undefined => {
    const payload = this.getConnectionHealthPayload(body);
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }

    const value = (payload as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : undefined;
  };

  private readonly readNumberBody = (
    body: unknown,
    key: string
  ): number | undefined => {
    const payload = this.getConnectionHealthPayload(body);
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }

    const value = (payload as Record<string, unknown>)[key];
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
  };

  private readonly buildConnectionHealthCheckResult = (
    healthy: boolean,
    code: number | null,
    body: unknown
  ): IConnectionHealthCheckResult => {
    return {
      healthy,
      code,
      body,
      session_ready: this.readBooleanBody(body, 'session_ready'),
      connected: this.readBooleanBody(body, 'connected'),
      can_send: this.readBooleanBody(body, 'can_send'),
      can_receive_runtime: this.readBooleanBody(body, 'can_receive_runtime'),
      authenticated: this.readBooleanBody(body, 'authenticated'),
      provider_state: this.readStringBody(body, 'provider_state'),
      degraded_reason: this.readStringBody(body, 'degraded_reason'),
      last_probe_at: this.readStringBody(body, 'last_probe_at'),
      probe_latency_ms: this.readNumberBody(body, 'probe_latency_ms'),
      phone: this.normalizePhone(this.readStringBody(body, 'phone')),
      kafka_unhealthy: this.readKafkaUnhealthy(body),
    };
  };

  private readonly normalizePhone = (
    phone: string | null | undefined
  ): string | undefined => {
    const normalized = phone?.trim();
    return normalized || undefined;
  };

  private readonly readKafkaUnhealthy = (body: unknown): boolean => {
    if (!body || typeof body !== 'object') {
      return false;
    }

    const record = body as Record<string, unknown>;
    if (record.kafka_unhealthy === true) {
      return true;
    }

    const payload = this.getConnectionHealthPayload(body);
    return (
      !!payload &&
      typeof payload === 'object' &&
      (payload as Record<string, unknown>).kafka_unhealthy === true
    );
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
      EWorkerStatus.disponible,
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
      worker_name: worker.name,
      account_id: worker.account_id,
      worker_type_id: worker.worker_type_id,
      worker_status_id: EWorkerStatus.stopped,
    };

    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(worker.account_id),
      payload
    );
  };
}
