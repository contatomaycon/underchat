import type { WASocket } from '@whiskeysockets/baileys';
import type WebSocket from 'ws';
import { singleton, inject } from 'tsyringe';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { baileysEnvironment } from '@core/config/environments';
import { EBaileysConnectionStatus as Status } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { EWppConnection } from '@core/common/enums/EWppConnection';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import type { IBaileysConnection } from '@core/common/interfaces/IBaileysConnection';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { BalanceWorkerStatusGrpcClientService } from '@core/services/balanceWorkerStatusGrpcClient.service';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { getPhoneNumber } from '@core/common/functions/getPhoneNumber';
import { buildWppConnectionDocumentId } from '@core/common/functions/buildWppConnectionDocumentId';
import { wppConnectionMappings } from '@core/mappings/wppConnection.mappings';
import { logLocalConnectionStatus } from '@core/common/functions/localConnectionStatusLog';

const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 30_000;
const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
const TRANSIENT_DISCONNECT_THRESHOLD = 3;

function getChannel(): string {
  return workerCentrifugoQueue(baileysEnvironment.baileysAccountId);
}

function getWorker(): string {
  return baileysEnvironment.baileysWorkerId;
}

function getAccount(): string {
  return baileysEnvironment.baileysAccountId;
}

interface HealthCheckResult {
  isHealthy: boolean;
  reason?: string;
  detectedStatus: Status;
  workerStatus: EWorkerStatus;
  session_ready: boolean;
  can_send: boolean;
  can_receive_runtime: boolean;
  authenticated: boolean;
  provider_state: string;
  degraded_reason?: string;
  last_probe_at: string;
  probe_latency_ms: number;
}

type SocketStateName = 'open' | 'connecting' | 'closing' | 'closed' | 'unknown';

interface BaileysHealthCheckConfig {
  getSocket: () => WASocket | undefined;
  getStatus: () => Status;
  getCode: () => ECodeMessage;
  reconnect: (input: IBaileysConnection) => void;
  isConnected: () => boolean;
  hasSession: () => boolean;
  isIncomingBound?: (socket?: WASocket) => boolean;
  onStatusMismatch?: (detected: Status, workerStatus: EWorkerStatus) => void;
}

@singleton()
export class BaileysHealthCheckService {
  private intervalId: NodeJS.Timeout | undefined;
  private lastKnownStatus: Status = Status.initial;
  private lastKnownWorkerStatus: EWorkerStatus = EWorkerStatus.disponible;
  private isRunning = false;
  private socketGetter: (() => WASocket | undefined) | undefined;
  private statusGetter: (() => Status) | undefined;
  private codeGetter: (() => ECodeMessage) | undefined;
  private reconnectAction: ((input: IBaileysConnection) => void) | undefined;
  private isConnectedAction: (() => boolean) | undefined;
  private hasSessionAction: (() => boolean) | undefined;
  private isIncomingBoundAction: ((socket?: WASocket) => boolean) | undefined;
  private onStatusMismatch:
    | ((detected: Status, workerStatus: EWorkerStatus) => void)
    | undefined;
  private bootstrapPromise: Promise<void> | undefined;
  private bootstrapLock = false;
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

