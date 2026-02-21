import type { WASocket } from '@whiskeysockets/baileys';
import type WebSocket from 'ws';
import { singleton, inject } from 'tsyringe';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { baileysEnvironment } from '@core/config/environments';
import { EBaileysConnectionStatus as Status } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { BalanceWorkerStatusGrpcClientService } from '@core/services/balanceWorkerStatusGrpcClient.service';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { getPhoneNumber } from '@core/common/functions/getPhoneNumber';

const CHANNEL = workerCentrifugoQueue(baileysEnvironment.baileysAccountId);
const WORKER = baileysEnvironment.baileysWorkerId;
const ACCOUNT = baileysEnvironment.baileysAccountId;

const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 30_000;
const PING_TIMEOUT_MS = 10_000;

interface HealthCheckResult {
  isHealthy: boolean;
  reason?: string;
  detectedStatus: Status;
  workerStatus: EWorkerStatus;
}

@singleton()
export class BaileysHealthCheckService {
  private intervalId: NodeJS.Timeout | undefined;
  private lastKnownStatus: Status = Status.initial;
  private lastKnownWorkerStatus: EWorkerStatus = EWorkerStatus.disponible;
  private isRunning = false;
  private socketGetter: (() => WASocket | undefined) | undefined;
  private statusGetter: (() => Status) | undefined;
  private onStatusMismatch:
    | ((detected: Status, workerStatus: EWorkerStatus) => void)
    | undefined;

  constructor(
    @inject(CentrifugoService)
    private readonly centrifugo: CentrifugoService,
    @inject(BalanceWorkerStatusGrpcClientService)
    private readonly balanceWorkerStatusGrpcClientService: BalanceWorkerStatusGrpcClientService
  ) {}

  configure(options: {
    getSocket: () => WASocket | undefined;
    getStatus: () => Status;
    onStatusMismatch?: (detected: Status, workerStatus: EWorkerStatus) => void;
  }): void {
    this.socketGetter = options.getSocket;
    this.statusGetter = options.getStatus;
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
        `[BaileysHealthCheck] Mismatch detected: reported=${reportedStatus}, actual=${result.detectedStatus}`
      );
      this.onStatusMismatch(result.detectedStatus, result.workerStatus);
    }

    return result;
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

    const ws = this.resolveWebSocket(socket);
    if (!ws) {
      return {
        isHealthy: false,
        reason: 'WebSocket not available',
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
      };
    }

    const readyState = ws.readyState;

    if (readyState !== 1) {
      const stateNames = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
      return {
        isHealthy: false,
        reason: `WebSocket state: ${stateNames[readyState] ?? readyState}`,
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
      };
    }

    if (!socket.user) {
      if (reportedStatus === Status.connecting) {
        return {
          isHealthy: true,
          reason: 'Connecting (awaiting authentication)',
          detectedStatus: Status.connecting,
          workerStatus: EWorkerStatus.disponible,
        };
      }

      return {
        isHealthy: false,
        reason: 'No user info available',
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
      };
    }

    const pingResult = await this.performPingCheck(ws);
    if (!pingResult.success) {
      return {
        isHealthy: false,
        reason: pingResult.reason,
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
      };
    }

    return {
      isHealthy: true,
      reason: 'Connection healthy',
      detectedStatus: Status.connected,
      workerStatus: EWorkerStatus.online,
    };
  }

  private performPingCheck(
    ws: WebSocket
  ): Promise<{ success: boolean; reason?: string }> {
    return new Promise((resolve) => {
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          ws.removeAllListeners('pong');
        }
      };

      const timeout = setTimeout(() => {
        cleanup();
        resolve({ success: false, reason: 'Ping timeout' });
      }, PING_TIMEOUT_MS);

      try {
        ws.once('pong', () => {
          clearTimeout(timeout);
          cleanup();
          resolve({ success: true });
        });

        ws.ping();
      } catch (error) {
        clearTimeout(timeout);
        cleanup();
        resolve({
          success: false,
          reason: `Ping error: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    });
  }

  private async notifyStatusChange(
    socket: WASocket | undefined,
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
      phone: getPhoneNumber(socket?.user?.id),
      worker_status_id: result.workerStatus,
    };

    try {
      await this.centrifugo.publishSub(CHANNEL, payload);
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
}
