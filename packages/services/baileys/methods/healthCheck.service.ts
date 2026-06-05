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
import { BalanceWorkerStatusGrpcClientService } from '@core/services/balanceWorkerStatusGrpcClient.service';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { getPhoneNumber } from '@core/common/functions/getPhoneNumber';
import { buildWppConnectionDocumentId } from '@core/common/functions/buildWppConnectionDocumentId';
import { wppConnectionMappings } from '@core/mappings/wppConnection.mappings';

const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 30_000;

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
}

type SocketStateName = 'open' | 'connecting' | 'closing' | 'closed' | 'unknown';

interface BaileysHealthCheckConfig {
  getSocket: () => WASocket | undefined;
  getStatus: () => Status;
  getCode: () => ECodeMessage;
  reconnect: (input: IBaileysConnection) => void;
  isConnected: () => boolean;
  hasSession: () => boolean;
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
  private onStatusMismatch:
    | ((detected: Status, workerStatus: EWorkerStatus) => void)
    | undefined;
  private bootstrapPromise: Promise<void> | undefined;
  private bootstrapLock = false;

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

  async runHealthCheck(): Promise<HealthCheckResult> {
    if (!this.socketGetter || !this.statusGetter) {
      return {
        isHealthy: false,
        reason: 'Health check not configured',
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
      };
    }

    const socket = this.socketGetter();
    const reportedStatus = this.statusGetter();

    const result = await this.checkConnectivity(socket, reportedStatus);

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
      worker_status_id: EWorkerStatus.disponible,
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
      return {
        isHealthy: false,
        reason: 'No socket instance',
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
      };
    }

    const socketState = this.inspectSocketState(socket);

    if (socketState.state === 'open') {
      if (reportedStatus === Status.connecting) {
        return {
          isHealthy: true,
          reason: `Connecting (${socketState.reason})`,
          detectedStatus: Status.connecting,
          workerStatus: EWorkerStatus.disponible,
        };
      }

      return {
        isHealthy: true,
        reason: `Connection healthy (${socketState.reason})`,
        detectedStatus: Status.connected,
        workerStatus: EWorkerStatus.online,
      };
    }

    if (
      socketState.state === 'connecting' ||
      reportedStatus === Status.connecting
    ) {
      return {
        isHealthy: true,
        reason:
          socketState.state === 'connecting'
            ? `Connecting (${socketState.reason})`
            : 'Connecting (reported by service)',
        detectedStatus: Status.connecting,
        workerStatus: EWorkerStatus.disponible,
      };
    }

    if (
      socketState.state === 'unknown' &&
      reportedStatus === Status.connected
    ) {
      return {
        isHealthy: true,
        reason: `Connected (reported by service, ${socketState.reason})`,
        detectedStatus: Status.connected,
        workerStatus: EWorkerStatus.online,
      };
    }

    return {
      isHealthy: false,
      reason: socketState.reason,
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.offline,
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
      code:
        result.detectedStatus === Status.connected
          ? ECodeMessage.connectionEstablished
          : ECodeMessage.connectionLost,
      phone: getPhoneNumber(socket?.user?.id),
      worker_status_id: result.workerStatus,
    };

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

    const isConnected = result.detectedStatus === Status.connected;
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
