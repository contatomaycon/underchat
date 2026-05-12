import type { Client } from '@wwebjs/whatsapp-web.js';
import { singleton, inject } from 'tsyringe';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { wwebjsEnvironment } from '@core/config/environments';
import { EBaileysConnectionStatus as Status } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { EWppConnection } from '@core/common/enums/EWppConnection';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { BalanceWorkerStatusGrpcClientService } from '@core/services/balanceWorkerStatusGrpcClient.service';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { getPhoneNumber } from '@core/common/functions/getPhoneNumber';
import { buildWppConnectionDocumentId } from '@core/common/functions/buildWppConnectionDocumentId';
import { wppConnectionMappings } from '@core/mappings/wppConnection.mappings';
import type { IBaileysConnection } from '@core/common/interfaces/IBaileysConnection';

const CHANNEL = workerCentrifugoQueue(wwebjsEnvironment.wwebjsAccountId);
const WORKER = wwebjsEnvironment.wwebjsWorkerId;
const ACCOUNT = wwebjsEnvironment.wwebjsAccountId;

const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 30_000;
const STATE_CHECK_TIMEOUT_MS = 10_000;
const BOOTSTRAP_ORCHESTRATOR_GRACE_MS = 15_000;
const TRANSIENT_DISCONNECT_THRESHOLD = 2;

type WAState =
  | 'CONFLICT'
  | 'CONNECTED'
  | 'DEPRECATED_VERSION'
  | 'OPENING'
  | 'PAIRING'
  | 'PROXYBLOCK'
  | 'SMB_TOS_BLOCK'
  | 'TIMEOUT'
  | 'TOS_BLOCK'
  | 'UNLAUNCHED'
  | 'UNPAIRED'
  | 'UNPAIRED_IDLE';

interface HealthCheckResult {
  isHealthy: boolean;
  reason?: string;
  detectedStatus: Status;
  workerStatus: EWorkerStatus;
  waState?: WAState;
}

interface WwebjsHealthCheckConfig {
  getClient: () => Client | undefined;
  getStatus: () => Status;
  getCode: () => ECodeMessage;
  reconnect: (input: IBaileysConnection) => void;
  isConnected: () => boolean;
  hasSession: () => boolean;
  onStatusMismatch?: (detected: Status, workerStatus: EWorkerStatus) => void;
}

@singleton()
export class WwebjsHealthCheckService {
  private intervalId: NodeJS.Timeout | undefined;
  private lastKnownStatus: Status = Status.initial;
  private lastKnownWorkerStatus: EWorkerStatus = EWorkerStatus.disponible;
  private isRunning = false;
  private clientGetter: (() => Client | undefined) | undefined;
  private statusGetter: (() => Status) | undefined;
  private codeGetter: (() => ECodeMessage) | undefined;
  private reconnectAction: ((input: IBaileysConnection) => void) | undefined;
  private isConnectedAction: (() => boolean) | undefined;
  private hasSessionAction: (() => boolean) | undefined;
  private onStatusMismatch:
    | ((detected: Status, workerStatus: EWorkerStatus) => void)
    | undefined;
  private bootstrapPromise: Promise<void> | undefined;
  private bootstrapLock = false;
  private bootstrapFallbackTimer: NodeJS.Timeout | undefined;
  private transientDisconnectFailures = 0;

  constructor(
    @inject(CentrifugoService)
    private readonly centrifugo: CentrifugoService,
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(BalanceWorkerStatusGrpcClientService)
    private readonly balanceWorkerStatusGrpcClientService: BalanceWorkerStatusGrpcClientService
  ) {}

  configure(options: WwebjsHealthCheckConfig): void {
    this.clientGetter = options.getClient;
    this.statusGetter = options.getStatus;
    this.codeGetter = options.getCode;
    this.reconnectAction = options.reconnect;
    this.isConnectedAction = options.isConnected;
    this.hasSessionAction = options.hasSession;
    this.onStatusMismatch = options.onStatusMismatch;
  }

  start(intervalMs = DEFAULT_HEALTH_CHECK_INTERVAL_MS): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.intervalId = setInterval(() => {
      void this.runHealthCheck();
    }, intervalMs);

