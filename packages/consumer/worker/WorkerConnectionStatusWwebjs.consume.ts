import { singleton, inject } from 'tsyringe';
import { wwebjsEnvironment } from '@core/config/environments';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { WwebjsService } from '@core/services/wwebjs';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { BalanceWorkerStatusGrpcClientService } from '@core/services/balanceWorkerStatusGrpcClient.service';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';

interface PublishQrCodeAttemptFailedOptions {
  attempt: number;
  maxAttempts: number;
  reason: string;
  degradedReason?: string;
}

@singleton()
export class WorkerConnectionStatusWwebjsConsume {
  private connectionRetryTimer: NodeJS.Timeout | null = null;
  private connectionRetryAttempt = 0;
  private readonly connectionRetryIntervalMs = 15_000;
  private readonly connectionRetryMinAttempts = 5;
  private activeConnectionRequest: StatusConnectionWorkerRequest | null = null;
  private restartAfterDisconnect = false;

  constructor(
    @inject(WwebjsService)
    private readonly wwebjsService: WwebjsService,
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

  cancelConnectionAttempt(): void {
    this.stopConnectionRetry();
    this.wwebjsService.cancelConnectionAttempt();
  }

  async publishQrCodeAttemptFailed(
    request: StatusConnectionWorkerRequest,
    options: PublishQrCodeAttemptFailedOptions
  ): Promise<IBaileysConnectionState> {
    const payload: IBaileysConnectionState = {
      status: EBaileysConnectionStatus.disconnected,
      code: ECodeMessage.connectionClosed,
      worker_id: wwebjsEnvironment.wwebjsWorkerId,
      account_id: wwebjsEnvironment.wwebjsAccountId,
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: request.connection_attempt_id,
      authorized_connection_epoch: request.authorized_connection_epoch,
      debug_trace_id: request.debug_trace_id,
      runtime_generation:
        request.runtime_generation ?? wwebjsEnvironment.runtimeGeneration,
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
      retryable: true,
    };

    // The durable manager projection is the terminal-state commit point. A
    // caller must not ACK its source delivery if this write fails.
    await this.balanceWorkerStatusGrpcClientService.notifyWorkerStatus(payload);
    await this.centrifugoService
      .publishSub(workerCentrifugoQueue(payload.account_id), payload)
      .catch(() => undefined);

    return payload;
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

    if (this.wwebjsService.isConnected()) {
      this.stopConnectionRetry();
      return this.publishConnectedStatus(data);
    }

    if (isExplicitQrRequest) {
      this.stopConnectionRetry();
    } else if (this.activeConnectionRequest) {
      return this.currentState(this.wwebjsService.getCode());
    }

    const currentCode = this.wwebjsService.getCode();
    const isSessionInvalid =
      currentCode === ECodeMessage.badSession ||
      currentCode === ECodeMessage.loggedOut;
    let shouldResetStaleSessionForQr = false;

    const hasDurableSession =
      this.wwebjsService.hasSession() && !isSessionInvalid;

    if (hasDurableSession && isExplicitQrRequest) {
      await this.waitForReconnection(3000, 500);
      if (this.wwebjsService.isConnected()) {
        return this.publishConnectedStatus(data);
      }

      shouldResetStaleSessionForQr = true;
      await this.wwebjsService.disconnect({
        initial_connection: true,
        disconnected_user: false,
        preserve_session: false,
        remove_session: true,
        connection_attempt_id: data.connection_attempt_id,
        runtime_generation: data.runtime_generation,
        debug_trace_id: data.debug_trace_id,
      });
    }

    const currentStatus = this.wwebjsService.getStatus();
    const hasActiveSocket = Boolean(this.wwebjsService.socket);
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
      this.wwebjsService.republishLastState();
      return this.currentState(currentCode, data);
    }

    if (
      currentStatus === EBaileysConnectionStatus.connecting &&
      hasActiveSocket &&
      awaitingQrRead
    ) {
      if (!isExplicitQrRequest) {
        this.wwebjsService.republishLastState();
        return this.currentState(currentCode, data);
      }

      return this.connectWithService(data, {
        fromDisconnectRestart: false,
        requestedByUser: true,
        forceNew: true,
      });
    }

    if (
      currentStatus === EBaileysConnectionStatus.connecting &&
      hasActiveSocket
    ) {
      if (!isExplicitQrRequest) {
        this.wwebjsService.republishLastState();
        return this.currentState(currentCode, data);
      }

      return this.connectWithService(data, {
        fromDisconnectRestart: false,
        requestedByUser: true,
        forceNew: true,
        allowRestore: false,
      });
    }

    if (hasDurableSession && !isExplicitQrRequest) {
      return this.startConnectionRecovery(data);
    }

    if (isSessionInvalid) {
      await this.wwebjsService.disconnect({
        initial_connection: true,
        disconnected_user: false,
        preserve_session: false,
        remove_session: true,
        connection_attempt_id: data.connection_attempt_id,
        runtime_generation: data.runtime_generation,
        debug_trace_id: data.debug_trace_id,
      });
    }

    return this.connectWithService(data, {
      fromDisconnectRestart: isSessionInvalid || shouldResetStaleSessionForQr,
      requestedByUser: isExplicitQrRequest,
      allowRestore: !(isSessionInvalid || shouldResetStaleSessionForQr),
    });
  }

