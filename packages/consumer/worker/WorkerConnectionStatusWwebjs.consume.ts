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
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { getPhoneNumber } from '@core/common/functions/getPhoneNumber';
import { recordConnectionLifecycle } from '@core/plugins/telemetry/connectionLifecycleDebug';

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
    this.logConnectionEvent('connection_request_received', {
      status: payload.status,
      connection_type: payload.type,
      remove_session: payload.remove_session === true,
      has_phone_connection: Boolean(payload.phone_connection),
      connection_attempt_id: payload.connection_attempt_id,
      connection_lifecycle_id: payload.connection_lifecycle_id,
      qr_pending: payload.qr_pending === true,
    });

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
    this.logConnectionEvent('handle_online_start', {
      status: data.status,
      connection_type: data.type,
      connection_attempt_id: data.connection_attempt_id,
      connection_lifecycle_id: data.connection_lifecycle_id,
      qr_pending: data.qr_pending === true,
    });
    this.stopConnectionRetry();

    if (this.wwebjsService.isConnected()) {
      this.logConnectionEvent('handle_online_short_circuit', {
        reason: 'already_connected',
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
      });
      return this.publishConnectedStatus();
    }

    const currentCode = this.wwebjsService.getCode();
    const isSessionInvalid =
      currentCode === ECodeMessage.badSession ||
      currentCode === ECodeMessage.loggedOut;

    if (this.wwebjsService.hasSession() && !isSessionInvalid) {
      this.logConnectionEvent('handle_online_restore_wait_start', {
        reason: 'existing_session_found',
        wait_ms: 3000,
        interval_ms: 500,
        code: currentCode,
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
      });
      await this.waitForReconnection(3000, 500);
      if (this.wwebjsService.isConnected()) {
        this.logConnectionEvent('handle_online_restore_wait_success', {
          reason: 'connected_after_existing_session_wait',
          connection_attempt_id: data.connection_attempt_id,
          connection_lifecycle_id: data.connection_lifecycle_id,
        });
        return this.publishConnectedStatus();
      }
      this.logConnectionEvent('handle_online_restore_wait_timeout', {
        reason: 'existing_session_not_connected_after_wait',
        code: currentCode,
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
      });
    }

    if (this.activeConnectionRequest) {
      this.logConnectionEvent('handle_online_short_circuit', {
        reason: 'active_connection_request_exists',
        code: currentCode,
        active_connection_attempt_id:
          this.activeConnectionRequest.connection_attempt_id,
        active_connection_lifecycle_id:
          this.activeConnectionRequest.connection_lifecycle_id,
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
      });
      return this.currentState(currentCode);
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
      this.logConnectionEvent('handle_online_short_circuit', {
        reason: 'pairing_in_progress_republish',
        status: currentStatus,
        code: currentCode,
        has_active_socket: hasActiveSocket,
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
      });
      this.wwebjsService.republishLastState();
      return this.currentState(currentCode);
    }

    if (
      currentStatus === EBaileysConnectionStatus.connecting &&
      hasActiveSocket &&
      awaitingQrRead
    ) {
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
      return this.connectWithService(data, {
        fromDisconnectRestart: false,
        requestedByUser: true,
        forceNew: true,
        allowRestore: false,
      });
    }

    if (isSessionInvalid) {
      this.logConnectionEvent('connection_session_invalid_clearing', {
        code: currentCode,
        connection_type: data.type,
      });

      await this.wwebjsService.disconnect({
        initial_connection: true,
        disconnected_user: false,
        preserve_session: false,
        remove_session: true,
      });
    }

    return this.connectWithService(data, {
      fromDisconnectRestart: isSessionInvalid,
      requestedByUser: true,
      allowRestore: !isSessionInvalid,
    });
  }

  private handleRecreating(): IBaileysConnectionState {
    this.wwebjsService.reconnect({ initial_connection: true });
    return this.currentState(ECodeMessage.awaitConnection);
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
    };

    await this.balanceWorkerStatusGrpcClientService.notifyWorkerStatus(payload);

    if (!removeSession) {
      const defaultConnectionRequest: StatusConnectionWorkerRequest = {
        worker_id: workerId,
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.qrcode,
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

    this.logConnectionEvent('connection_connect_invoked', {
      from_disconnect_restart: options.fromDisconnectRestart,
      requested_by_user: options.requestedByUser,
      force_new: forceNew,
      connection_type: data.type,
      has_phone_connection: Boolean(data.phone_connection),
      allow_restore: allowRestore,
      delegated_retry_owner: 'connection_service',
      connection_attempt_id: data.connection_attempt_id,
      connection_lifecycle_id: data.connection_lifecycle_id,
      qr_pending: data.qr_pending === true,
    });

    try {
      const state = await this.wwebjsService.connect({
        initial_connection: true,
        allow_restore: allowRestore,
        force_new: forceNew,
        requested_by_user: options.requestedByUser,
        from_disconnect_restart: options.fromDisconnectRestart,
        type: data.type as EBaileysConnectionType,
        phone_connection: data.phone_connection,
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
      });

      this.logConnectionEvent('connection_connect_result', {
        status: state?.status,
        code: state?.code,
        has_qr: Boolean(state?.qrcode),
        delegated_retry_owner: 'connection_service',
        connection_attempt_id:
          state?.connection_attempt_id ?? data.connection_attempt_id,
        connection_lifecycle_id:
          state?.connection_lifecycle_id ?? data.connection_lifecycle_id,
        has_pairing_code: Boolean(state?.pairing_code),
        qr_pending: state?.qr_pending === true,
        reason: state?.reason,
        time_to_first_qr_ms: state?.time_to_first_qr_ms,
      });

      return state;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logConnectionEvent(
        'connection_connect_error',
        {
          reason: errorMessage,
          delegated_retry_owner: 'connection_service',
          connection_attempt_id: data.connection_attempt_id,
          connection_lifecycle_id: data.connection_lifecycle_id,
        },
        'error'
      );
      throw error;
    }
  }

  private stopConnectionRetry(): void {
    const hadActiveRetry =
      Boolean(this.connectionRetryTimer) ||
      Boolean(this.activeConnectionRequest) ||
      this.connectionRetryAttempt > 0;

    if (this.connectionRetryTimer) {
      clearTimeout(this.connectionRetryTimer);
      this.connectionRetryTimer = null;
    }
    this.activeConnectionRequest = null;
    this.connectionRetryAttempt = 0;
    this.restartAfterDisconnect = false;

    if (hadActiveRetry) {
      this.logConnectionEvent('connection_retry_stopped');
    }
  }

  private scheduleNextAttempt(): void {
    if (!this.activeConnectionRequest) return;

    this.logConnectionEvent('connection_retry_scheduled', {
      attempt: this.connectionRetryAttempt,
      max_attempts: this.connectionRetryMinAttempts,
      delay_ms: this.connectionRetryIntervalMs,
    });

    this.connectionRetryTimer = setTimeout(() => {
      this.runConnectionAttempt();
    }, this.connectionRetryIntervalMs);
  }

  private handoffToServiceReconnect(): void {
    this.logConnectionEvent('connection_retry_handoff', {
      attempt: this.connectionRetryAttempt,
      max_attempts: this.connectionRetryMinAttempts,
    });
    this.stopConnectionRetry();
    this.wwebjsService.clearUserRequestedDisconnect();
    this.wwebjsService.reconnect({ initial_connection: true });
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
      connection_lifecycle_id:
        this.activeConnectionRequest?.connection_lifecycle_id,
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
    const workerId = wwebjsEnvironment.wwebjsWorkerId;
    const accountId = wwebjsEnvironment.wwebjsAccountId;

    const payload: IBaileysConnectionState = {
      status: EBaileysConnectionStatus.connected,
      worker_id: workerId,
      account_id: accountId,
      code: ECodeMessage.connectionEstablished,
      phone: getPhoneNumber(this.wwebjsService.socket?.info?.wid?._serialized),
      worker_status_id: EWorkerStatus.online,
      connection_attempt_id:
        this.activeConnectionRequest?.connection_attempt_id,
      connection_lifecycle_id:
        this.activeConnectionRequest?.connection_lifecycle_id,
    };

    await this.centrifugoService
      .publishSub(workerCentrifugoQueue(accountId), payload)
      .catch((error) => {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logConnectionEvent(
          'connection_connect_error',
          {
            reason: errorMessage,
            status: payload.status,
            code: payload.code,
          },
          'error'
        );
      });

    this.logConnectionEvent('connection_connect_result', {
      status: payload.status,
      code: payload.code,
      has_phone: Boolean(payload.phone),
      worker_status_id: payload.worker_status_id,
    });

    return payload;
  }

  private currentState(code: ECodeMessage): IBaileysConnectionState {
    return {
      status: this.wwebjsService.getStatus(),
      code,
      worker_id: wwebjsEnvironment.wwebjsWorkerId,
      account_id: wwebjsEnvironment.wwebjsAccountId,
      connection_attempt_id:
        this.activeConnectionRequest?.connection_attempt_id,
      connection_lifecycle_id:
        this.activeConnectionRequest?.connection_lifecycle_id,
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
      this.logConnectionEvent('connection_retry_paused_user_action', {
        status,
        code,
        has_active_socket: hasActiveSocket,
      });
      this.wwebjsService.republishLastState();
      this.stopConnectionRetry();
      return;
    }

    this.connectionRetryAttempt += 1;
    this.logConnectionEvent('connection_retry_attempt', {
      attempt: this.connectionRetryAttempt,
      max_attempts: this.connectionRetryMinAttempts,
    });

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

    this.logConnectionEvent('connection_connect_invoked', {
      attempt: this.connectionRetryAttempt,
      max_attempts: this.connectionRetryMinAttempts,
      status,
      has_active_socket: hasActiveSocket,
      from_disconnect_restart: fromDisconnectRestart,
      requested_by_user: !fromDisconnectRestart,
      connection_type: request.type,
      has_phone_connection: Boolean(request.phone_connection),
    });

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
        requested_by_user: !fromDisconnectRestart,
        from_disconnect_restart: fromDisconnectRestart,
        type: request.type as EBaileysConnectionType,
        phone_connection: request.phone_connection,
        connection_attempt_id: request.connection_attempt_id,
        connection_lifecycle_id: request.connection_lifecycle_id,
      })
      .then((state) => {
        this.logConnectionEvent('connection_connect_result', {
          attempt: this.connectionRetryAttempt,
          max_attempts: this.connectionRetryMinAttempts,
          status: state?.status,
          code: state?.code,
          has_qr: Boolean(state?.qrcode),
        });
        if (
          state?.qrcode ||
          state?.status === EBaileysConnectionStatus.connected
        ) {
          this.stopConnectionRetry();
        }
      })
      .catch((error) => {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logConnectionEvent(
          'connection_connect_error',
          {
            attempt: this.connectionRetryAttempt,
            max_attempts: this.connectionRetryMinAttempts,
            reason: errorMessage,
          },
          'error'
        );
      });

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

  private logConnectionEvent(
    event: string,
    details: Record<string, unknown> = {},
    level: 'info' | 'warn' | 'error' = 'info'
  ): void {
    recordConnectionLifecycle({
      stage: `connection.worker_wwebjs.status_consume.${event}`,
      decision: event,
      outcome: level === 'error' ? 'error' : 'logged',
      level,
      source_provider: 'wwebjs',
      worker_type: 'wwebjs',
      worker_id: wwebjsEnvironment.wwebjsWorkerId,
      channel_id: wwebjsEnvironment.wwebjsWorkerId,
      account_id: wwebjsEnvironment.wwebjsAccountId,
      connection_attempt_id:
        this.activeConnectionRequest?.connection_attempt_id,
      connection_lifecycle_id:
        this.activeConnectionRequest?.connection_lifecycle_id,
      ...details,
    });
  }
}
