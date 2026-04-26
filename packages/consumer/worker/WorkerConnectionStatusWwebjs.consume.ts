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
import { logger } from '@core/plugins/telemetry/logger';

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

  requestConnection(payload: StatusConnectionWorkerRequest): void {
    this.logConnectionEvent('connection_request_received', {
      status: payload.status,
      connection_type: payload.type,
      remove_session: payload.remove_session === true,
      has_phone_connection: Boolean(payload.phone_connection),
    });

    if (payload.type === EBaileysConnectionType.phone) {
      throw new Error('Phone connection is disabled. Use QR Code.');
    }

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
      await this.handleDisponible(data);
    }
  }

  private async handleOnline(
    data: StatusConnectionWorkerRequest
  ): Promise<void> {
    this.stopConnectionRetry();

    if (this.wwebjsService.isConnected()) {
      await this.publishConnectedStatus();
      return;
    }

    const currentCode = this.wwebjsService.getCode();
    const isSessionInvalid =
      currentCode === ECodeMessage.badSession ||
      currentCode === ECodeMessage.loggedOut;

    if (this.wwebjsService.hasSession() && !isSessionInvalid) {
      await this.waitForReconnection(3000, 500);
      if (this.wwebjsService.isConnected()) {
        await this.publishConnectedStatus();
        return;
      }
    }

    if (this.activeConnectionRequest) {
      return;
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
      return;
    }

    if (
      currentStatus === EBaileysConnectionStatus.connecting &&
      hasActiveSocket &&
      awaitingQrRead
    ) {
      await this.connectWithService(data, {
        fromDisconnectRestart: false,
        requestedByUser: true,
        forceNew: true,
      });
      return;
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

    await this.connectWithService(data, {
      fromDisconnectRestart: isSessionInvalid,
      requestedByUser: true,
      allowRestore: !isSessionInvalid,
    });
  }

  private handleRecreating(): void {
    this.wwebjsService.reconnect({ initial_connection: true });
  }

  private async handleDisponible(
    data: StatusConnectionWorkerRequest
  ): Promise<void> {
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
  }

  private async connectWithService(
    data: StatusConnectionWorkerRequest,
    options: {
      fromDisconnectRestart: boolean;
      requestedByUser: boolean;
      allowRestore?: boolean;
      forceNew?: boolean;
    }
  ): Promise<void> {
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
      });

      this.logConnectionEvent('connection_connect_result', {
        status: state?.status,
        code: state?.code,
        has_qr: Boolean(state?.qrcode),
        delegated_retry_owner: 'connection_service',
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logConnectionEvent(
        'connection_connect_error',
        {
          reason: errorMessage,
          delegated_retry_owner: 'connection_service',
        },
        'error'
      );
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

  private async publishConnectedStatus(): Promise<void> {
    const workerId = wwebjsEnvironment.wwebjsWorkerId;
    const accountId = wwebjsEnvironment.wwebjsAccountId;

    const payload: IBaileysConnectionState = {
      status: EBaileysConnectionStatus.connected,
      worker_id: workerId,
      account_id: accountId,
      code: ECodeMessage.connectionEstablished,
      phone: getPhoneNumber(this.wwebjsService.socket?.info?.wid?._serialized),
      worker_status_id: EWorkerStatus.online,
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
    const payload = {
      module: 'worker_wwebjs',
      component: 'worker_connection_status_consume',
      type: 'connection_status',
      event,
      worker_id: wwebjsEnvironment.wwebjsWorkerId,
      account_id: wwebjsEnvironment.wwebjsAccountId,
      ...details,
    };

    if (level === 'error') {
      logger.error(payload, 'Wwebjs worker connection status event');
      return;
    }

    if (level === 'warn') {
      logger.warn(payload, 'Wwebjs worker connection status event');
      return;
    }

    logger.info(payload, 'Wwebjs worker connection status event');
  }
}
