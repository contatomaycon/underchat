import { singleton, inject } from 'tsyringe';
import { baileysEnvironment } from '@core/config/environments';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { BaileysService } from '@core/services/baileys';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { BalanceWorkerStatusGrpcClientService } from '@core/services/balanceWorkerStatusGrpcClient.service';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { CentrifugoService } from '@core/services/centrifugo.service';

interface PublishQrCodeAttemptFailedOptions {
  attempt: number;
  maxAttempts: number;
  reason: string;
  degradedReason?: string;
}

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

  cancelConnectionAttempt(): void {
    this.stopConnectionRetry();
    void this.baileysService.shutdown().catch(() => {});
  }

  async publishQrCodeAttemptFailed(
    request: StatusConnectionWorkerRequest,
    options: PublishQrCodeAttemptFailedOptions
  ): Promise<IBaileysConnectionState> {
    const payload: IBaileysConnectionState = {
      status: EBaileysConnectionStatus.disconnected,
      code: ECodeMessage.connectionClosed,
      worker_id: baileysEnvironment.baileysWorkerId,
      account_id: baileysEnvironment.baileysAccountId,
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: request.connection_attempt_id,
      authorized_connection_epoch: request.authorized_connection_epoch,
      debug_trace_id: request.debug_trace_id,
      runtime_generation:
        request.runtime_generation ?? baileysEnvironment.runtimeGeneration,
      warm_pool_id: request.warm_pool_id,
      qr_pending: false,
      attempt: options.attempt,
      max_attempts: options.maxAttempts,
      reason: options.reason,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      provider_state: 'disconnected',
      degraded_reason: options.degradedReason ?? options.reason,
    };

    await this.balanceWorkerStatusGrpcClientService
      .notifyWorkerStatus(payload)
      .catch(() => undefined);

    return payload;
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
      return this.handleRecreating(data);
    }

    if (data.status === EWorkerStatus.disponible) {
      return this.handleDisponible(data);
    }

    return this.currentState(ECodeMessage.awaitConnection, data);
  }

  private async handleOnline(
    data: StatusConnectionWorkerRequest
  ): Promise<IBaileysConnectionState> {
    const isExplicitQrRequest =
      data.type === EBaileysConnectionType.qrcode && data.qr_pending === true;

    if (this.baileysService.isConnected()) {
      this.stopConnectionRetry();
      return this.publishConnectedStatus(data);
    }

    if (this.activeConnectionRequest && !isExplicitQrRequest) {
      const currentCode = this.baileysService.getCode();
      if (this.baileysService.socket) {
        this.baileysService.republishLastState();
      }
      return this.currentState(currentCode);
    }

    if (isExplicitQrRequest) {
      this.stopConnectionRetry();
    }

    if (this.baileysService.hasSession()) {
      await this.waitForReconnection(3000, 500);

      if (this.baileysService.isConnected()) {
        return this.publishConnectedStatus(data);
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
    const currentAttemptState =
      isExplicitQrRequest && hasActiveSocket
        ? this.baileysService.republishLastState(data.connection_attempt_id)
        : undefined;

    if (isExplicitQrRequest && currentAttemptState) {
      return currentAttemptState;
    }

    if (
      currentStatus === EBaileysConnectionStatus.connecting &&
      hasActiveSocket &&
      pairingInProgress
    ) {
      if (!isExplicitQrRequest) {
        this.baileysService.republishLastState(data.connection_attempt_id);
      }
      return this.currentState(currentCode, data);
    }

    if (
      currentStatus === EBaileysConnectionStatus.connecting &&
      hasActiveSocket &&
      awaitingQrRead
    ) {
      if (!isExplicitQrRequest) {
        this.baileysService.republishLastState(data.connection_attempt_id);
        return this.currentState(currentCode, data);
      }

      return this.connectWithService(data, {
        forceNew: true,
        requestedByUser: true,
      });
    }

    if (
      currentStatus === EBaileysConnectionStatus.connecting &&
      hasActiveSocket
    ) {
      if (!isExplicitQrRequest) {
        this.baileysService.republishLastState(data.connection_attempt_id);
        return this.currentState(currentCode, data);
      }

      return this.connectWithService(data, {
        forceNew: true,
        requestedByUser: true,
      });
    }

    if (this.activeConnectionRequest) {
      return this.currentState(currentCode);
    }

    return this.connectWithService(data, {
      forceNew: false,
      requestedByUser: isExplicitQrRequest,
    });
  }

  private connectWithService(
    data: StatusConnectionWorkerRequest,
    options: { forceNew: boolean; requestedByUser: boolean }
  ): Promise<IBaileysConnectionState> {
    return this.baileysService.connect({
      initial_connection: true,
      force_new: options.forceNew,
      requested_by_user: options.requestedByUser,
      type: data.type as EBaileysConnectionType,
      phone_connection: data.phone_connection,
      connection_attempt_id: data.connection_attempt_id,
      authorized_connection_epoch: data.authorized_connection_epoch,
      debug_trace_id: data.debug_trace_id,
      runtime_generation:
        data.runtime_generation ?? baileysEnvironment.runtimeGeneration,
    });
  }

  private handleRecreating(
    data: StatusConnectionWorkerRequest
  ): IBaileysConnectionState {
    this.baileysService.reconnect({
      initial_connection: true,
      connection_attempt_id: data.connection_attempt_id,
      authorized_connection_epoch: data.authorized_connection_epoch,
      runtime_generation:
        data.runtime_generation ?? baileysEnvironment.runtimeGeneration,
      debug_trace_id: data.debug_trace_id,
    });
    return this.currentState(ECodeMessage.awaitConnection, data);
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
      connection_attempt_id: data.connection_attempt_id,
      authorized_connection_epoch: data.authorized_connection_epoch,
      runtime_generation:
        data.runtime_generation ?? baileysEnvironment.runtimeGeneration,
      debug_trace_id: data.debug_trace_id,
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
      connection_attempt_id: data.connection_attempt_id,
      authorized_connection_epoch: data.authorized_connection_epoch,
      runtime_generation:
        data.runtime_generation ?? baileysEnvironment.runtimeGeneration,
      debug_trace_id: data.debug_trace_id,
    };

    // The manager owns the durable terminal projection for explicit session
    // removal. Publishing it again here races the disconnect tombstone and
    // can reject an otherwise successful removal as a stale runtime event.
    if (!removeSession) {
      await this.balanceWorkerStatusGrpcClientService.notifyWorkerStatus(
        payload
      );
    }

    if (!removeSession) {
      const defaultConnectionRequest: StatusConnectionWorkerRequest = {
        worker_id: workerId,
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.qrcode,
        connection_attempt_id: data.connection_attempt_id,
        runtime_generation:
          data.runtime_generation ?? baileysEnvironment.runtimeGeneration,
        debug_trace_id: data.debug_trace_id,
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
    const request = this.activeConnectionRequest;
    this.stopConnectionRetry();
    this.baileysService.clearUserRequestedDisconnect();
    this.baileysService.reconnect({
      initial_connection: true,
      connection_attempt_id: request?.connection_attempt_id,
      authorized_connection_epoch: request?.authorized_connection_epoch,
      runtime_generation:
        request?.runtime_generation ?? baileysEnvironment.runtimeGeneration,
      debug_trace_id: request?.debug_trace_id,
    });
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
      authorized_connection_epoch:
        this.activeConnectionRequest?.authorized_connection_epoch,
      debug_trace_id: this.activeConnectionRequest?.debug_trace_id,
      runtime_generation:
        this.activeConnectionRequest?.runtime_generation ??
        baileysEnvironment.runtimeGeneration,
    };

    void (
      this.balanceWorkerStatusGrpcClientService.publishWorkerRuntimeEvent?.(
        payload
      ) ?? Promise.resolve()
    ).catch(() => {});
  }

  private isAwaitingUserAction(code: ECodeMessage): boolean {
    return (
      code === ECodeMessage.awaitingReadQrCode ||
      code === ECodeMessage.awaitingPairingCode ||
      code === ECodeMessage.pairingInProgress ||
      code === ECodeMessage.newLoginAttempt
    );
  }

  private async publishConnectedStatus(
    request?: StatusConnectionWorkerRequest
  ): Promise<IBaileysConnectionState> {
    return this.baileysService.verifyAndPublishConnectionStatus({
      connection_attempt_id:
        request?.connection_attempt_id ??
        this.activeConnectionRequest?.connection_attempt_id,
      authorized_connection_epoch:
        request?.authorized_connection_epoch ??
        this.activeConnectionRequest?.authorized_connection_epoch,
      debug_trace_id:
        request?.debug_trace_id ?? this.activeConnectionRequest?.debug_trace_id,
      runtime_generation:
        request?.runtime_generation ??
        this.activeConnectionRequest?.runtime_generation ??
        baileysEnvironment.runtimeGeneration,
    });
  }

  private currentState(
    code: ECodeMessage,
    request?: StatusConnectionWorkerRequest
  ): IBaileysConnectionState {
    return {
      status: this.baileysService.getStatus(),
      code,
      worker_id: baileysEnvironment.baileysWorkerId,
      account_id: baileysEnvironment.baileysAccountId,
      connection_attempt_id:
        request?.connection_attempt_id ??
        this.activeConnectionRequest?.connection_attempt_id,
      authorized_connection_epoch:
        request?.authorized_connection_epoch ??
        this.activeConnectionRequest?.authorized_connection_epoch,
      debug_trace_id:
        request?.debug_trace_id ?? this.activeConnectionRequest?.debug_trace_id,
      runtime_generation:
        request?.runtime_generation ??
        this.activeConnectionRequest?.runtime_generation ??
        baileysEnvironment.runtimeGeneration,
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
        authorized_connection_epoch: request.authorized_connection_epoch,
        debug_trace_id: request.debug_trace_id,
        runtime_generation:
          request.runtime_generation ?? baileysEnvironment.runtimeGeneration,
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