  configure(options: BaileysHealthCheckConfig): void {
    this.socketGetter = options.getSocket;
    this.statusGetter = options.getStatus;
    this.codeGetter = options.getCode;
    this.reconnectAction = options.reconnect;
    this.isConnectedAction = options.isConnected;
    this.hasSessionAction = options.hasSession;
    this.isIncomingBoundAction = options.isIncomingBound;
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

    console.log(`[BaileysHealthCheck] Started with interval ${intervalMs}ms`);
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    this.isRunning = false;
    console.log('[BaileysHealthCheck] Stopped');
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
        `[BaileysHealthCheck] Status changed: ${this.lastKnownStatus} -> ${result.detectedStatus}, worker: ${this.lastKnownWorkerStatus} -> ${result.workerStatus}`
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
    if (!this.socketGetter) {
      const result = this.buildResult({
        isHealthy: false,
        reason: 'Health check not configured',
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
        providerState: 'not_configured',
      });
      this.lastResult = result;
      this.logHealthResult('baileys.health_check.result', result, {
        reported_status: undefined,
        configured: false,
      });
      return result;
    }

    const result = await this.checkConnectivity(
      this.socketGetter(),
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
    if (!this.socketGetter || !this.statusGetter) {
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

    const socket = this.socketGetter();
    const reportedStatus = this.statusGetter();

    const connectivityResult = await this.checkConnectivity(
      socket,
      reportedStatus
    );
    const result = this.withTransientDisconnectTolerance(
      connectivityResult,
      reportedStatus
    );
    this.lastResult = result;
    this.logHealthResult('baileys.health_check.result', result, {
      reported_status: reportedStatus,
      transient_disconnect_failures: this.transientDisconnectFailures,
    });

    if (
      result.detectedStatus !== this.lastKnownStatus ||
      result.workerStatus !== this.lastKnownWorkerStatus
    ) {
      console.log(
        `[BaileysHealthCheck] Status changed: ${this.lastKnownStatus} -> ${result.detectedStatus}, worker: ${this.lastKnownWorkerStatus} -> ${result.workerStatus}`
      );

      this.lastKnownStatus = result.detectedStatus;
      this.lastKnownWorkerStatus = result.workerStatus;

      await this.notifyStatusChange(socket, result);
    }

    if (reportedStatus !== result.detectedStatus && this.onStatusMismatch) {
      console.log(
        `[BaileysHealthCheck] Mismatch detected: reported=${reportedStatus}, actual=${result.detectedStatus}, reason=${result.reason ?? 'unknown'}`
      );
      this.onStatusMismatch(result.detectedStatus, result.workerStatus);
    }

    return result;
  }

  private async runBootstrapConnection(): Promise<void> {
    if (!this.hasBootstrapConfig()) {
      console.warn(
        '[BaileysHealthCheck] bootstrapConnection skipped: service not configured'
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
        '[BaileysHealthCheck] No restorable session found. Waiting for user QR request.'
      );
      await this.notifyDisponibleStatus('No restorable session on bootstrap');
      return;
    }

    if (currentStatus === Status.connecting && awaitingUserAction) {
      console.log(
        '[BaileysHealthCheck] Bootstrap resolved while awaiting pairing/user action.'
      );
      return;
    }

    try {
      this.reconnectAction?.({
        initial_connection: true,
        requested_by_user: false,
        from_disconnect_restart: true,
      });
    } catch (error) {
      console.error('[BaileysHealthCheck] Bootstrap reconnect trigger failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
      worker_type_id: EWorkerType.baileys,
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
        '[BaileysHealthCheck] Failed to notify available worker status during bootstrap',
        error
      );
    }

    console.log(`[BaileysHealthCheck] ${reason}`);
  }

  private async checkConnectivity(
    socket: WASocket | undefined,
    reportedStatus: Status
  ): Promise<HealthCheckResult> {
    if (!socket) {
      return this.buildResult({
        isHealthy: false,
        reason: 'No socket instance',
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
        providerState: 'missing_socket',
      });
    }

    const socketState = this.inspectSocketState(socket);

    if (socketState.state === 'open') {
      return this.probeOpenSocket(socket, socketState.reason);
    }

    if (
      socketState.state === 'connecting' ||
      reportedStatus === Status.connecting
    ) {
      return this.buildResult({
        isHealthy: true,
        reason:
          socketState.state === 'connecting'
            ? `Connecting (${socketState.reason})`
            : 'Connecting (reported by service)',
        detectedStatus: Status.connecting,
        workerStatus: EWorkerStatus.disponible,
        providerState: 'connecting',
      });
    }

    return this.buildResult({
      isHealthy: false,
      reason: socketState.reason,
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.offline,
      providerState: socketState.state,
    });
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
      providerState: result.provider_state || 'transient_disconnect',
      degradedReason: result.degraded_reason ?? result.reason,
      authenticated: result.authenticated,
      canReceiveRuntime: result.can_receive_runtime,
      canSend: false,
      lastProbeAt: result.last_probe_at,
      probeLatencyMs: result.probe_latency_ms,
    });
  }

