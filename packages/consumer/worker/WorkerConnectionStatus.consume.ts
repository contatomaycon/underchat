import { singleton } from 'tsyringe';
import { baileysEnvironment } from '@core/config/environments';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { BaileysService } from '@core/services/baileys';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { BalanceWorkerStatusGrpcClientService } from '@core/services/balanceWorkerStatusGrpcClient.service';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { getPhoneNumber } from '@core/common/functions/getPhoneNumber';

@singleton()
export class WorkerConnectionStatusConsume {
  private connectionRetryTimer: NodeJS.Timeout | null = null;
  private connectionRetryAttempt = 0;
  private readonly connectionRetryIntervalMs = 15_000;
  private readonly connectionRetryMinAttempts = 5;
  private activeConnectionRequest: StatusConnectionWorkerRequest | null = null;
  private restartAfterDisconnect = false;

  constructor(
    private readonly baileysService: BaileysService,
    private readonly balanceWorkerStatusGrpcClientService: BalanceWorkerStatusGrpcClientService,
    private readonly centrifugoService: CentrifugoService
  ) {}

  requestConnection(payload: StatusConnectionWorkerRequest): void {
    void this.handleConnectionStatus(payload);
  }

  async close(): Promise<void> {
    this.stopConnectionRetry();
  }

  private async handleConnectionStatus(
    data: StatusConnectionWorkerRequest
  ): Promise<void> {
    if (data.status === EWorkerStatus.online) {
      await this.handleOnline(data);

      return;
    }

    if (data.status === EWorkerStatus.recreating) {
      this.handleRecreating();

      return;
    }

    if (data.status === EWorkerStatus.disponible) {
      await this.handleDisponible();
    }
  }

  private async handleOnline(
    data: StatusConnectionWorkerRequest
  ): Promise<void> {
    if (this.baileysService.isConnected()) {
      await this.publishConnectedStatus();
      return;
    }

    if (this.baileysService.hasSession()) {
      await this.waitForReconnection(3000, 500);
      if (this.baileysService.isConnected()) {
        await this.publishConnectedStatus();
        return;
      }
    }

    if (this.activeConnectionRequest) {
      return;
    }

    const currentStatus = this.baileysService.getStatus();
    const currentCode = this.baileysService.getCode();
    const hasActiveSocket = Boolean(this.baileysService.socket);
    const awaitingUserAction =
      currentCode === ECodeMessage.awaitingReadQrCode ||
      currentCode === ECodeMessage.awaitingPairingCode ||
      currentCode === ECodeMessage.newLoginAttempt;

    if (
      currentStatus === EBaileysConnectionStatus.connecting &&
      hasActiveSocket &&
      awaitingUserAction
    ) {
      this.baileysService.republishLastState();
      return;
    }

    this.baileysService.resetQrCodeCounter();
    this.startConnectionRetry(data);
  }

  private handleRecreating(): void {
    this.baileysService.reconnect({ initial_connection: true });
  }

  private async handleDisponible(): Promise<void> {
    this.stopConnectionRetry();
    await this.baileysService.disconnect({
      initial_connection: true,
      disconnected_user: true,
    });

    const workerId = baileysEnvironment.baileysWorkerId;
    const accountId = baileysEnvironment.baileysAccountId;

    const payload: IBaileysConnectionState = {
      status: EBaileysConnectionStatus.disconnected,
      worker_id: workerId,
      account_id: accountId,
      code: ECodeMessage.connectionClosed,
      disconnected_user: true,
      worker_status_id: EWorkerStatus.disponible,
    };

    await this.balanceWorkerStatusGrpcClientService.notifyWorkerStatus(payload);

    const defaultConnectionRequest: StatusConnectionWorkerRequest = {
      worker_id: workerId,
      status: EWorkerStatus.online,
      type: EBaileysConnectionType.qrcode,
    };

    this.startConnectionRetry(defaultConnectionRequest, {
      fromDisconnectRestart: true,
    });
  }

  private startConnectionRetry(
    data: StatusConnectionWorkerRequest,
    options?: { fromDisconnectRestart?: boolean }
  ): void {
    this.stopConnectionRetry();
    this.activeConnectionRequest = data;
    this.connectionRetryAttempt = 0;
    this.restartAfterDisconnect = options?.fromDisconnectRestart ?? false;
    this.runConnectionAttempt();
  }

