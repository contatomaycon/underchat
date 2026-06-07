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
import { recordConnectionLifecycle } from '@core/plugins/telemetry/connectionLifecycleDebug';

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

    if (this.baileysService.isConnected()) {
      this.logConnectionEvent('handle_online_short_circuit', {
        reason: 'already_connected',
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
      });
      return this.publishConnectedStatus();
    }

    if (this.baileysService.hasSession()) {
      this.logConnectionEvent('handle_online_restore_wait_start', {
        reason: 'existing_session_found',
        wait_ms: 3000,
        interval_ms: 500,
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
      });
      await this.waitForReconnection(3000, 500);
      if (this.baileysService.isConnected()) {
        this.logConnectionEvent('handle_online_restore_wait_success', {
          reason: 'connected_after_existing_session_wait',
          connection_attempt_id: data.connection_attempt_id,
          connection_lifecycle_id: data.connection_lifecycle_id,
        });
        return this.publishConnectedStatus();
      }
      this.logConnectionEvent('handle_online_restore_wait_timeout', {
        reason: 'existing_session_not_connected_after_wait',
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
      });
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
      this.logConnectionEvent('handle_online_short_circuit', {
        reason: 'pairing_in_progress_republish',
        status: currentStatus,
        code: currentCode,
        has_active_socket: hasActiveSocket,
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
      });
      this.baileysService.republishLastState();
      return this.currentState(currentCode);
    }

    if (
      currentStatus === EBaileysConnectionStatus.connecting &&
      hasActiveSocket &&
      awaitingQrRead
    ) {
      this.logConnectionEvent('connection_reopening_user_action_attempt', {
        status: currentStatus,
        code: currentCode,
        has_active_socket: hasActiveSocket,
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
      });
      try {
        return await this.baileysService.connect({
          initial_connection: true,
          force_new: true,
          requested_by_user: true,
          type: data.type as EBaileysConnectionType,
          phone_connection: data.phone_connection,
          connection_attempt_id: data.connection_attempt_id,
          connection_lifecycle_id: data.connection_lifecycle_id,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logConnectionEvent(
          'connection_reopening_user_action_error',
          {
            reason: errorMessage,
            connection_attempt_id: data.connection_attempt_id,
            connection_lifecycle_id: data.connection_lifecycle_id,
          },
          'error'
        );
        throw error;
      }
    }

    if (
      currentStatus === EBaileysConnectionStatus.connecting &&
      hasActiveSocket
    ) {
      this.logConnectionEvent('connection_restarting_stale_startup', {
        status: currentStatus,
        code: currentCode,
        has_active_socket: hasActiveSocket,
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
      });
      try {
        return await this.baileysService.connect({
          initial_connection: true,
          force_new: true,
          requested_by_user: true,
          type: data.type as EBaileysConnectionType,
          phone_connection: data.phone_connection,
          connection_attempt_id: data.connection_attempt_id,
          connection_lifecycle_id: data.connection_lifecycle_id,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logConnectionEvent(
          'connection_restart_stale_startup_error',
          {
            reason: errorMessage,
            connection_attempt_id: data.connection_attempt_id,
            connection_lifecycle_id: data.connection_lifecycle_id,
          },
          'error'
        );
        throw error;
      }
    }

    if (this.activeConnectionRequest) {
      this.logConnectionEvent('handle_online_short_circuit', {
        reason: 'active_connection_request_exists',
        status: currentStatus,
        code: currentCode,
        has_active_socket: hasActiveSocket,
        active_connection_attempt_id:
          this.activeConnectionRequest.connection_attempt_id,
        active_connection_lifecycle_id:
          this.activeConnectionRequest.connection_lifecycle_id,
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
      });
      return this.currentState(currentCode);
    }

    this.logConnectionEvent('handle_online_connect_start', {
      status: currentStatus,
      code: currentCode,
      has_active_socket: hasActiveSocket,
      has_session: this.baileysService.hasSession(),
      connection_attempt_id: data.connection_attempt_id,
      connection_lifecycle_id: data.connection_lifecycle_id,
    });
    const state = await this.baileysService.connect({
      initial_connection: true,
      force_new: false,
      requested_by_user: true,
      type: data.type as EBaileysConnectionType,
      phone_connection: data.phone_connection,
      connection_attempt_id: data.connection_attempt_id,
      connection_lifecycle_id: data.connection_lifecycle_id,
    });
    this.logConnectionEvent('handle_online_connect_success', {
      status: state.status,
      code: state.code,
      worker_status_id: state.worker_status_id,
      has_qr: Boolean(state.qrcode),
      has_pairing_code: Boolean(state.pairing_code),
      qr_pending: state.qr_pending === true,
      reason: state.reason,
      connection_attempt_id:
        state.connection_attempt_id ?? data.connection_attempt_id,
      connection_lifecycle_id:
        state.connection_lifecycle_id ?? data.connection_lifecycle_id,
      time_to_first_qr_ms: state.time_to_first_qr_ms,
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
    this.logConnectionEvent('connection_retry_started', {
      status: data.status,
      connection_type: data.type,
      from_disconnect_restart: this.restartAfterDisconnect,
      remove_session: data.remove_session === true,
      has_phone_connection: Boolean(data.phone_connection),
    });
    this.runConnectionAttempt();
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
      status: this.baileysService.getStatus(),
      code,
      worker_id: baileysEnvironment.baileysWorkerId,
      account_id: baileysEnvironment.baileysAccountId,
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
      this.logConnectionEvent('connection_retry_paused_user_action', {
        status,
        code,
        has_active_socket: hasActiveSocket,
      });
      this.baileysService.republishLastState();
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
      this.baileysService.clearUserRequestedDisconnect();
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

    const connectPromise = this.baileysService
      .connect({
        initial_connection: true,
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
        if (
          this.activeConnectionRequest &&
          !this.baileysService.isConnected()
        ) {
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
      stage: `connection.worker_baileys.status_consume.${event}`,
      decision: event,
      outcome: level === 'error' ? 'error' : 'logged',
      level,
      source_provider: 'baileys',
      worker_type: 'baileys',
      worker_id: baileysEnvironment.baileysWorkerId,
      channel_id: baileysEnvironment.baileysWorkerId,
      account_id: baileysEnvironment.baileysAccountId,
      connection_attempt_id:
        this.activeConnectionRequest?.connection_attempt_id,
      connection_lifecycle_id:
        this.activeConnectionRequest?.connection_lifecycle_id,
      ...details,
    });
  }
}
