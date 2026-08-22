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
import { getPhoneNumber } from '@core/common/functions/getPhoneNumber';
import { buildWppConnectionDocumentId } from '@core/common/functions/buildWppConnectionDocumentId';
import { wppConnectionMappings } from '@core/mappings/wppConnection.mappings';
import type { IBaileysConnection } from '@core/common/interfaces/IBaileysConnection';
import { logLocalConnectionStatus } from '@core/common/functions/localConnectionStatusLog';
import {
  ProviderAuxiliaryInvocationInFlightError,
  ProviderAuxiliaryInvocationSingleFlight,
  ProviderAuxiliaryInvocationTimeoutError,
  invokeProviderAuxiliaryWithTimeout,
} from '@core/common/functions/providerAuxiliaryInvocation';
import {
  isProviderInvocationCapacityError,
  ProviderInvocationInFlightError,
  ProviderInvocationSingleFlight,
} from '@core/common/functions/providerInvocationSingleFlight';
import {
  workerErrorDiagnostics,
  workerErrorFailureReason,
} from '@core/common/functions/workerErrorDiagnostics';

const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 30_000;
const STATE_CHECK_TIMEOUT_MS = 10_000;
const CANONICAL_CHECKPOINT_PROVIDER_DRAIN_GRACE_MS = STATE_CHECK_TIMEOUT_MS;
const CANONICAL_CHECKPOINT_PROVIDER_DRAIN_POLL_MS = 250;
const BOOTSTRAP_ORCHESTRATOR_GRACE_MS = 15_000;
const TRANSIENT_DISCONNECT_THRESHOLD = 2;
const CONNECTION_LAUNCHING_STATES = new Set<WAState>([
  'UNLAUNCHED',
  'OPENING',
  'PAIRING',
]);

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

function isProviderProbeBackpressure(error: unknown): boolean {
  return (
    isProviderInvocationCapacityError(error) ||
    error instanceof ProviderAuxiliaryInvocationInFlightError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code ===
        'WHATSAPP_PROVIDER_AUXILIARY_IN_FLIGHT')
  );
}

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
  runtime_generation?: number;
  process_replacement_required: boolean;
}

export type WwebjsProviderProbeGate =
  | boolean
  | {
      allowed: boolean;
      state:
        | 'initializing'
        | 'canonical_activation_checkpoint'
        | 'initialization_failed'
        | 'initialization_timeout'
        | 'cancellation_requested';
      processReplacementRequired?: boolean;
    };

export interface WwebjsCanonicalActivationCheckpointState {
  readonly inProgress: boolean;
  readonly generation?: number;
}

interface WwebjsCanonicalCheckpointDeferredProviderCall {
  readonly token: symbol;
  readonly client: Client;
  readonly operationKey: string;
  readonly providerCall: Promise<unknown>;
  readonly timeoutError: ProviderAuxiliaryInvocationTimeoutError;
  readonly markStalled: () => void;
  readonly deferredAtMs: number;
  checkpointGeneration?: number;
  postCheckpointDeadlineMs?: number;
  recoveryTimer?: NodeJS.Timeout;
}