  private stopConnectionRetry(): void {
    if (this.connectionRetryTimer) {
      clearTimeout(this.connectionRetryTimer);
      this.connectionRetryTimer = null;
    }
    this.activeConnectionRequest = null;
    this.connectionRetryAttempt = 0;
    this.restartAfterDisconnect = false;
  }

  private scheduleNextAttempt(): void {
    if (!this.activeConnectionRequest) return;

    this.connectionRetryTimer = setTimeout(() => {
      this.runConnectionAttempt();
    }, this.connectionRetryIntervalMs);
  }

  private publishConnectionAttempt(attempt: number): void {
    const payload: IBaileysConnectionState = {
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitConnection,
      worker_id: baileysEnvironment.baileysWorkerId,
      account_id: baileysEnvironment.baileysAccountId,
      attempt,
      max_attempts: this.connectionRetryMinAttempts,
    };

    void this.centrifugoService
      .publishSub(workerCentrifugoQueue(payload.account_id), payload)
      .catch(() => {});
  }

  private async publishConnectedStatus(): Promise<void> {
    const workerId = baileysEnvironment.baileysWorkerId;
    const accountId = baileysEnvironment.baileysAccountId;

    const payload: IBaileysConnectionState = {
      status: EBaileysConnectionStatus.connected,
      worker_id: workerId,
      account_id: accountId,
      code: ECodeMessage.connectionEstablished,
      phone: getPhoneNumber(this.baileysService.socket?.user?.id),
      worker_status_id: EWorkerStatus.online,
    };

    await this.centrifugoService
      .publishSub(workerCentrifugoQueue(accountId), payload)
      .catch((error) => {
        console.error(
          '[WorkerConnectionStatus] publishConnectedStatus - Failed',
          error
        );
      });
  }

  private async waitForReconnection(
    maxWaitMs: number,
    intervalMs: number
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (this.baileysService.isConnected()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  private async runConnectionAttempt(): Promise<void> {
    const request = this.activeConnectionRequest;
    if (!request) {
      return;
    }

    if (this.baileysService.isConnected()) {
      this.stopConnectionRetry();
      return;
    }

    this.connectionRetryAttempt += 1;
    this.publishConnectionAttempt(this.connectionRetryAttempt);

    if (this.connectionRetryAttempt > this.connectionRetryMinAttempts) {
      this.stopConnectionRetry();
      void this.baileysService
        .disconnect({
          initial_connection: true,
          disconnected_user: true,
        })
        .catch((error) => {
          console.error('Error disconnecting Baileys after retries:', error);
        });
      return;
    }

    const fromDisconnectRestart = this.restartAfterDisconnect;
    if (fromDisconnectRestart) {
      this.restartAfterDisconnect = false;
    }

    if (fromDisconnectRestart) {
      this.baileysService.clearUserRequestedDisconnect();
    }

    const connectPromise = this.baileysService
      .connect({
        initial_connection: true,
        force_new: true,
        requested_by_user: !fromDisconnectRestart,
        from_disconnect_restart: fromDisconnectRestart,
        type: request.type as EBaileysConnectionType,
        phone_connection: request.phone_connection,
      })
      .then((state) => {
        if (
          state?.qrcode ||
          state?.status === EBaileysConnectionStatus.connected
        ) {
          this.stopConnectionRetry();
        }
      })
      .catch((error) => {
        console.error('Error initiating Baileys connection:', error);
      });

    void connectPromise;

    if (this.connectionRetryAttempt < this.connectionRetryMinAttempts) {
      this.scheduleNextAttempt();
    } else {
      this.connectionRetryTimer = setTimeout(() => {
        if (
          this.activeConnectionRequest &&
          !this.baileysService.isConnected()
        ) {
          this.stopConnectionRetry();
          void this.baileysService
            .disconnect({
              initial_connection: true,
              disconnected_user: true,
            })
            .catch((error) => {
              console.error(
                'Error disconnecting Baileys after retries:',
                error
              );
            });
        }
      }, this.connectionRetryIntervalMs);
    }
  }
}