  private startConnectionRecovery(
    data: StatusConnectionWorkerRequest
  ): IBaileysConnectionState {
    this.activeConnectionRequest = { ...data };
    this.connectionRetryAttempt = 0;
    this.restartAfterDisconnect = false;
    void this.runConnectionAttempt();
    return this.currentState(this.wwebjsService.getCode(), data);
  }

  private handleRecreating(
    data: StatusConnectionWorkerRequest
  ): IBaileysConnectionState {
    this.wwebjsService.reconnect({
      initial_connection: true,
      connection_attempt_id: data.connection_attempt_id,
      authorized_connection_epoch: data.authorized_connection_epoch,
      runtime_generation: data.runtime_generation,
      debug_trace_id: data.debug_trace_id,
    });
    return this.currentState(ECodeMessage.awaitConnection, data);
  }

  private async handleDisponible(
    data: StatusConnectionWorkerRequest
  ): Promise<IBaileysConnectionState> {
    const removeSession = data.remove_session === true;

    this.stopConnectionRetry();
    await this.wwebjsService.disconnect({
      initial_connection: true,
      disconnected_user: true,
      preserve_session: !removeSession,
      connection_attempt_id: data.connection_attempt_id,
      authorized_connection_epoch: data.authorized_connection_epoch,
      runtime_generation: data.runtime_generation,
      debug_trace_id: data.debug_trace_id,
    });

    const workerId = wwebjsEnvironment.wwebjsWorkerId;
    const accountId = wwebjsEnvironment.wwebjsAccountId;

    const payload: IBaileysConnectionState = {
      status: EBaileysConnectionStatus.disconnected,
      worker_id: workerId,
      account_id: accountId,
      code: ECodeMessage.connectionClosed,
      disconnected_user: true,
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: data.connection_attempt_id,
      authorized_connection_epoch: data.authorized_connection_epoch,
      runtime_generation: data.runtime_generation,
      debug_trace_id: data.debug_trace_id,
    };

    // The manager owns the durable terminal projection for explicit session
    // removal. Do not race its disconnect tombstone with a duplicate event.
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
        runtime_generation: data.runtime_generation,
        debug_trace_id: data.debug_trace_id,
      };