    console.log(`[WwebjsHealthCheck] Started with interval ${intervalMs}ms`);
  }

  stop(): void {
    this.clearBootstrapFallbackTimer();

    if (!this.isRunning) {
      return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    this.isRunning = false;
    console.log('[WwebjsHealthCheck] Stopped');
  }

  bootstrapConnection(): Promise<void> {
    if (this.bootstrapLock && this.bootstrapPromise) {
      return this.bootstrapPromise;
    }

    if (this.bootstrapPromise) {
      return this.bootstrapPromise;
    }

    this.bootstrapLock = true;
    this.bootstrapPromise = this.runBootstrapConnection().finally(() => {
      this.bootstrapLock = false;
      this.bootstrapPromise = undefined;
    });

    return this.bootstrapPromise;
  }

  async notifyDisconnected(reason?: string): Promise<void> {
    const result: HealthCheckResult = {
      isHealthy: false,
      reason: reason ?? 'Connection closed',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.offline,
    };

    if (
      result.detectedStatus !== this.lastKnownStatus ||
      result.workerStatus !== this.lastKnownWorkerStatus
    ) {
      console.log(
        `[WwebjsHealthCheck] Status changed: ${this.lastKnownStatus} -> ${result.detectedStatus}, worker: ${this.lastKnownWorkerStatus} -> ${result.workerStatus}`
      );

      this.lastKnownStatus = result.detectedStatus;
      this.lastKnownWorkerStatus = result.workerStatus;

      await this.notifyStatusChange(undefined, result);
    }
  }

  resetLastKnownStatus(): void {
    this.lastKnownStatus = Status.initial;
    this.lastKnownWorkerStatus = EWorkerStatus.disponible;
  }

  async runHealthCheck(): Promise<HealthCheckResult> {
    if (!this.clientGetter || !this.statusGetter) {
      return {
        isHealthy: false,
        reason: 'Health check not configured',
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
      };
    }

    const client = this.clientGetter();
    const reportedStatus = this.statusGetter();

    const connectivityResult = await this.checkConnectivity(
      client,
      reportedStatus
    );
    const result = this.withTransientDisconnectTolerance(
      connectivityResult,
      reportedStatus
    );

    if (
      result.detectedStatus !== this.lastKnownStatus ||
      result.workerStatus !== this.lastKnownWorkerStatus
    ) {
      console.log(
        `[WwebjsHealthCheck] Status changed: ${this.lastKnownStatus} -> ${result.detectedStatus}, worker: ${this.lastKnownWorkerStatus} -> ${result.workerStatus}`
      );

      this.lastKnownStatus = result.detectedStatus;
      this.lastKnownWorkerStatus = result.workerStatus;

      await this.notifyStatusChange(client, result);
    }

    if (reportedStatus !== result.detectedStatus && this.onStatusMismatch) {
      console.log(
        `[WwebjsHealthCheck] Mismatch detected: reported=${reportedStatus}, actual=${result.detectedStatus}, reason=${result.reason ?? 'unknown'}`
      );
      this.onStatusMismatch(result.detectedStatus, result.workerStatus);
    }

    return result;
  }

  private async runBootstrapConnection(): Promise<void> {
    if (!this.hasBootstrapConfig()) {
      console.warn(
        '[WwebjsHealthCheck] bootstrapConnection skipped: service not configured'
      );
      return;
    }

    if (this.isConnectedAction?.()) {
      return;
    }

    const hasInitialSession = this.hasSessionAction?.() ?? false;
    const currentStatus = this.statusGetter?.() ?? Status.initial;
    const currentCode = this.codeGetter?.() ?? ECodeMessage.awaitConnection;
    const awaitingUserAction =
      currentCode === ECodeMessage.awaitingReadQrCode ||
      currentCode === ECodeMessage.awaitingPairingCode ||
      currentCode === ECodeMessage.pairingInProgress ||
      currentCode === ECodeMessage.newLoginAttempt;

    if (!hasInitialSession) {
      console.log(
        '[WwebjsHealthCheck] No restorable session found. Waiting for user QR request.'
      );
      await this.notifyDisponibleStatus('No restorable session on bootstrap');
      return;
    }

    if (currentStatus === Status.connecting && awaitingUserAction) {
      console.log(
        '[WwebjsHealthCheck] Bootstrap resolved while awaiting pairing/user action.'
      );
      return;
    }

    console.log(
      '[WwebjsHealthCheck] Restorable session found. Waiting connection service orchestrator.'
    );

    this.scheduleBootstrapReconnectFallback();
  }

  private scheduleBootstrapReconnectFallback(): void {
    this.clearBootstrapFallbackTimer();

    console.log(
      `[WwebjsHealthCheck] fallback_scheduled (delay=${BOOTSTRAP_ORCHESTRATOR_GRACE_MS}ms)`
    );

    this.bootstrapFallbackTimer = setTimeout(() => {
      this.bootstrapFallbackTimer = undefined;

      if (this.isConnectedAction?.()) {
        console.log('[WwebjsHealthCheck] fallback_skipped (reason=connected)');
        return;
      }

      if (!(this.hasSessionAction?.() ?? false)) {
        console.log('[WwebjsHealthCheck] fallback_skipped (reason=no_session)');
        return;
      }

      const currentStatus = this.statusGetter?.() ?? Status.initial;
      const currentCode = this.codeGetter?.() ?? ECodeMessage.awaitConnection;
      const awaitingUserAction = this.isAwaitingUserAction(currentCode);

      if (currentStatus === Status.connecting) {
        const reason = awaitingUserAction
          ? 'awaiting_user_action'
          : 'already_connecting';
        console.log(`[WwebjsHealthCheck] fallback_skipped (reason=${reason})`);
        return;
      }

      if (currentStatus === Status.connected) {
        console.log(
          '[WwebjsHealthCheck] fallback_skipped (reason=status_connected)'
        );
        return;
      }

      try {
        this.reconnectAction?.({
          initial_connection: true,
          requested_by_user: false,
          from_disconnect_restart: true,
        });
        console.log('[WwebjsHealthCheck] fallback_triggered');
      } catch (error) {
        console.error('[WwebjsHealthCheck] fallback_trigger_error', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, BOOTSTRAP_ORCHESTRATOR_GRACE_MS);
  }

  private clearBootstrapFallbackTimer(): void {
    if (!this.bootstrapFallbackTimer) {
      return;
    }

    clearTimeout(this.bootstrapFallbackTimer);
    this.bootstrapFallbackTimer = undefined;
  }

  private isAwaitingUserAction(code: ECodeMessage): boolean {
    return (
      code === ECodeMessage.awaitingReadQrCode ||
      code === ECodeMessage.awaitingPairingCode ||
      code === ECodeMessage.pairingInProgress ||
      code === ECodeMessage.newLoginAttempt
    );
  }

  private hasBootstrapConfig(): boolean {
    return Boolean(
      this.statusGetter &&
      this.codeGetter &&
      this.reconnectAction &&
      this.isConnectedAction &&
      this.hasSessionAction
    );
  }

  private async notifyDisponibleStatus(reason: string): Promise<void> {
    const payload: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: Status.info,
      worker_id: WORKER,
      account_id: ACCOUNT,
      worker_status_id: EWorkerStatus.disponible,
    };

    try {
      await this.balanceWorkerStatusGrpcClientService.notifyWorkerStatus(
        payload
      );
    } catch (error) {
      console.error(
        '[WwebjsHealthCheck] Failed to notify available worker status during bootstrap',
        error
      );
    }

    console.log(`[WwebjsHealthCheck] ${reason}`);
  }

  private async checkConnectivity(
    client: Client | undefined,
    reportedStatus: Status
  ): Promise<HealthCheckResult> {
    if (!client) {
      return {
        isHealthy: false,
        reason: 'No client instance',
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
      };
    }

    let waState: WAState | undefined;
    try {
      waState = await this.getStateWithTimeout(client);
    } catch (error) {
      return {
        isHealthy: false,
        reason: `Failed to get state: ${error instanceof Error ? error.message : String(error)}`,
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
      };
    }

    if (!waState) {
      if (reportedStatus === Status.connecting) {
        return {
          isHealthy: true,
          reason: 'Connecting (state not yet available)',
          detectedStatus: Status.connecting,
          workerStatus: EWorkerStatus.disponible,
        };
      }

      return {
        isHealthy: false,
        reason: 'State not available',
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
      };
    }

    const stateResult = this.mapWAStateToStatus(waState);

    if (stateResult.detectedStatus === Status.connected && !client.info) {
      return {
        isHealthy: false,
        reason: 'Connected state but no client info',
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
        waState,
      };
    }

    return {
      ...stateResult,
      waState,
    };
  }

  private withTransientDisconnectTolerance(
    result: HealthCheckResult,
    reportedStatus: Status
  ): HealthCheckResult {
    if (this.isTransientDisconnectResult(result, reportedStatus)) {
      this.transientDisconnectFailures += 1;

      if (this.transientDisconnectFailures < TRANSIENT_DISCONNECT_THRESHOLD) {
        return {
          ...result,
          isHealthy: true,
          reason: `Transient health check failure ignored (${this.transientDisconnectFailures}/${TRANSIENT_DISCONNECT_THRESHOLD}): ${result.reason ?? 'unknown'}`,
          detectedStatus: Status.connected,
          workerStatus: EWorkerStatus.online,
        };
      }

      return result;
    }

    this.transientDisconnectFailures = 0;
    return result;
  }

  private isTransientDisconnectResult(
    result: HealthCheckResult,
    reportedStatus: Status
  ): boolean {
    if (
      reportedStatus !== Status.connected ||
      result.detectedStatus !== Status.disconnected ||
      result.workerStatus !== EWorkerStatus.offline
    ) {
      return false;
    }

    const reason = result.reason ?? '';

    return (
      reason.startsWith('Failed to get state:') ||
      reason === 'State not available' ||
      reason === 'Connected state but no client info' ||
      reason === 'Connection timeout' ||
      reason === 'Client not launched' ||
      reason.startsWith('Unknown state:')
    );
  }

  private getStateWithTimeout(client: Client): Promise<WAState | undefined> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('State check timeout'));
      }, STATE_CHECK_TIMEOUT_MS);

      client
        .getState()
        .then((state) => {
          clearTimeout(timeout);
          resolve(state as WAState | undefined);
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  private mapWAStateToStatus(state: WAState): HealthCheckResult {
    switch (state) {
      case 'CONNECTED':
        return {
          isHealthy: true,
          reason: 'Connected',
          detectedStatus: Status.connected,
          workerStatus: EWorkerStatus.online,
        };

      case 'OPENING':
      case 'PAIRING':
        return {
          isHealthy: true,
          reason: `State: ${state}`,
          detectedStatus: Status.connecting,
          workerStatus: EWorkerStatus.disponible,
        };

      case 'UNPAIRED':
      case 'UNPAIRED_IDLE':
        return {
          isHealthy: false,
          reason: `Not paired: ${state}`,
          detectedStatus: Status.disconnected,
          workerStatus: EWorkerStatus.disponible,
        };

      case 'CONFLICT':
        return {
          isHealthy: false,
          reason: 'Session conflict - another device connected',
          detectedStatus: Status.disconnected,
          workerStatus: EWorkerStatus.mismatched,
        };

      case 'DEPRECATED_VERSION':
        return {
          isHealthy: false,
          reason: 'Deprecated WhatsApp Web version',
          detectedStatus: Status.disconnected,
          workerStatus: EWorkerStatus.mismatched,
        };

      case 'TIMEOUT':
        return {
          isHealthy: false,
          reason: 'Connection timeout',
          detectedStatus: Status.disconnected,
          workerStatus: EWorkerStatus.offline,
        };

      case 'PROXYBLOCK':
      case 'TOS_BLOCK':
      case 'SMB_TOS_BLOCK':
        return {
          isHealthy: false,
          reason: `Blocked: ${state}`,
          detectedStatus: Status.disconnected,
          workerStatus: EWorkerStatus.mismatched,
        };

      case 'UNLAUNCHED':
        return {
          isHealthy: false,
          reason: 'Client not launched',
          detectedStatus: Status.disconnected,
          workerStatus: EWorkerStatus.offline,
        };

      default:
        return {
          isHealthy: false,
          reason: `Unknown state: ${state}`,
          detectedStatus: Status.disconnected,
          workerStatus: EWorkerStatus.offline,
        };
    }
  }

  private async notifyStatusChange(
    client: Client | undefined,
    result: HealthCheckResult
  ): Promise<void> {
    const payload: IBaileysConnectionState = {
      status: result.detectedStatus,
      worker_id: WORKER,
      account_id: ACCOUNT,
      code:
        result.detectedStatus === Status.connected
          ? ECodeMessage.connectionEstablished
          : ECodeMessage.connectionLost,
      phone: getPhoneNumber(client?.info?.wid?._serialized),
      worker_status_id: result.workerStatus,
    };

    try {
      await this.centrifugo.publishSub(CHANNEL, payload);
    } catch (error) {
      console.error('[WwebjsHealthCheck] Failed to publish status', error);
    }

    try {
      await this.balanceWorkerStatusGrpcClientService.notifyWorkerStatus(
        payload
      );
    } catch (error) {
      console.error(
        '[WwebjsHealthCheck] Failed to notify balance worker status',
        error
      );
    }

    const isConnected = result.detectedStatus === Status.connected;
    const phone = getPhoneNumber(client?.info?.wid?._serialized);

    await this.saveLogWppConnection({
      worker_id: WORKER,
      status: result.detectedStatus,
      code: payload.code?.toString(),
      message: result.reason ?? 'Health check status update',
      date: new Date(),
      ...(isConnected && phone ? { phone, connected_at: new Date() } : {}),
    });
  }

  private readonly saveLogWppConnection = async (
    wppLog: EWppConnection
  ): Promise<boolean> => {
    const mappings = wppConnectionMappings();
    const result = await this.elasticDatabaseService.indices(
      EElasticIndex.wpp_connection,
      mappings
    );

    if (!result || !wppLog) {
      return false;
    }

    const documentId = buildWppConnectionDocumentId(ACCOUNT, wppLog.worker_id);

    const updateResult = await this.elasticDatabaseService.updateWithOCC(
      EElasticIndex.wpp_connection,
      documentId,
      wppLog as unknown as Record<string, unknown>,
      { upsert: true, maxRetries: 5 }
    );

    return (
      updateResult === 'updated' ||
      updateResult === 'created' ||
      updateResult === 'noop'
    );
  };
}
