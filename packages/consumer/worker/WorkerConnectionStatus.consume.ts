import { singleton, inject } from 'tsyringe';
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
    @inject(BaileysService)
    private readonly baileysService: BaileysService,
    @inject(BalanceWorkerStatusGrpcClientService)
    private readonly balanceWorkerStatusGrpcClientService: BalanceWorkerStatusGrpcClientService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService
  ) {}

  async requestConnection(
    payload: StatusConnectionWorkerRequest
  ): Promise<IBaileysConnectionState> {
    if (payload.type === EBaileysConnectionType.phone) {
      throw new Error('Phone connection is disabled. Use QR Code.');
    }

    return this.handleConnectionStatus(payload);
  }

  async close(): Promise<void> {
    this.stopConnectionRetry();
  }

  private async handleConnectionStatus(
    data: StatusConnectionWorkerRequest
  ): Promise<IBaileysConnectionState> {
    if (data.status === EWorkerStatus.online) {
      return this.handleOnline(data);
    }

    if (data.status === EWorkerStatus.recreating) {
      return this.handleRecreating();
    }

    if (data.status === EWorkerStatus.disponible) {
      return this.handleDisponible(data);
    }

    return this.currentState(ECodeMessage.awaitConnection);
  }

  private async handleOnline(
    data: StatusConnectionWorkerRequest
  ): Promise<IBaileysConnectionState> {
    this.stopConnectionRetry();

    if (this.baileysService.isConnected()) {
      return this.publishConnectedStatus();
    }

    if (this.baileysService.hasSession()) {
      await this.waitForReconnection(3000, 500);

      if (this.baileysService.isConnected()) {
        return this.publishConnectedStatus();
      }
    }

    const currentStatus = this.baileysService.getStatus();
    const currentCode = this.baileysService.getCode();
    const hasActiveSocket = Boolean(this.baileysService.socket);
    const awaitingQrRead = currentCode === ECodeMessage.awaitingReadQrCode;
    const pairingInProgress =
      currentCode === ECodeMessage.awaitingPairingCode ||
      currentCode === ECodeMessage.pairingInProgress ||
      currentCode === ECodeMessage.newLoginAttempt;

    if (
      currentStatus === EBaileysConnectionStatus.connecting &&
      hasActiveSocket &&
      pairingInProgress
    ) {
      this.baileysService.republishLastState();
      return this.currentState(currentCode);
    }

    if (
      currentStatus === EBaileysConnectionStatus.connecting &&
      hasActiveSocket &&
      awaitingQrRead
    ) {
      try {
        return await this.baileysService.connect({
          initial_connection: true,
          force_new: true,
          requested_by_user: true,
          type: data.type as EBaileysConnectionType,
          phone_connection: data.phone_connection,
          connection_attempt_id: data.connection_attempt_id,
        });
      } catch (error) {
        throw error;
      }
    }

    if (
      currentStatus === EBaileysConnectionStatus.connecting &&
      hasActiveSocket
    ) {
      try {
        return await this.baileysService.connect({
          initial_connection: true,
          force_new: true,
          requested_by_user: true,
          type: data.type as EBaileysConnectionType,
          phone_connection: data.phone_connection,
          connection_attempt_id: data.connection_attempt_id,
        });
      } catch (error) {
        throw error;
      }
    }

    if (this.activeConnectionRequest) {
      return this.currentState(currentCode);
    }

    const state = await this.baileysService.connect({
      initial_connection: true,
      force_new: false,
      requested_by_user: true,
      type: data.type as EBaileysConnectionType,
      phone_connection: data.phone_connection,
      connection_attempt_id: data.connection_attempt_id,
    });
    return state;
  }

  private handleRecreating(): IBaileysConnectionState {
    this.baileysService.reconnect({ initial_connection: true });
    return this.currentState(ECodeMessage.awaitConnection);
  }

  private async handleDisponible(
    data: StatusConnectionWorkerRequest
  ): Promise<IBaileysConnectionState> {
    const removeSession = data.remove_session === true;

    this.stopConnectionRetry();
    await this.baileysService.disconnect({
      initial_connection: true,
      disconnected_user: true,
      preserve_session: !removeSession,
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

    if (!removeSession) {
      const defaultConnectionRequest: StatusConnectionWorkerRequest = {
        worker_id: workerId,
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.qrcode,
      };

      this.startConnectionRetry(defaultConnectionRequest, {
        fromDisconnectRestart: true,
      });
    }

    return payload;
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

  private handoffToServiceReconnect(): void {
    this.stopConnectionRetry();
    this.baileysService.clearUserRequestedDisconnect();
    this.baileysService.reconnect({ initial_connection: true });
  }

  private publishConnectionAttempt(attempt: number): void {
    const payload: IBaileysConnectionState = {
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitConnection,
      worker_id: baileysEnvironment.baileysWorkerId,
      account_id: baileysEnvironment.baileysAccountId,
      attempt,
      max_attempts: this.connectionRetryMinAttempts,
      connection_attempt_id:
        this.activeConnectionRequest?.connection_attempt_id,
    };

    void this.centrifugoService
      .publishSub(workerCentrifugoQueue(payload.account_id), payload)
      .catch(() => {});
  }

  private isAwaitingUserAction(code: ECodeMessage): boolean {
    return (
      code === ECodeMessage.awaitingReadQrCode ||
      code === ECodeMessage.awaitingPairingCode ||
      code === ECodeMessage.pairingInProgress ||
      code === ECodeMessage.newLoginAttempt
    );
  }

  private async publishConnectedStatus(): Promise<IBaileysConnectionState> {
    const workerId = baileysEnvironment.baileysWorkerId;
    const accountId = baileysEnvironment.baileysAccountId;

    const payload: IBaileysConnectionState = {
      status: EBaileysConnectionStatus.connected,
      worker_id: workerId,
      account_id: accountId,
      code: ECodeMessage.connectionEstablished,
      phone: getPhoneNumber(this.baileysService.socket?.user?.id),
      worker_status_id: EWorkerStatus.online,
      connection_attempt_id:
        this.activeConnectionRequest?.connection_attempt_id,
    };

    await this.centrifugoService
      .publishSub(workerCentrifugoQueue(accountId), payload)
      .catch((error) => {
        console.error('Error publishing connected status to Centrifugo:', {
          error,
          account_id: accountId,
          worker_id: workerId,
          connection_attempt_id:
            this.activeConnectionRequest?.connection_attempt_id,
        });
      });

    return payload;
  }

  private currentState(code: ECodeMessage): IBaileysConnectionState {
    return {
      status: this.baileysService.getStatus(),
      code,
      worker_id: baileysEnvironment.baileysWorkerId,
      account_id: baileysEnvironment.baileysAccountId,
      connection_attempt_id:
        this.activeConnectionRequest?.connection_attempt_id,
    };
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

    const status = this.baileysService.getStatus();
    const code = this.baileysService.getCode();
    const hasActiveSocket = Boolean(this.baileysService.socket);
    const fromDisconnectRestart = this.restartAfterDisconnect;

    if (
      status === EBaileysConnectionStatus.connecting &&
      hasActiveSocket &&
      this.isAwaitingUserAction(code) &&
      !fromDisconnectRestart
    ) {
      this.baileysService.republishLastState();
      this.stopConnectionRetry();
      return;
    }

    this.connectionRetryAttempt += 1;

    if (this.connectionRetryAttempt > this.connectionRetryMinAttempts) {
      this.handoffToServiceReconnect();
      return;
    }

    this.publishConnectionAttempt(this.connectionRetryAttempt);

    if (fromDisconnectRestart) {
      this.restartAfterDisconnect = false;
    }

    if (fromDisconnectRestart) {
      this.baileysService.clearUserRequestedDisconnect();
    }

    if (
      status === EBaileysConnectionStatus.connecting &&
      hasActiveSocket &&
      !fromDisconnectRestart
    ) {
      if (this.connectionRetryAttempt < this.connectionRetryMinAttempts) {
        this.scheduleNextAttempt();
      }
      return;
    }

    const connectPromise = this.baileysService
      .connect({
        initial_connection: true,
        force_new: fromDisconnectRestart,
        requested_by_user: !fromDisconnectRestart,
        from_disconnect_restart: fromDisconnectRestart,
        type: request.type as EBaileysConnectionType,
        phone_connection: request.phone_connection,
        connection_attempt_id: request.connection_attempt_id,
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
        console.error('Error during connection attempt:', {
          error,
          worker_id: request.worker_id,
          connection_attempt_id: request.connection_attempt_id,
        });
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
          this.handoffToServiceReconnect();
        }
      }, this.connectionRetryIntervalMs);
    }
  }
}