      await this.connectWithService(defaultConnectionRequest, {
        fromDisconnectRestart: true,
        requestedByUser: false,
      });
    }

    return payload;
  }

  private async connectWithService(
    data: StatusConnectionWorkerRequest,
    options: {
      fromDisconnectRestart: boolean;
      requestedByUser: boolean;
      allowRestore?: boolean;
      forceNew?: boolean;
    }
  ): Promise<IBaileysConnectionState> {
    const allowRestore = options.allowRestore ?? true;
    const forceNew = options.forceNew ?? options.fromDisconnectRestart;

    return this.wwebjsService.connect({
      initial_connection: true,
      allow_restore: allowRestore,
      force_new: forceNew,
      requested_by_user: options.requestedByUser,
      from_disconnect_restart: options.fromDisconnectRestart,
      type: data.type as EBaileysConnectionType,
      phone_connection: data.phone_connection,
      connection_attempt_id: data.connection_attempt_id,
      authorized_connection_epoch: data.authorized_connection_epoch,
      runtime_generation: data.runtime_generation,
      debug_trace_id: data.debug_trace_id,
    });
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
    this.wwebjsService.clearUserRequestedDisconnect();
    this.wwebjsService.reconnect({
      initial_connection: true,
      connection_attempt_id: request?.connection_attempt_id,
      authorized_connection_epoch: request?.authorized_connection_epoch,
      runtime_generation:
        request?.runtime_generation ?? wwebjsEnvironment.runtimeGeneration,
      debug_trace_id: request?.debug_trace_id,
    });
  }

  private publishConnectionAttempt(attempt: number): void {
    const payload: IBaileysConnectionState = {
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitConnection,
      worker_id: wwebjsEnvironment.wwebjsWorkerId,
      account_id: wwebjsEnvironment.wwebjsAccountId,
      attempt,
      max_attempts: this.connectionRetryMinAttempts,
      connection_attempt_id:
        this.activeConnectionRequest?.connection_attempt_id,
      authorized_connection_epoch:
        this.activeConnectionRequest?.authorized_connection_epoch,
      runtime_generation:
        this.activeConnectionRequest?.runtime_generation ??
        wwebjsEnvironment.runtimeGeneration,
      debug_trace_id: this.activeConnectionRequest?.debug_trace_id,
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
    return this.wwebjsService.verifyAndPublishConnectionStatus({
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
        wwebjsEnvironment.runtimeGeneration,
    });
  }

  private currentState(
    code: ECodeMessage,
    request?: StatusConnectionWorkerRequest
  ): IBaileysConnectionState {
    return {
      status: this.wwebjsService.getStatus(),
      code,
      worker_id: wwebjsEnvironment.wwebjsWorkerId,
      account_id: wwebjsEnvironment.wwebjsAccountId,
      connection_attempt_id:
        request?.connection_attempt_id ??
        this.activeConnectionRequest?.connection_attempt_id,
      authorized_connection_epoch:
        request?.authorized_connection_epoch ??
        this.activeConnectionRequest?.authorized_connection_epoch,
      runtime_generation:
        request?.runtime_generation ??
        this.activeConnectionRequest?.runtime_generation ??
        wwebjsEnvironment.runtimeGeneration,
      debug_trace_id:
        request?.debug_trace_id ?? this.activeConnectionRequest?.debug_trace_id,
    };
  }

  private async waitForReconnection(
    maxWaitMs: number,
    intervalMs: number
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (this.wwebjsService.isConnected()) {
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

    if (this.wwebjsService.isConnected()) {
      this.stopConnectionRetry();
      return;
    }

    const status = this.wwebjsService.getStatus();
    const code = this.wwebjsService.getCode();
    const hasActiveSocket = Boolean(this.wwebjsService.socket);
    const fromDisconnectRestart = this.restartAfterDisconnect;

    if (
      status === EBaileysConnectionStatus.connecting &&
      hasActiveSocket &&
      this.isAwaitingUserAction(code) &&
      !fromDisconnectRestart
    ) {
      this.wwebjsService.republishLastState();
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
      this.wwebjsService.clearUserRequestedDisconnect();
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

    const skipRestore =
      code === ECodeMessage.badSession || code === ECodeMessage.loggedOut;

    const connectPromise = this.wwebjsService
      .connect({
        initial_connection: true,
        allow_restore: !skipRestore,
        force_new: fromDisconnectRestart,
        requested_by_user:
          request.qr_pending === true && !fromDisconnectRestart,
        from_disconnect_restart: fromDisconnectRestart,
        type: request.type as EBaileysConnectionType,
        phone_connection: request.phone_connection,
        connection_attempt_id: request.connection_attempt_id,
        authorized_connection_epoch: request.authorized_connection_epoch,
        runtime_generation: request.runtime_generation,
        debug_trace_id: request.debug_trace_id,
      })
      .then((state) => {
        if (
          state?.qrcode ||
          state?.status === EBaileysConnectionStatus.connected
        ) {
          this.stopConnectionRetry();
        }
      })
      .catch(() => {});

    void connectPromise;

    if (this.connectionRetryAttempt < this.connectionRetryMinAttempts) {
      this.scheduleNextAttempt();
    } else {
      this.connectionRetryTimer = setTimeout(() => {
        if (this.activeConnectionRequest && !this.wwebjsService.isConnected()) {
          this.handoffToServiceReconnect();
        }
      }, this.connectionRetryIntervalMs);
    }
  }
}
