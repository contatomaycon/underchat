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
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { BalanceWorkerStatusGrpcClientService } from '@core/services/balanceWorkerStatusGrpcClient.service';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { getPhoneNumber } from '@core/common/functions/getPhoneNumber';
import { buildWppConnectionDocumentId } from '@core/common/functions/buildWppConnectionDocumentId';
import { wppConnectionMappings } from '@core/mappings/wppConnection.mappings';
import type { IBaileysConnection } from '@core/common/interfaces/IBaileysConnection';
import { logLocalConnectionStatus } from '@core/common/functions/localConnectionStatusLog';

const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 30_000;
const STATE_CHECK_TIMEOUT_MS = 10_000;
const BOOTSTRAP_ORCHESTRATOR_GRACE_MS = 15_000;
const TRANSIENT_DISCONNECT_THRESHOLD = 2;

function getChannel(): string {
  return workerCentrifugoQueue(wwebjsEnvironment.wwebjsAccountId);
}

function getWorker(): string {
  return wwebjsEnvironment.wwebjsWorkerId;
}

function getAccount(): string {
  return wwebjsEnvironment.wwebjsAccountId;
}

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
  session_ready: boolean;
  can_send: boolean;
  can_receive_runtime: boolean;
  authenticated: boolean;
  provider_state: string;
  degraded_reason?: string;
  last_probe_at: string;
  probe_latency_ms: number;
  phone?: string;
}

interface WwebjsHealthCheckConfig {
  getClient: () => Client | undefined;
  getStatus: () => Status;
  getCode: () => ECodeMessage;
  reconnect: (input: IBaileysConnection) => void;
  isConnected: () => boolean;
  hasSession: () => boolean;
  isEventBridgeAttached?: (client?: Client) => boolean;
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
  private isEventBridgeAttachedAction:
    | ((client?: Client) => boolean)
    | undefined;
  private onStatusMismatch:
    | ((detected: Status, workerStatus: EWorkerStatus) => void)
    | undefined;
  private bootstrapPromise: Promise<void> | undefined;
  private bootstrapLock = false;
  private bootstrapFallbackTimer: NodeJS.Timeout | undefined;
  private transientDisconnectFailures = 0;
  private lastResult: HealthCheckResult = {
    isHealthy: false,
    reason: 'Health check not run',
    detectedStatus: Status.initial,
    workerStatus: EWorkerStatus.disponible,
    session_ready: false,
    can_send: false,
    can_receive_runtime: false,
    authenticated: false,
    provider_state: 'initial',
    degraded_reason: 'health_check_not_run',
    last_probe_at: '',
    probe_latency_ms: 0,
  };

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
    this.isEventBridgeAttachedAction = options.isEventBridgeAttached;
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