  private logHealthResult(
    event: string,
    result: HealthCheckResult,
    extra: Record<string, unknown> = {}
  ): void {
    logLocalConnectionStatus(event, {
      layer: 'baileys.health',
      provider: 'baileys',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.baileys,
      worker_status_id: result.workerStatus,
      status: result.detectedStatus,
      session_ready: result.session_ready,
      can_send: result.can_send,
      can_receive_runtime: result.can_receive_runtime,
      authenticated: result.authenticated,
      provider_state: result.provider_state,
      degraded_reason: result.degraded_reason,
      reason: result.reason,
      last_probe_at: result.last_probe_at,
      probe_latency_ms: result.probe_latency_ms,
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
      reason === 'No socket instance' ||
      reason === 'WebSocket state unavailable' ||
      reason.includes('CLOSED') ||
      reason.includes('CLOSING') ||
      reason.includes('unknown')
    );
  }

  private async probeOpenSocket(
    socket: WASocket,
    socketReason: string
  ): Promise<HealthCheckResult> {
    const probeStartedAt = Date.now();
    const lastProbeAt = new Date().toISOString();
    const userId = socket.user?.id;
    const hasSession = this.hasSessionAction?.() === true;
    const incomingBound = this.isIncomingBoundAction?.(socket) === true;

    if (!userId) {
      return this.buildResult({
        isHealthy: true,
        reason: `Verifying session (${socketReason})`,
        detectedStatus: Status.connecting,
        workerStatus: EWorkerStatus.disponible,
        providerState: 'open',
        degradedReason: 'missing_sock_user',
        authenticated: false,
        canReceiveRuntime: incomingBound,
        lastProbeAt,
        probeLatencyMs: Date.now() - probeStartedAt,
      });
    }

    if (!hasSession) {
      return this.buildResult({
        isHealthy: true,
        reason: `Verifying session (${socketReason})`,
        detectedStatus: Status.connecting,
        workerStatus: EWorkerStatus.disponible,
        providerState: 'open',
        degradedReason: 'missing_local_session',
        authenticated: false,
        canReceiveRuntime: incomingBound,
        lastProbeAt,
        probeLatencyMs: Date.now() - probeStartedAt,
      });
    }

    if (!incomingBound) {
      return this.buildResult({
        isHealthy: true,
        reason: `Verifying session (${socketReason})`,
        detectedStatus: Status.connecting,
        workerStatus: EWorkerStatus.disponible,
        providerState: 'open',
        degradedReason: 'incoming_bridge_not_bound',
        authenticated: true,
        canReceiveRuntime: false,
        lastProbeAt,
        probeLatencyMs: Date.now() - probeStartedAt,
      });
    }

    const selfPhone = getPhoneNumber(userId);
    if (!selfPhone) {
      return this.buildResult({
        isHealthy: true,
        reason: `Verifying session (${socketReason})`,
        detectedStatus: Status.connecting,
        workerStatus: EWorkerStatus.disponible,
        providerState: 'open',
        degradedReason: 'missing_self_phone',
        authenticated: true,
        canReceiveRuntime: true,
        lastProbeAt,
        probeLatencyMs: Date.now() - probeStartedAt,
      });
    }

    try {
      await this.runProbe(socket, selfPhone);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return this.buildResult({
        isHealthy: true,
        reason: `Session probe failed: ${reason}`,
        detectedStatus: Status.connecting,
        workerStatus: EWorkerStatus.disponible,
        providerState: 'open',
        degradedReason: reason,
        authenticated: true,
        canReceiveRuntime: true,
        lastProbeAt,
        probeLatencyMs: Date.now() - probeStartedAt,
      });
    }

    return this.buildResult({
      isHealthy: true,
      reason: `Session ready (${socketReason})`,
      detectedStatus: Status.connected,
      workerStatus: EWorkerStatus.online,
      sessionReady: true,
      canSend: true,
      canReceiveRuntime: true,
      authenticated: true,
      providerState: 'open',
      lastProbeAt,
      probeLatencyMs: Date.now() - probeStartedAt,
    });
  }

  private async runProbe(socket: WASocket, selfPhone: string): Promise<void> {
    const probeSocket = socket as WASocket & {
      fetchPrivacySettings?: (force?: boolean) => Promise<unknown>;
      onWhatsApp?: (phone: string) => Promise<Array<{ exists?: boolean }>>;
    };

    if (typeof probeSocket.fetchPrivacySettings !== 'function') {
      throw new Error('fetchPrivacySettings_unavailable');
    }
    if (typeof probeSocket.onWhatsApp !== 'function') {
      throw new Error('onWhatsApp_unavailable');
    }

    await this.withProbeTimeout(
      Promise.resolve(probeSocket.fetchPrivacySettings(true)),
      'fetchPrivacySettings'
    );
    const registered = await this.withProbeTimeout(
      Promise.resolve(probeSocket.onWhatsApp(selfPhone)),
      'onWhatsApp'
    );

    const selfExists =
      Array.isArray(registered) &&
      registered.some((item) => item && item.exists !== false);

    if (!selfExists) {
      throw new Error('self_number_not_registered');
    }
  }

  private withProbeTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`${label}_timeout`));
      }, DEFAULT_PROBE_TIMEOUT_MS);

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
    sessionReady?: boolean;
    canSend?: boolean;
    canReceiveRuntime?: boolean;
    authenticated?: boolean;
    providerState: string;
    degradedReason?: string;
    lastProbeAt?: string;
    probeLatencyMs?: number;
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
      session_ready: sessionReady,
      can_send: input.canSend ?? sessionReady,
      can_receive_runtime: input.canReceiveRuntime ?? false,
      authenticated: input.authenticated ?? false,
      provider_state: input.providerState,
      degraded_reason: degradedReason,
      last_probe_at: input.lastProbeAt ?? new Date().toISOString(),
      probe_latency_ms: input.probeLatencyMs ?? 0,
    };
  }

  private async notifyStatusChange(
    socket: WASocket | undefined,
    result: HealthCheckResult
  ): Promise<void> {
    const payload: IBaileysConnectionState = {
      status: result.detectedStatus,
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.baileys,
      code: result.session_ready
        ? ECodeMessage.connectionEstablished
        : result.detectedStatus === Status.connecting
          ? ECodeMessage.awaitConnection
          : ECodeMessage.connectionLost,
      phone: getPhoneNumber(socket?.user?.id),
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

    logLocalConnectionStatus('baileys.health_check.notify_status', {
      layer: 'baileys.health',
      provider: 'baileys',
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
    });

    try {
      await this.centrifugo.publishSub(getChannel(), payload);
    } catch (error) {
      console.error('[BaileysHealthCheck] Failed to publish status', error);
    }

    try {
      await this.balanceWorkerStatusGrpcClientService.notifyWorkerStatus(
        payload
      );
    } catch (error) {
      console.error(
        '[BaileysHealthCheck] Failed to notify balance worker status',
        error
      );
    }

    const isConnected = result.session_ready;
    const phone = getPhoneNumber(socket?.user?.id);

    await this.saveLogWppConnection({
      worker_id: getWorker(),
      status: result.detectedStatus,
      code: payload.code?.toString(),
      message: result.reason ?? 'Health check status update',
      date: new Date(),
      ...(isConnected && phone ? { phone, connected_at: new Date() } : {}),
    });
  }

  private resolveWebSocket(socket: WASocket): WebSocket | undefined {
    const reference = socket as unknown;
    if (!reference || typeof reference !== 'object') {
      return undefined;
    }

    if ('ws' in reference) {
      const wsWrapper = (reference as { ws?: unknown }).ws;
      if (wsWrapper && typeof wsWrapper === 'object') {
        if ('socket' in wsWrapper) {
          const ws = (wsWrapper as { socket?: WebSocket }).socket;
          if (ws) {
            return ws;
          }
        }
        return wsWrapper as WebSocket;
      }
    }

    if ('socket' in reference) {
      const socketRef = (reference as { socket?: unknown }).socket;
      if (socketRef && typeof socketRef === 'object') {
        if ('socket' in socketRef) {
          const ws = (socketRef as { socket?: WebSocket }).socket;
          if (ws) {
            return ws;
          }
        }
        return socketRef as WebSocket;
      }
    }

    return undefined;
  }

  private inspectSocketState(socket: WASocket): {
    state: SocketStateName;
    reason: string;
  } {
    const reference = socket as unknown as {
      ws?: {
        isOpen?: boolean;
        isClosed?: boolean;
        isClosing?: boolean;
        isConnecting?: boolean;
        socket?: WebSocket | null;
      };
    };

    const wsClient = reference.ws;
    if (wsClient && typeof wsClient === 'object') {
      if (wsClient.isOpen === true) {
        return { state: 'open', reason: 'WebSocket client state: OPEN' };
      }

      if (wsClient.isConnecting === true) {
        return {
          state: 'connecting',
          reason: 'WebSocket client state: CONNECTING',
        };
      }

      if (wsClient.isClosing === true) {
        return { state: 'closing', reason: 'WebSocket client state: CLOSING' };
      }

      if (wsClient.isClosed === true) {
        return { state: 'closed', reason: 'WebSocket client state: CLOSED' };
      }

      if (wsClient.socket) {
        return this.mapReadyState(
          wsClient.socket.readyState,
          'WebSocket raw state'
        );
      }
    }

    const rawWebSocket = this.resolveWebSocket(socket);
    if (!rawWebSocket) {
      return { state: 'unknown', reason: 'WebSocket state unavailable' };
    }

    return this.mapReadyState(rawWebSocket.readyState, 'WebSocket state');
  }

  private mapReadyState(
    readyState: number,
    label: string
  ): { state: SocketStateName; reason: string } {
    switch (readyState) {
      case 0:
        return { state: 'connecting', reason: `${label}: CONNECTING` };
      case 1:
        return { state: 'open', reason: `${label}: OPEN` };
      case 2:
        return { state: 'closing', reason: `${label}: CLOSING` };
      case 3:
        return { state: 'closed', reason: `${label}: CLOSED` };
      default:
        return { state: 'unknown', reason: `${label}: ${readyState}` };
    }
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