interface WwebjsHealthCheckConfig {
  getClient: () => Client | undefined;
  getStatus: () => Status;
  getCode: () => ECodeMessage;
  reconnect: (input: IBaileysConnection) => void;
  isConnected: () => boolean;
  isNativeConnectionOnline?: (client: Client) => boolean;
  prepareSession?: () => Promise<void | boolean>;
  hasSession: () => boolean;
  hasCentralOnlineAcknowledgement?: () => boolean;
  isEventBridgeAttached?: (client?: Client) => boolean;
  getRuntimeFenceIdentity?: () => {
    connection_epoch: string;
    connection_sequence: number;
  } | null;
  getCanonicalActivationCheckpointState?: (
    client: Client
  ) => WwebjsCanonicalActivationCheckpointState;
  isProviderProbeAllowed?: (client: Client) => WwebjsProviderProbeGate;
  onStatusMismatch?: (detected: Status, workerStatus: EWorkerStatus) => void;
  onProviderProbeTimeout?: (client: Client, error: unknown) => void;
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
  private isNativeConnectionOnlineAction:
    ((client: Client) => boolean) | undefined;
  private prepareSessionAction: (() => Promise<void | boolean>) | undefined;
  private hasSessionAction: (() => boolean) | undefined;
  private hasCentralOnlineAcknowledgementAction: (() => boolean) | undefined;
  private isEventBridgeAttachedAction:
    ((client?: Client) => boolean) | undefined;
  private runtimeFenceIdentityGetter:
    | (() => {
        connection_epoch: string;
        connection_sequence: number;
      } | null)
    | undefined;
  private canonicalActivationCheckpointStateGetter:
    ((client: Client) => WwebjsCanonicalActivationCheckpointState) | undefined;
  private isProviderProbeAllowedAction:
    ((client: Client) => WwebjsProviderProbeGate) | undefined;
  private onStatusMismatch:
    ((detected: Status, workerStatus: EWorkerStatus) => void) | undefined;
  private onProviderProbeTimeout:
    ((client: Client, error: unknown) => void) | undefined;
  private readonly providerInvocationFence =
    new ProviderInvocationSingleFlight();
  private readonly providerProbeSingleFlight =
    new ProviderAuxiliaryInvocationSingleFlight();
  private readonly canonicalCheckpointDeferredProviderCalls = new WeakMap<
    Client,
    Map<string, WwebjsCanonicalCheckpointDeferredProviderCall>
  >();
  private readonly canonicalCheckpointDeferredRecoveryTimers =
    new Set<NodeJS.Timeout>();
  private readonly canonicalCheckpointDeferredEntries =
    new Set<WwebjsCanonicalCheckpointDeferredProviderCall>();
  private readonly canonicalCheckpointDeferredRecoveryReported =
    new WeakSet<Client>();
  private bootstrapPromise: Promise<void> | undefined;
  private bootstrapLock = false;
  private bootstrapFallbackTimer: NodeJS.Timeout | undefined;
  private transientDisconnectFailures = 0;
  private lastStrictReady:
    | { client: Client; result: HealthCheckResult; observedAt: number }
    | undefined;
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
    process_replacement_required: false,
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
    this.isNativeConnectionOnlineAction = options.isNativeConnectionOnline;
    this.prepareSessionAction = options.prepareSession;
    this.hasSessionAction = options.hasSession;
    this.hasCentralOnlineAcknowledgementAction =
      options.hasCentralOnlineAcknowledgement;
    this.isEventBridgeAttachedAction = options.isEventBridgeAttached;
    this.runtimeFenceIdentityGetter = options.getRuntimeFenceIdentity;
    this.canonicalActivationCheckpointStateGetter =
      options.getCanonicalActivationCheckpointState;
    this.isProviderProbeAllowedAction = options.isProviderProbeAllowed;
    this.onStatusMismatch = options.onStatusMismatch;
    this.onProviderProbeTimeout = options.onProviderProbeTimeout;
  }

  start(intervalMs = DEFAULT_HEALTH_CHECK_INTERVAL_MS): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.intervalId = setInterval(() => {
      void this.runHealthCheck();
    }, intervalMs);
    for (const entry of this.canonicalCheckpointDeferredEntries) {
      this.reconcileCanonicalCheckpointDeferredProviderCall(
        entry.client,
        entry
      );
    }

    console.log(`[WwebjsHealthCheck] Started with interval ${intervalMs}ms`);
  }

  stop(): void {
    this.clearBootstrapFallbackTimer();
    for (const timer of this.canonicalCheckpointDeferredRecoveryTimers) {
      clearTimeout(timer);
    }
    for (const entry of this.canonicalCheckpointDeferredEntries) {
      entry.recoveryTimer = undefined;
    }
    this.canonicalCheckpointDeferredRecoveryTimers.clear();

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
      publishStatus?: boolean;
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
    this.lastStrictReady = undefined;

    if (
      result.detectedStatus !== this.lastKnownStatus ||
      result.workerStatus !== this.lastKnownWorkerStatus
    ) {
      console.log(
        `[WwebjsHealthCheck] Status changed: ${this.lastKnownStatus} -> ${result.detectedStatus}, worker: ${this.lastKnownWorkerStatus} -> ${result.workerStatus}`
      );

      this.lastKnownStatus = result.detectedStatus;
      this.lastKnownWorkerStatus = result.workerStatus;

      if (options.publishStatus !== false) {
        await this.notifyStatusChange(undefined, result);
      }
    }
  }

  resetLastKnownStatus(): void {
    this.lastKnownStatus = Status.initial;
    this.lastKnownWorkerStatus = EWorkerStatus.disponible;
    this.lastStrictReady = undefined;
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

    const reportedStatus = this.statusGetter?.() ?? Status.connected;
    const client = this.clientGetter();
    const result = await this.checkConnectivity(client, reportedStatus);
    this.invalidateStrictReadinessAfterResult(client, result);
    this.lastResult = result;
    return result;
  }

  markStatusPublished(result: HealthCheckResult): void {
    this.invalidateStrictReadinessAfterResult(this.clientGetter?.(), result);
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
    this.invalidateStrictReadinessAfterResult(client, connectivityResult);
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

      if (this.shouldPublishStatusChange(result)) {
        await this.notifyStatusChange(client, result);
        this.lastKnownStatus = result.detectedStatus;
        this.lastKnownWorkerStatus = result.workerStatus;
      } else {
        this.logHealthResult(
          'wwebjs.health_check.soft_transition_deferred',
          result,
          {
            reported_status: reportedStatus,
          }
        );
      }
    }

    if (
      reportedStatus !== result.detectedStatus &&
      this.shouldReportStatusMismatch(result) &&
      this.onStatusMismatch
    ) {
      console.log(
        `[WwebjsHealthCheck] Mismatch detected: reported=${reportedStatus}, actual=${result.detectedStatus}, reason=${result.reason ?? 'unknown'}`
      );
      this.onStatusMismatch(result.detectedStatus, result.workerStatus);
    }

    return result;
  }

  private shouldPublishStatusChange(result: HealthCheckResult): boolean {
    if (!result.session_ready) {
      return !result.isHealthy;
    }

    /*
     * Provider probes do not own the Kafka/runtime activation barrier. Only
     * the connection orchestrator may publish the first online transition,
     * after all consumers are positioned and Balance has acknowledged that
     * exact runtime generation. Periodic health checks may repeat an online
     * state only after that durable acknowledgement already exists.
     */
    return this.hasCentralOnlineAcknowledgementAction?.() === true;
  }

  private shouldReportStatusMismatch(result: HealthCheckResult): boolean {
    return result.session_ready || !result.isHealthy;
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

    let sessionStoreAuthorized = true;
    try {
      sessionStoreAuthorized = (await this.prepareSessionAction?.()) !== false;
    } catch (error) {
      const reason = workerErrorFailureReason(
        'wwebjs_bootstrap_session_refresh_failed',
        error
      );
      console.error(
        '[WwebjsHealthCheck] Bootstrap session refresh failed',
        workerErrorDiagnostics(error)
      );
      if (this.isConnectedAction?.()) {
        return;
      }
      try {
        await this.notifyDisconnected(reason, {
          workerStatus: EWorkerStatus.offline,
          detectedStatus: Status.disconnected,
          providerState: 'bootstrap_session_refresh_failed',
        });
      } catch (reportError) {
        console.error(
          '[WwebjsHealthCheck] Failed to report bootstrap session refresh failure',
          workerErrorDiagnostics(reportError)
        );
      }
      throw new Error(reason);
    }

    if (!sessionStoreAuthorized) {
      console.log(
        '[WwebjsHealthCheck] Auth store dormant. Waiting for an authorized QR grant.'
      );
      await this.notifyDisponibleStatus(
        'Waiting for an authorized QR connection grant'
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

      try {
        this.reconnectAction?.({
          initial_connection: true,
          requested_by_user: false,
          from_disconnect_restart: true,
          runtime_generation: wwebjsEnvironment.runtimeGeneration,
        });
        console.log('[WwebjsHealthCheck] fallback_triggered');
      } catch (error) {
        console.error('[WwebjsHealthCheck] fallback_trigger_error', {
          ...workerErrorDiagnostics(error),
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
      runtime_generation: wwebjsEnvironment.runtimeGeneration,
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
        workerErrorDiagnostics(error)
      );
    }

    console.log(`[WwebjsHealthCheck] ${reason}`);
  }

  private async checkConnectivity(
    client: Client | undefined,
    reportedStatus: Status
  ): Promise<HealthCheckResult> {
    if (!client) {
      if (reportedStatus === Status.connecting) {
        return this.buildResult({
          isHealthy: true,
          reason: 'Connection is launching (client not ready yet)',
          detectedStatus: Status.connecting,
          workerStatus: EWorkerStatus.disponible,
          providerState: 'client_launching',
          degradedReason: 'connection_launching',
        });
      }

      return this.buildResult({
        isHealthy: false,
        reason: 'No client instance',
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
        providerState: 'missing_client',
      });
    }

    const providerProbeGate = this.resolveProviderProbeGate(client);
    if (!providerProbeGate.allowed) {
      const connectionLaunching =
        providerProbeGate.state === 'initializing' ||
        providerProbeGate.state === 'canonical_activation_checkpoint';
      if (!connectionLaunching) {
        const initializationTimedOut =
          providerProbeGate.state === 'initialization_timeout';
        return this.buildResult({
          isHealthy: false,
          reason: initializationTimedOut
            ? 'Client initialization exceeded its safety deadline'
            : providerProbeGate.state === 'initialization_failed'
              ? 'Client initialization failed'
              : 'Client initialization was cancelled',
          detectedStatus: Status.disconnected,
          workerStatus: EWorkerStatus.offline,
          providerState: providerProbeGate.state,
          degradedReason: providerProbeGate.state,
          processReplacementRequired:
            providerProbeGate.processReplacementRequired,
        });
      }

      const canonicalCheckpointInProgress =
        providerProbeGate.state === 'canonical_activation_checkpoint';
      return this.buildResult({
        isHealthy: true,
        reason: canonicalCheckpointInProgress
          ? 'Connection is launching (canonical activation checkpoint in progress)'
          : 'Connection is launching (client initialization pending)',
        detectedStatus: Status.connecting,
        workerStatus: EWorkerStatus.disponible,
        providerState: canonicalCheckpointInProgress
          ? 'canonical_activation_checkpoint'
          : 'client_initializing',
        degradedReason: canonicalCheckpointInProgress
          ? 'canonical_activation_checkpoint'
          : 'connection_launching',
      });
    }

    let waState: WAState | undefined;
    try {
      waState = await this.getStateWithTimeout(client);
    } catch (error) {
      if (isProviderProbeBackpressure(error)) {
        return this.resolveProviderProbeBackpressure(
          client,
          'State probe deferred while provider capacity is saturated'
        );
      }
      if (reportedStatus === Status.connecting) {
        return this.buildResult({
          isHealthy: true,
          reason: 'Connection is launching (state probe failed)',
          detectedStatus: Status.connecting,
          workerStatus: EWorkerStatus.disponible,
          providerState: 'state_probe_pending',
          degradedReason: 'connection_launching',
        });
      }

      return this.buildResult({
        isHealthy: false,
        reason: 'Failed to get state',
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
        providerState: 'state_error',
        degradedReason: `state_probe_failed:${workerErrorDiagnostics(error).error_code}`,
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

    if (
      reportedStatus === Status.connecting &&
      CONNECTION_LAUNCHING_STATES.has(waState)
    ) {
      return this.buildResult({
        isHealthy: true,
        reason: `Connection is launching (${waState})`,
        detectedStatus: Status.connecting,
        workerStatus: EWorkerStatus.disponible,
        waState,
        providerState: waState,
        degradedReason: 'connection_launching',
      });
    }

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

  private resolveProviderProbeGate(client: Client): {
    allowed: boolean;
    state:
      | 'initializing'
      | 'canonical_activation_checkpoint'
      | 'initialization_failed'
      | 'initialization_timeout'
      | 'cancellation_requested';
    processReplacementRequired: boolean;
  } {
    const gate = this.isProviderProbeAllowedAction?.(client);
    if (gate === undefined || gate === true) {
      return {
        allowed: true,
        state: 'initializing',
        processReplacementRequired: false,
      };
    }
    if (gate === false) {
      return {
        allowed: false,
        state: 'initializing',
        processReplacementRequired: false,
      };
    }
    return {
      allowed: gate.allowed,
      state: gate.state,
      processReplacementRequired: gate.processReplacementRequired === true,
    };
  }

  private resolveCanonicalActivationCheckpointState(
    client: Client
  ): WwebjsCanonicalActivationCheckpointState {
    if (!this.canonicalActivationCheckpointStateGetter) {
      return { inProgress: false };
    }

    try {
      const state = this.canonicalActivationCheckpointStateGetter(client);
      if (!state || typeof state.inProgress !== 'boolean') {
        return { inProgress: true };
      }
      if (state.generation === undefined) {
        return { inProgress: state.inProgress };
      }
      if (
        !Number.isSafeInteger(state.generation) ||
        (state.generation as number) < 0
      ) {
        return { inProgress: true };
      }
      return {
        inProgress: state.inProgress,
        generation: state.generation,
      };
    } catch {
      return { inProgress: true };
    }
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
      process_replacement_required: result.process_replacement_required,
      ...extra,
    });
  }

  private isTransientDisconnectResult(
    result: HealthCheckResult,
    reportedStatus: Status
  ): boolean {
    if (result.process_replacement_required) {
      return false;
    }

    if (reportedStatus !== Status.connected) {
      return false;
    }

    const reason = result.reason ?? '';

    const transientConnectedReadinessFailure =
      result.detectedStatus === Status.connecting &&
      result.workerStatus === EWorkerStatus.disponible &&
      (result.degraded_reason === 'missing_client_info' ||
        result.degraded_reason === 'event_bridge_not_attached' ||
        result.degraded_reason === 'store_wwebjs_not_ready' ||
        result.degraded_reason === 'session_probe_failed');

    if (transientConnectedReadinessFailure) {
      return true;
    }

    if (
      result.detectedStatus !== Status.disconnected ||
      result.workerStatus !== EWorkerStatus.offline
    ) {
      return false;
    }

    return (
      reason.startsWith('Failed to get state:') ||
      reason === 'Failed to get state' ||
      reason === 'State not available' ||
      reason === 'Connected state but no client info' ||
      reason === 'Connection timeout' ||
      reason === 'Client not launched' ||
      reason.startsWith('Unknown state:')
    );
  }

  private getStateWithTimeout(client: Client): Promise<WAState | undefined> {
    return this.invokeProviderProbe(client, 'getState', async () => {
      const state = await client.getState();
      return state as WAState | undefined;
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
        isHealthy: false,
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
        isHealthy: false,
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
        isHealthy: false,
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

    const storeReady = await this.isStoreReady(client);
    if (storeReady === undefined) {
      return this.resolveProviderProbeBackpressure(
        client,
        'Store readiness probe deferred while provider capacity is saturated'
      );
    }

    if (!storeReady) {
      return this.buildResult({
        isHealthy: false,
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
      if (isProviderProbeBackpressure(error)) {
        return this.resolveProviderProbeBackpressure(
          client,
          'Self readiness probe deferred while provider capacity is saturated'
        );
      }

      return this.buildResult({
        isHealthy: false,
        reason: 'Session probe failed',
        detectedStatus: Status.connecting,
        workerStatus: EWorkerStatus.disponible,
        providerState: waState,
        degradedReason: 'session_probe_failed',
        authenticated: true,
        canReceiveRuntime: true,
        lastProbeAt,
        probeLatencyMs: Date.now() - probeStartedAt,
        phone: selfPhone,
      });
    }

    const result = this.buildResult({
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
    this.lastStrictReady = {
      client,
      result,
      observedAt: Date.now(),
    };
    return result;
  }

  private getRecentStrictReadiness(
    client: Client
  ): HealthCheckResult | undefined {
    const cached = this.lastStrictReady;
    const currentConnectionProven =
      this.isConnectedAction?.() === true ||
      this.isNativeConnectionOnline(client);
    if (
      !cached ||
      cached.client !== client ||
      !currentConnectionProven ||
      Date.now() - cached.observedAt > DEFAULT_HEALTH_CHECK_INTERVAL_MS * 2
    ) {
      return undefined;
    }

    return cached.result;
  }

  private isNativeConnectionOnline(client: Client): boolean {
    if (!this.isNativeConnectionOnlineAction) {
      return false;
    }

    try {
      return this.isNativeConnectionOnlineAction(client) === true;
    } catch {
      return false;
    }
  }

  private resolveProviderProbeBackpressure(
    client: Client,
    reason: string
  ): HealthCheckResult {
    const retainedReadiness = this.getRecentStrictReadiness(client);
    if (retainedReadiness) {
      return {
        ...retainedReadiness,
        reason: `Session readiness retained. ${reason}`,
      };
    }

    // Admission backpressure is not evidence that the provider went offline.
    // Strong readiness remains false, but central status must not be demoted
    // solely because healthy SDK calls are already in flight.
    return this.buildResult({
      isHealthy: true,
      reason,
      detectedStatus: Status.connecting,
      workerStatus: EWorkerStatus.disponible,
      providerState: 'probe_deferred_backpressure',
      degradedReason: 'provider_capacity_saturated',
      authenticated: false,
      canReceiveRuntime: false,
      canSend: false,
    });
  }

  private invalidateStrictReadinessAfterResult(
    client: Client | undefined,
    result: HealthCheckResult
  ): void {
    if (
      result.session_ready ||
      result.degraded_reason === 'provider_capacity_saturated'
    ) {
      return;
    }

    if (!client || this.lastStrictReady?.client === client) {
      this.lastStrictReady = undefined;
    }
  }

  private async isStoreReady(client: Client): Promise<boolean | undefined> {
    const page = (client as unknown as { pupPage?: unknown }).pupPage as
      { evaluate?: (fn: () => boolean) => Promise<boolean> } | undefined;

    if (!page || typeof page.evaluate !== 'function') {
      return false;
    }
    const evaluate = page.evaluate.bind(page);

    try {
      return await this.invokeProviderProbe(client, 'store_wwebjs', () =>
        evaluate(() => {
          const scope = globalThis as unknown as {
            Store?: { WWebJS?: unknown };
            WWebJS?: unknown;
          };

          return Boolean(scope.Store?.WWebJS || scope.WWebJS);
        })
      );
    } catch (error) {
      if (isProviderProbeBackpressure(error)) {
        return undefined;
      }
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
      const getNumberId = probeClient.getNumberId.bind(probeClient);
      const numberId = await this.invokeProviderProbe(
        client,
        'getNumberId',
        () => getNumberId(selfPhone)
      );

      if (numberId) {
        return;
      }
    }

    if (typeof probeClient.isRegisteredUser === 'function') {
      const isRegisteredUser = probeClient.isRegisteredUser.bind(probeClient);
      const registered = await this.invokeProviderProbe(
        client,
        'isRegisteredUser',
        () => isRegisteredUser(selfJid)
      );

      if (registered !== true) {
        throw new Error('self_jid_not_registered');
      }
      return;
    }

    throw new Error('registration_probe_unavailable');
  }

  private clearCanonicalCheckpointDeferredProviderCall(
    client: Client,
    operationKey: string,
    token: symbol
  ): boolean {
    const operations =
      this.canonicalCheckpointDeferredProviderCalls.get(client);
    const entry = operations?.get(operationKey);
    if (!entry || entry.token !== token) {
      return false;
    }
    if (entry.recoveryTimer) {
      clearTimeout(entry.recoveryTimer);
      this.canonicalCheckpointDeferredRecoveryTimers.delete(
        entry.recoveryTimer
      );
      entry.recoveryTimer = undefined;
    }
    operations?.delete(operationKey);
    this.canonicalCheckpointDeferredEntries.delete(entry);
    if (operations?.size === 0) {
      this.canonicalCheckpointDeferredProviderCalls.delete(client);
    }
    return true;
  }

  private scheduleCanonicalCheckpointDeferredProviderCallRecovery(
    client: Client,
    entry: WwebjsCanonicalCheckpointDeferredProviderCall,
    delayMs: number
  ): void {
    if (entry.recoveryTimer) {
      clearTimeout(entry.recoveryTimer);
      this.canonicalCheckpointDeferredRecoveryTimers.delete(
        entry.recoveryTimer
      );
    }
    const timer = setTimeout(
      () => {
        this.canonicalCheckpointDeferredRecoveryTimers.delete(timer);
        if (entry.recoveryTimer === timer) {
          entry.recoveryTimer = undefined;
        }
        this.reconcileCanonicalCheckpointDeferredProviderCall(client, entry);
      },
      Math.max(1, delayMs)
    );
    timer.unref?.();
    entry.recoveryTimer = timer;
    this.canonicalCheckpointDeferredRecoveryTimers.add(timer);
  }

  private reconcileCanonicalCheckpointDeferredProviderCall(
    client: Client,
    entry: WwebjsCanonicalCheckpointDeferredProviderCall
  ): void {
    const currentEntry = this.canonicalCheckpointDeferredProviderCalls
      .get(client)
      ?.get(entry.operationKey);
    if (currentEntry?.token !== entry.token) {
      return;
    }
    if (this.clientGetter && this.clientGetter() !== client) {
      this.clearCanonicalCheckpointDeferredProviderCall(
        client,
        entry.operationKey,
        entry.token
      );
      return;
    }

    const checkpointState =
      this.resolveCanonicalActivationCheckpointState(client);
    if (checkpointState.inProgress) {
      entry.checkpointGeneration = checkpointState.generation;
      entry.postCheckpointDeadlineMs = undefined;
      this.scheduleCanonicalCheckpointDeferredProviderCallRecovery(
        client,
        entry,
        CANONICAL_CHECKPOINT_PROVIDER_DRAIN_POLL_MS
      );
      return;
    }

    if (
      checkpointState.generation !== undefined &&
      checkpointState.generation !== entry.checkpointGeneration
    ) {
      entry.checkpointGeneration = checkpointState.generation;
      entry.postCheckpointDeadlineMs = undefined;
    }
    const nowMs = Date.now();
    entry.postCheckpointDeadlineMs ??=
      nowMs + CANONICAL_CHECKPOINT_PROVIDER_DRAIN_GRACE_MS;
    if (nowMs < entry.postCheckpointDeadlineMs) {
      this.scheduleCanonicalCheckpointDeferredProviderCallRecovery(
        client,
        entry,
        entry.postCheckpointDeadlineMs - nowMs
      );
      return;
    }

    if (
      !this.clearCanonicalCheckpointDeferredProviderCall(
        client,
        entry.operationKey,
        entry.token
      )
    ) {
      return;
    }
    entry.markStalled();
    this.canonicalCheckpointDeferredRecoveryReported.add(client);
    this.onProviderProbeTimeout?.(client, entry.timeoutError);
  }

  private trackCanonicalCheckpointDeferredProviderCall(
    client: Client,
    operationKey: string,
    providerCall: Promise<unknown>,
    timeoutError: ProviderAuxiliaryInvocationTimeoutError,
    markStalled: () => void,
    checkpointState: WwebjsCanonicalActivationCheckpointState
  ): void {
    const operations =
      this.canonicalCheckpointDeferredProviderCalls.get(client) ?? new Map();
    const previousEntry = operations.get(operationKey);
    if (previousEntry) {
      this.clearCanonicalCheckpointDeferredProviderCall(
        client,
        operationKey,
        previousEntry.token
      );
    }
    const token = Symbol(operationKey);
    const entry: WwebjsCanonicalCheckpointDeferredProviderCall = {
      token,
      client,
      operationKey,
      providerCall,
      timeoutError,
      markStalled,
      deferredAtMs: Date.now(),
      checkpointGeneration: checkpointState.generation,
      ...(checkpointState.inProgress
        ? {}
        : {
            postCheckpointDeadlineMs:
              Date.now() + CANONICAL_CHECKPOINT_PROVIDER_DRAIN_GRACE_MS,
          }),
    };
    operations.set(operationKey, entry);
    this.canonicalCheckpointDeferredEntries.add(entry);
    this.canonicalCheckpointDeferredProviderCalls.set(client, operations);
    const clearIfOwner = (): void => {
      this.clearCanonicalCheckpointDeferredProviderCall(
        client,
        operationKey,
        token
      );
    };
    void providerCall.then(clearIfOwner, clearIfOwner);
    this.reconcileCanonicalCheckpointDeferredProviderCall(client, entry);
  }

  private async invokeProviderProbe<T>(
    client: Client,
    operation: string,
    invoke: () => Promise<T>
  ): Promise<T> {
    const operationKey = `health:${operation}`;
    const checkpointAtAdmission =
      this.resolveCanonicalActivationCheckpointState(client);
    if (checkpointAtAdmission.inProgress) {
      throw new ProviderAuxiliaryInvocationInFlightError(
        `${operationKey}:canonical_activation_checkpoint`
      );
    }
    const providerProbeGate = this.resolveProviderProbeGate(client);
    if (!providerProbeGate.allowed) {
      throw new ProviderAuxiliaryInvocationInFlightError(
        `${operationKey}:${providerProbeGate.state}`
      );
    }

    const runtimeLease = this.providerInvocationFence.acquire(client);
    if (!runtimeLease) {
      const stalled = this.providerInvocationFence.isStalled(client);
      const error = new ProviderInvocationInFlightError(
        stalled ? 'stalled' : 'capacity'
      );
      if (
        stalled &&
        !this.canonicalCheckpointDeferredRecoveryReported.has(client)
      ) {
        this.onProviderProbeTimeout?.(client, error);
      }
      throw error;
    }

    const operationLease = this.providerProbeSingleFlight.acquire(
      client,
      operationKey
    );
    if (!operationLease) {
      runtimeLease.releaseBeforeStart();
      const deferredEntry = this.canonicalCheckpointDeferredProviderCalls
        .get(client)
        ?.get(operationKey);
      if (deferredEntry && !deferredEntry.recoveryTimer) {
        this.reconcileCanonicalCheckpointDeferredProviderCall(
          client,
          deferredEntry
        );
      }
      throw new ProviderAuxiliaryInvocationInFlightError(operationKey);
    }

    const providerCall = operationLease.start(() => runtimeLease.start(invoke));
    try {
      const result = await invokeProviderAuxiliaryWithTimeout({
        provider: 'wwebjs',
        operation: operationKey,
        timeoutMs: STATE_CHECK_TIMEOUT_MS,
        invoke: () => providerCall,
      });
      const checkpointAtSettlement =
        this.resolveCanonicalActivationCheckpointState(client);
      if (
        checkpointAtSettlement.inProgress ||
        (checkpointAtAdmission.generation !== undefined &&
          checkpointAtSettlement.generation !== undefined &&
          checkpointAtAdmission.generation !==
            checkpointAtSettlement.generation)
      ) {
        throw new ProviderAuxiliaryInvocationInFlightError(
          `${operationKey}:canonical_activation_checkpoint`
        );
      }
      return result;
    } catch (error) {
      if (error instanceof ProviderAuxiliaryInvocationInFlightError) {
        throw error;
      }
      const checkpointAtOutcome =
        this.resolveCanonicalActivationCheckpointState(client);
      const outcomeGate = this.resolveProviderProbeGate(client);
      const checkpointOverlapped =
        checkpointAtOutcome.inProgress ||
        (checkpointAtAdmission.generation !== undefined &&
          checkpointAtOutcome.generation !== undefined &&
          checkpointAtAdmission.generation !==
            checkpointAtOutcome.generation) ||
        (!outcomeGate.allowed &&
          outcomeGate.state === 'canonical_activation_checkpoint');
      if (checkpointOverlapped) {
        if (error instanceof ProviderAuxiliaryInvocationTimeoutError) {
          this.trackCanonicalCheckpointDeferredProviderCall(
            client,
            operationKey,
            providerCall,
            error,
            () => runtimeLease.markStalled(),
            checkpointAtOutcome
          );
        }
        throw new ProviderAuxiliaryInvocationInFlightError(
          `${operationKey}:canonical_activation_checkpoint`
        );
      }
      if (error instanceof ProviderAuxiliaryInvocationTimeoutError) {
        runtimeLease.markStalled();
        this.onProviderProbeTimeout?.(client, error);
      }
      throw error;
    }
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
    processReplacementRequired?: boolean;
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
      runtime_generation: wwebjsEnvironment.runtimeGeneration,
      process_replacement_required: input.processReplacementRequired === true,
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
      runtime_generation: wwebjsEnvironment.runtimeGeneration,
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
      ...(this.runtimeFenceIdentityGetter?.() ?? {}),
    };

    logLocalConnectionStatus('wwebjs.health_check.notify_status', {
      layer: 'wwebjs.health',
      provider: 'wwebjs',
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      worker_type_id: payload.worker_type_id,
      runtime_generation: payload.runtime_generation,
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
      await this.balanceWorkerStatusGrpcClientService.notifyWorkerStatus(
        payload
      );
    } catch (error) {
      console.error(
        '[WwebjsHealthCheck] Failed to notify balance worker status',
        workerErrorDiagnostics(error)
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