  async notifyDisconnected(
    reason?: string,
    options: {
      workerStatus?: EWorkerStatus;
      detectedStatus?: Status;
      providerState?: string;
    } = {}
  ): Promise<void> {
    const workerStatus = options.workerStatus ?? EWorkerStatus.disponible;
    const detectedStatus =
      options.detectedStatus ??
      (workerStatus === EWorkerStatus.disponible
        ? Status.connecting
        : Status.disconnected);
    const result = this.buildResult({
      isHealthy: false,
      reason: reason ?? 'Connection closed',
      detectedStatus,
      workerStatus,
      providerState: options.providerState ?? 'reconnecting',
    });
    this.lastResult = result;

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

  getReadinessSnapshot(): HealthCheckResult {
    return this.lastResult;
  }

  async verifyCurrentSession(): Promise<HealthCheckResult> {
    if (!this.clientGetter) {
      const result = this.buildResult({
        isHealthy: false,
        reason: 'Health check not configured',
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
        providerState: 'not_configured',
      });
      this.lastResult = result;
      this.logHealthResult('wwebjs.health_check.result', result, {
        reported_status: undefined,
        configured: false,
      });
      return result;
    }

    const result = await this.checkConnectivity(
      this.clientGetter(),
      Status.connected
    );
    this.lastResult = result;
    return result;
  }

  markStatusPublished(result: HealthCheckResult): void {
    this.lastResult = result;
    this.lastKnownStatus = result.detectedStatus;
    this.lastKnownWorkerStatus = result.workerStatus;
  }

  async runHealthCheck(): Promise<HealthCheckResult> {
    if (!this.clientGetter || !this.statusGetter) {
      const result = this.buildResult({
        isHealthy: false,
        reason: 'Health check not configured',
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
        providerState: 'not_configured',
      });
      this.lastResult = result;
      return result;
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
    this.lastResult = result;
    this.logHealthResult('wwebjs.health_check.result', result, {
      reported_status: reportedStatus,
      transient_disconnect_failures: this.transientDisconnectFailures,
    });

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
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.disponible,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      provider_state: 'bootstrap',
      degraded_reason: reason,
      last_probe_at: new Date().toISOString(),
      probe_latency_ms: 0,
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
      return this.buildResult({
        isHealthy: false,
        reason: 'No client instance',
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
        providerState: 'missing_client',
      });
    }

    let waState: WAState | undefined;
    try {
      waState = await this.getStateWithTimeout(client);
    } catch (error) {
      return this.buildResult({
        isHealthy: false,
        reason: `Failed to get state: ${error instanceof Error ? error.message : String(error)}`,
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
        providerState: 'state_error',
      });
    }

    if (!waState) {
      if (reportedStatus === Status.connecting) {
        return this.buildResult({
          isHealthy: true,
          reason: 'Connecting (state not yet available)',
          detectedStatus: Status.connecting,
          workerStatus: EWorkerStatus.disponible,
          providerState: 'state_unavailable',
        });
      }

      return this.buildResult({
        isHealthy: false,
        reason: 'State not available',
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
        providerState: 'state_unavailable',
      });
    }

    const stateResult = this.mapWAStateToStatus(waState);

    if (stateResult.detectedStatus === Status.connected) {
      return this.probeConnectedClient(client, waState);
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
    if (!this.isTransientDisconnectResult(result, reportedStatus)) {
      if (result.session_ready) {
        this.transientDisconnectFailures = 0;
      }
      return result;
    }

    this.transientDisconnectFailures += 1;
    if (this.transientDisconnectFailures >= TRANSIENT_DISCONNECT_THRESHOLD) {
      return result;
    }

    return this.buildResult({
      isHealthy: true,
      reason: `Transient disconnect tolerated (${result.reason ?? result.provider_state})`,
      detectedStatus: Status.connecting,
      workerStatus: EWorkerStatus.disponible,
      waState: result.waState,
      providerState: result.provider_state || 'transient_disconnect',
      degradedReason: result.degraded_reason ?? result.reason,
      authenticated: result.authenticated,
      canReceiveRuntime: result.can_receive_runtime,
      canSend: false,
      lastProbeAt: result.last_probe_at,
      probeLatencyMs: result.probe_latency_ms,
      phone: result.phone,
    });
  }

  private logHealthResult(
    event: string,
    result: HealthCheckResult,
    extra: Record<string, unknown> = {}
  ): void {
    logLocalConnectionStatus(event, {
      layer: 'wwebjs.health',
      provider: 'wwebjs',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: result.workerStatus,
      status: result.detectedStatus,
      session_ready: result.session_ready,
      can_send: result.can_send,
      can_receive_runtime: result.can_receive_runtime,
      authenticated: result.authenticated,
      provider_state: result.provider_state,
      degraded_reason: result.degraded_reason,
      reason: result.reason,
      wa_state: result.waState,
      last_probe_at: result.last_probe_at,
      probe_latency_ms: result.probe_latency_ms,
      phone: result.phone,
      is_healthy: result.isHealthy,
      ...extra,
    });
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
        return this.buildResult({
          isHealthy: true,
          reason: 'Connected',
          detectedStatus: Status.connected,
          workerStatus: EWorkerStatus.online,
          providerState: state,
        });

      case 'OPENING':
      case 'PAIRING':
        return this.buildResult({
          isHealthy: true,
          reason: `State: ${state}`,
          detectedStatus: Status.connecting,
          workerStatus: EWorkerStatus.disponible,
          providerState: state,
        });

      case 'UNPAIRED':
      case 'UNPAIRED_IDLE':
        return this.buildResult({
          isHealthy: false,
          reason: `Not paired: ${state}`,
          detectedStatus: Status.disconnected,
          workerStatus: EWorkerStatus.disponible,
          providerState: state,
        });

      case 'CONFLICT':
        return this.buildResult({
          isHealthy: false,
          reason: 'Session conflict - another device connected',
          detectedStatus: Status.disconnected,
          workerStatus: EWorkerStatus.mismatched,
          providerState: state,
        });

      case 'DEPRECATED_VERSION':
        return this.buildResult({
          isHealthy: false,
          reason: 'Deprecated WhatsApp Web version',
          detectedStatus: Status.disconnected,
          workerStatus: EWorkerStatus.mismatched,
          providerState: state,
        });

      case 'TIMEOUT':
        return this.buildResult({
          isHealthy: false,
          reason: 'Connection timeout',
          detectedStatus: Status.disconnected,
          workerStatus: EWorkerStatus.offline,
          providerState: state,
        });

      case 'PROXYBLOCK':
      case 'TOS_BLOCK':
      case 'SMB_TOS_BLOCK':
        return this.buildResult({
          isHealthy: false,
          reason: `Blocked: ${state}`,
          detectedStatus: Status.disconnected,
          workerStatus: EWorkerStatus.mismatched,
          providerState: state,
        });

      case 'UNLAUNCHED':
        return this.buildResult({
          isHealthy: false,
          reason: 'Client not launched',
          detectedStatus: Status.disconnected,
          workerStatus: EWorkerStatus.offline,
          providerState: state,
        });

      default:
        return this.buildResult({
          isHealthy: false,
          reason: `Unknown state: ${state}`,
          detectedStatus: Status.disconnected,
          workerStatus: EWorkerStatus.offline,
          providerState: state,
        });
    }
  }

  private async probeConnectedClient(
    client: Client,
    waState: WAState
  ): Promise<HealthCheckResult> {
    const probeStartedAt = Date.now();
    const lastProbeAt = new Date().toISOString();
    const selfJid = client.info?.wid?._serialized;
    const selfPhone = getPhoneNumber(selfJid);
    const eventBridgeAttached =
      this.isEventBridgeAttachedAction?.(client) === true;

    if (!selfJid) {
      return this.buildResult({
        isHealthy: true,
        reason: 'Connected state but no client info',
        detectedStatus: Status.connecting,
        workerStatus: EWorkerStatus.disponible,
        providerState: waState,
        degradedReason: 'missing_client_info',
        canReceiveRuntime: eventBridgeAttached,
        lastProbeAt,
        probeLatencyMs: Date.now() - probeStartedAt,
        phone: selfPhone,
      });
    }

    if (!eventBridgeAttached) {
      return this.buildResult({
        isHealthy: true,
        reason: 'Connected state but event bridge is not attached',
        detectedStatus: Status.connecting,
        workerStatus: EWorkerStatus.disponible,
        providerState: waState,
        degradedReason: 'event_bridge_not_attached',
        authenticated: true,
        canReceiveRuntime: false,
        lastProbeAt,
        probeLatencyMs: Date.now() - probeStartedAt,
        phone: selfPhone,
      });
    }

    if (!this.hasSessionAction?.()) {
      return this.buildResult({
        isHealthy: true,
        reason: 'Connected state but local session is missing',
        detectedStatus: Status.connecting,
        workerStatus: EWorkerStatus.disponible,
        providerState: waState,
        degradedReason: 'missing_local_session',
        authenticated: false,
        canReceiveRuntime: true,
        lastProbeAt,
        probeLatencyMs: Date.now() - probeStartedAt,
        phone: selfPhone,
      });
    }

    if (!(await this.isStoreReady(client))) {
      return this.buildResult({
        isHealthy: true,
        reason: 'Connected state but Store WWebJS is not ready',
        detectedStatus: Status.connecting,
        workerStatus: EWorkerStatus.disponible,
        providerState: waState,
        degradedReason: 'store_wwebjs_not_ready',
        authenticated: true,
        canReceiveRuntime: true,
        lastProbeAt,
        probeLatencyMs: Date.now() - probeStartedAt,
        phone: selfPhone,
      });
    }

    try {
      await this.runProbe(client, selfJid);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return this.buildResult({
        isHealthy: true,
        reason: `Session probe failed: ${reason}`,
        detectedStatus: Status.connecting,
        workerStatus: EWorkerStatus.disponible,
        providerState: waState,
        degradedReason: reason,
        authenticated: true,
        canReceiveRuntime: true,
        lastProbeAt,
        probeLatencyMs: Date.now() - probeStartedAt,
        phone: selfPhone,
      });
    }

    return this.buildResult({
      isHealthy: true,
      reason: 'Session ready',
      detectedStatus: Status.connected,
      workerStatus: EWorkerStatus.online,
      waState,
      sessionReady: true,
      canSend: true,
      canReceiveRuntime: true,
      authenticated: true,
      providerState: waState,
      lastProbeAt,
      probeLatencyMs: Date.now() - probeStartedAt,
      phone: selfPhone,
    });
  }

  private async isStoreReady(client: Client): Promise<boolean> {
    const page = (client as unknown as { pupPage?: unknown }).pupPage as
      | { evaluate?: (fn: () => boolean) => Promise<boolean> }
      | undefined;

    if (!page || typeof page.evaluate !== 'function') {
      return false;
    }

    try {
      return await this.withProbeTimeout(
        Promise.resolve(
          page.evaluate(() => {
            const scope = globalThis as unknown as {
              Store?: { WWebJS?: unknown };
              WWebJS?: unknown;
            };

            return Boolean(scope.Store?.WWebJS || scope.WWebJS);
          })
        ),
        'store_wwebjs'
      );
    } catch {
      return false;
    }
  }

  private async runProbe(client: Client, selfJid: string): Promise<void> {
    const selfPhone = getPhoneNumber(selfJid);
    const probeClient = client as Client & {
      getNumberId?: (phone: string) => Promise<unknown>;
      isRegisteredUser?: (jid: string) => Promise<boolean>;
    };

    if (selfPhone && typeof probeClient.getNumberId === 'function') {
      const numberId = await this.withProbeTimeout(
        Promise.resolve(probeClient.getNumberId(selfPhone)),
        'getNumberId'
      );

      if (numberId) {
        return;
      }
    }

    if (typeof probeClient.isRegisteredUser === 'function') {
      const registered = await this.withProbeTimeout(
        Promise.resolve(probeClient.isRegisteredUser(selfJid)),
        'isRegisteredUser'
      );

      if (registered !== true) {
        throw new Error('self_jid_not_registered');
      }
      return;
    }

    throw new Error('registration_probe_unavailable');
  }

  private withProbeTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`${label}_timeout`));
      }, STATE_CHECK_TIMEOUT_MS);

      promise
        .then((value) => {
          clearTimeout(timeout);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  private buildResult(input: {
    isHealthy: boolean;
    reason?: string;
    detectedStatus: Status;
    workerStatus: EWorkerStatus;
    waState?: WAState;
    sessionReady?: boolean;
    canSend?: boolean;
    canReceiveRuntime?: boolean;
    authenticated?: boolean;
    providerState: string;
    degradedReason?: string;
    lastProbeAt?: string;
    probeLatencyMs?: number;
    phone?: string;
  }): HealthCheckResult {
    const sessionReady = input.sessionReady === true;
    const degradedReason =
      input.degradedReason ??
      (sessionReady ? undefined : (input.reason ?? input.providerState));

    return {
      isHealthy: input.isHealthy,
      reason: input.reason,
      detectedStatus: input.detectedStatus,
      workerStatus: input.workerStatus,
      waState: input.waState,
      session_ready: sessionReady,
      can_send: input.canSend ?? sessionReady,
      can_receive_runtime: input.canReceiveRuntime ?? false,
      authenticated: input.authenticated ?? false,
      provider_state: input.providerState,
      degraded_reason: degradedReason,
      last_probe_at: input.lastProbeAt ?? new Date().toISOString(),
      probe_latency_ms: input.probeLatencyMs ?? 0,
      phone: input.phone,
    };
  }

  private async notifyStatusChange(
    client: Client | undefined,
    result: HealthCheckResult
  ): Promise<void> {
    const payload: IBaileysConnectionState = {
      status: result.detectedStatus,
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.wwebjs,
      code: result.session_ready
        ? ECodeMessage.connectionEstablished
        : result.detectedStatus === Status.connecting
          ? ECodeMessage.awaitConnection
          : ECodeMessage.connectionLost,
      phone: getPhoneNumber(client?.info?.wid?._serialized),
      worker_status_id: result.workerStatus,
      session_ready: result.session_ready,
      can_send: result.can_send,
      can_receive_runtime: result.can_receive_runtime,
      authenticated: result.authenticated,
      provider_state: result.provider_state,
      degraded_reason: result.degraded_reason,
      last_probe_at: result.last_probe_at,
      probe_latency_ms: result.probe_latency_ms,
    };

    logLocalConnectionStatus('wwebjs.health_check.notify_status', {
      layer: 'wwebjs.health',
      provider: 'wwebjs',
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      worker_type_id: payload.worker_type_id,
      worker_status_id: payload.worker_status_id,
      status: payload.status,
      code: payload.code,
      session_ready: payload.session_ready,
      can_send: payload.can_send,
      can_receive_runtime: payload.can_receive_runtime,
      authenticated: payload.authenticated,
      provider_state: payload.provider_state,
      degraded_reason: payload.degraded_reason,
      phone: payload.phone,
      reason: result.reason,
      wa_state: result.waState,
    });

    try {
      await this.centrifugo.publishSub(getChannel(), payload);
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

    const isConnected = result.session_ready;
    const phone = getPhoneNumber(client?.info?.wid?._serialized);

    await this.saveLogWppConnection({
      worker_id: getWorker(),
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

    const documentId = buildWppConnectionDocumentId(
      getAccount(),
      wppLog.worker_id
    );

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
