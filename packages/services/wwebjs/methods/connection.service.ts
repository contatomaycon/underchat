import whatsappWeb, { type ChatState } from '@wwebjs/whatsapp-web.js';
import QRCode from 'qrcode';
import fs from 'node:fs';
import path from 'node:path';
import { singleton, inject } from 'tsyringe';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { wwebjsEnvironment } from '@core/config/environments';
import { EBaileysConnectionStatus as Status } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EWppConnection } from '@core/common/enums/EWppConnection';
import { wppConnectionMappings } from '@core/mappings/wppConnection.mappings';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { IBaileysConnection } from '@core/common/interfaces/IBaileysConnection';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { EAppEnvironment } from '@core/common/enums/EAppEnvironment';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { BalanceWorkerStatusGrpcClientService } from '@core/services/balanceWorkerStatusGrpcClient.service';
import {
  chatAccountCentrifugo,
  workerCentrifugoQueue,
} from '@core/common/functions/centrifugoQueue';
import { getPhoneNumber } from '@core/common/functions/getPhoneNumber';
import { buildWppConnectionDocumentId } from '@core/common/functions/buildWppConnectionDocumentId';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { WwebjsIncomingMessageService } from './incoming.service';
import { WwebjsHealthCheckService } from './healthCheck.service';
import { IChatTyping } from '@core/common/interfaces/IChatTyping';
import { EProxyProtocol } from '@core/common/enums/EProxyProtocol';
import { logger } from '@core/plugins/telemetry/logger';
import { recordConnectionLifecycle } from '@core/plugins/telemetry/connectionLifecycleDebug';

const FOLDER = `/app/data/wwebjs/storage/${wwebjsEnvironment.wwebjsWorkerId}`;
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const CHANNEL = workerCentrifugoQueue(wwebjsEnvironment.wwebjsAccountId);
const CHAT_CHANNEL = chatAccountCentrifugo(wwebjsEnvironment.wwebjsAccountId);
const WORKER = wwebjsEnvironment.wwebjsWorkerId;
const ACCOUNT = wwebjsEnvironment.wwebjsAccountId;
const RETRY_DELAY = 60_000;
const MAX_RETRIES = 10;
const RECONNECT_COOLDOWN_DELAY = 30 * 60 * 1000;
const MAX_QR_GENERATIONS = 3;
const CONNECTION_STATE_RECONCILE_INTERVAL_MS = 5_000;
const CONNECTION_STATE_RECONCILE_TIMEOUT_MS = 120_000;
const CONNECTION_STATE_CHECK_TIMEOUT_MS = 10_000;
const CONNECTION_STATE_READY_GRACE_MS = 30_000;
const CONNECTION_EVENT_BRIDGE_ATTACH_TIMEOUT_MS = 20_000;
const CONNECTION_PAGE_CHECK_TIMEOUT_MS = 5_000;
const DEFAULT_PUPPETEER_PROTOCOL_TIMEOUT_MS = 300_000;
const SHOULD_PRINT_QR_IN_TERMINAL =
  process.env.APP_ENVIRONMENT === EAppEnvironment.local;
const SHOULD_LOG_CONNECTION_IP =
  process.env.APP_ENVIRONMENT === EAppEnvironment.local;
const HISTORY_RECONCILIATION_ENABLED =
  process.env.HISTORY_RECONCILIATION_ENABLED !== 'false';
const CHROMIUM_LOCK_FILE_NAMES = [
  'SingletonLock',
  'SingletonSocket',
  'SingletonCookie',
] as const;
const CHROMIUM_PROFILE_SUBDIRECTORIES = ['', 'Default'] as const;
const PUPPETEER_PROTOCOL_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(
    process.env.WWEBJS_PROTOCOL_TIMEOUT_MS ?? '',
    10
  );
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return DEFAULT_PUPPETEER_PROTOCOL_TIMEOUT_MS;
})();

function readProxyConfig(): {
  protocol: EProxyProtocol;
  host: string;
  port: number;
  username?: string;
  password?: string;
} | null {
  const host = process.env.PROXY_HOST?.trim();
  const port = Number.parseInt(process.env.PROXY_PORT ?? '', 10);

  if (!host || !Number.isFinite(port) || port <= 0) {
    return null;
  }

  const rawProtocol = process.env.PROXY_PROTOCOL?.trim();
  const protocol = Object.values(EProxyProtocol).includes(
    rawProtocol as EProxyProtocol
  )
    ? (rawProtocol as EProxyProtocol)
    : EProxyProtocol.http;

  const username = process.env.PROXY_USERNAME?.trim();
  const password = process.env.PROXY_PASSWORD?.trim();

  return {
    protocol,
    host,
    port,
    username: username || undefined,
    password: password || undefined,
  };
}

const { Client: ClientCtor, LocalAuth } = whatsappWeb;
type Client = InstanceType<typeof ClientCtor>;
type WwebjsPageLike = {
  evaluate<T>(pageFunction: () => T | Promise<T>): Promise<T>;
};
type WwebjsClientInternals = Client & {
  attachEventListeners?: () => Promise<void>;
  pupPage?: WwebjsPageLike;
};

@singleton()
export class WwebjsConnectionService {
  private client: Client | undefined;
  private status: Status = Status.initial;
  private code: ECodeMessage = ECodeMessage.awaitConnection;
  private connectionEstablished = false;
  private userRequestedDisconnect = false;
  private initialConnection = false;
  private connecting = false;
  private retryCount = 0;
  private qrGenerationCount = 0;
  private qrReadSessionActive = false;
  private qrReadSessionLocked = false;
  private disconnectRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private connectionStateProbeTimer: ReturnType<typeof setTimeout> | undefined;
  private teardownPromise: Promise<void> = Promise.resolve();
  private currentPromise: Promise<IBaileysConnectionState> | undefined;
  private pendingResolve: ((s: IBaileysConnectionState) => void) | undefined;
  private connectionAttemptSequence = 0;
  private activeConnectionAttemptId: number | undefined;
  private lastPayload: string | null = null;
  private qrHash: string | undefined;
  private typeConnection: EBaileysConnectionType =
    EBaileysConnectionType.qrcode;
  private phoneConnection: string | undefined;
  private connectionAttemptId: string | undefined;

  constructor(
    @inject(CentrifugoService)
    private readonly centrifugo: CentrifugoService,
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(BalanceWorkerStatusGrpcClientService)
    private readonly balanceWorkerStatusGrpcClientService: BalanceWorkerStatusGrpcClientService,
    @inject(WwebjsIncomingMessageService)
    private readonly incomingMessageService: WwebjsIncomingMessageService,
    @inject(WwebjsHealthCheckService)
    private readonly healthCheckService: WwebjsHealthCheckService
  ) {
    this.configureHealthCheck();
  }

  private configureHealthCheck(): void {
    this.healthCheckService.configure({
      getClient: () => this.client,
      getStatus: () => this.status,
      getCode: () => this.code,
      reconnect: (input) => this.reconnect(input),
      isConnected: () => this.connected,
      hasSession: () => this.hasSession(),
      onStatusMismatch: (detectedStatus) => {
        this.handleHealthCheckMismatch(detectedStatus);
      },
    });
  }

  private handleHealthCheckMismatch(detectedStatus: Status): void {
    if (detectedStatus === Status.disconnected && this.connectionEstablished) {
      console.log(
        '[WwebjsConnection] Health check detected disconnection, triggering reconnect'
      );
      this.connectionEstablished = false;
      this.setStatus(Status.disconnected, ECodeMessage.connectionLost);
      this.healthCheckService.stop();
      this.cancelAttempt(false);

      if (!this.userRequestedDisconnect) {
        this.scheduleNextReconnectAttempt();
      }
    }
  }

  get connected(): boolean {
    return this.connectionEstablished && this.status === Status.connected;
  }

  getStatus(): Status {
    return this.status;
  }

  getCode(): ECodeMessage {
    return this.code;
  }

  getSocket(): Client | undefined {
    return this.client;
  }

  clearUserRequestedDisconnect(): void {
    this.userRequestedDisconnect = false;
  }

  republishLastState(): void {
    if (!this.lastPayload || !this.initialConnection) {
      return;
    }

    try {
      const payload = JSON.parse(this.lastPayload) as IBaileysConnectionState;
      void this.centrifugo.publishSub(CHANNEL, payload).catch((error) => {
        console.error('[WwebjsConnection] Republish failed', error);
      });
    } catch (error) {
      console.error('[WwebjsConnection] Failed to parse lastPayload', error);
    }
  }

  hasSession(): boolean {
    const sessionPath = this.getSessionPath();
    return fs.existsSync(sessionPath) && fs.readdirSync(sessionPath).length > 0;
  }

  async connect(input: IBaileysConnection): Promise<IBaileysConnectionState> {
    const {
      initial_connection: initialConnection = false,
      allow_restore: allowRestore = true,
      type: typeConnection = EBaileysConnectionType.qrcode,
      phone_connection: phoneConnection,
      force_new: forceNew = false,
      requested_by_user: requestedByUser = false,
      from_disconnect_restart: fromDisconnectRestart = false,
      connection_attempt_id: connectionAttemptId,
    } = input;
    const normalizedPhoneConnection =
      this.normalizePhoneConnection(phoneConnection);
    const effectivePhoneConnection =
      typeConnection === EBaileysConnectionType.phone
        ? (normalizedPhoneConnection ?? this.phoneConnection)
        : undefined;

    this.logConnectionEvent('connect_requested', {
      requested_by_user: requestedByUser,
      from_disconnect_restart: fromDisconnectRestart,
      force_new: forceNew,
      allow_restore: allowRestore,
      connection_type: typeConnection,
      has_phone_connection: Boolean(effectivePhoneConnection),
      has_session: this.hasSession(),
      has_active_socket: Boolean(this.client),
    });

    if (typeConnection === EBaileysConnectionType.phone) {
      this.logConnectionEvent('connect_rejected', {
        reason: 'phone_connection_disabled',
      });
      throw new Error('Phone connection is disabled. Use QR Code.');
    }

    if (requestedByUser) {
      this.userRequestedDisconnect = false;
    }

    if (this.userRequestedDisconnect && !fromDisconnectRestart) {
      this.logConnectionEvent('connect_short_circuit', {
        reason: 'user_requested_disconnect_guard',
        requested_by_user: requestedByUser,
        from_disconnect_restart: fromDisconnectRestart,
      });
      return this.state();
    }

    this.initialConnection = initialConnection;
    this.typeConnection = typeConnection;
    this.phoneConnection = effectivePhoneConnection;
    this.connectionAttemptId = connectionAttemptId;
    this.trackQrReadSession(requestedByUser, typeConnection);

    if (this.connected) {
      this.logConnectionEvent('connect_short_circuit', {
        reason: 'already_connected',
      });
      return this.reportConnected();
    }

    const forcedRestartActiveConnection =
      forceNew && this.connecting && (requestedByUser || fromDisconnectRestart);

    if (forcedRestartActiveConnection) {
      this.logConnectionEvent('connection_force_new_active_attempt', {
        requested_by_user: requestedByUser,
        from_disconnect_restart: fromDisconnectRestart,
        active_attempt_id: this.activeConnectionAttemptId,
      });
      this.cancelAttempt(false);
    }

    if (this.connecting && this.currentPromise) {
      this.logConnectionEvent('connect_short_circuit', {
        reason: 'already_connecting',
        active_attempt_id: this.activeConnectionAttemptId,
      });
      return this.currentPromise;
    }

    if (forceNew && this.connecting && !forcedRestartActiveConnection) {
      this.logConnectionEvent('connect_short_circuit', {
        reason: 'force_new_ignored_while_connecting',
        from_disconnect_restart: fromDisconnectRestart,
        active_attempt_id: this.activeConnectionAttemptId,
      });
      return this.currentPromise ?? this.state();
    }

    if (forceNew && !this.connecting && !forcedRestartActiveConnection) {
      this.cancelAttempt(false);
    }

    if (
      (this.status === Status.initial || this.status === Status.disconnected) &&
      allowRestore &&
      this.hasSession()
    ) {
      this.logConnectionEvent('connect_short_circuit', {
        reason: 'restore_session',
        allow_restore: allowRestore,
      });
      return this.startConnection(fromDisconnectRestart);
    }

    if (
      this.typeConnection === EBaileysConnectionType.qrcode &&
      !requestedByUser &&
      (this.qrReadSessionLocked ||
        (!this.qrReadSessionActive && !this.hasSession()))
    ) {
      this.logConnectionEvent('connect_short_circuit', {
        reason: 'qr_session_locked_or_inactive',
        connection_type: this.typeConnection,
        requested_by_user: requestedByUser,
      });
      return this.state();
    }

    return this.startConnection(fromDisconnectRestart);
  }

  async disconnect(input: IBaileysConnection): Promise<void> {
    const {
      initial_connection: initialConnection = false,
      disconnected_user: disconnectedUser = false,
      preserve_session: preserveSession = true,
      remove_session: removeSession = false,
    } = input;
    const shouldRemoveSession = removeSession || !preserveSession;

    this.logConnectionEvent('disconnect_requested', {
      requested_by_user: disconnectedUser,
      preserve_session: preserveSession,
      remove_session: removeSession,
      should_remove_session: shouldRemoveSession,
      initial_connection: initialConnection,
    });

    this.initialConnection = initialConnection;
    this.connectionEstablished = false;
    if (disconnectedUser || shouldRemoveSession) {
      this.publishLogoutInProgress();
    }

    await this.healthCheckService.notifyDisconnected(
      disconnectedUser ? 'User requested disconnect' : 'Connection closed'
    );
    this.healthCheckService.stop();
    this.clearDisconnectRetryTimer();

    if (disconnectedUser) {
      this.userRequestedDisconnect = true;
    }
    this.retryCount = 0;
    this.resetQrReadSession();
    this.qrReadSessionLocked = false;

    await this.safeDestroy(shouldRemoveSession);
    this.cancelAttempt(false);
    if (shouldRemoveSession) {
      this.clearFolder();
    }

    this.saveLogWppConnection({
      worker_id: WORKER,
      status: this.status,
      code: this.code?.toString(),
      message: 'WwebjsConnectionService disconnected',
      date: new Date(),
    });

    this.setStatus(Status.disconnected, ECodeMessage.connectionClosed);

    const payload: IBaileysConnectionState = {
      status: this.status,
      worker_id: WORKER,
      account_id: ACCOUNT,
      code: this.code,
      disconnected_user: disconnectedUser,
      worker_status_id: EWorkerStatus.disponible,
    };

    this.publishSub(payload, true);

    await this.balanceWorkerStatusGrpcClientService.notifyWorkerStatus(payload);

    const shouldReconnect =
      this.initialConnection && !disconnectedUser && !shouldRemoveSession;

    if (shouldReconnect) {
      this.scheduleNextReconnectAttempt();
    }
  }

  reconnect(input: IBaileysConnection): void {
    const { initial_connection: initialConnection = true } = input;
    this.initialConnection = initialConnection;

    if (
      initialConnection &&
      this.hasSession() &&
      !this.userRequestedDisconnect &&
      this.initialConnection
    ) {
      this.scheduleNextReconnectAttempt();
      return;
    }

    this.connect({
      initial_connection: initialConnection,
    }).catch(() => {
      this.saveLogWppConnection({
        worker_id: WORKER,
        status: this.status ?? Status.disconnected,
        code: this.code ?? ECodeMessage.connectionLost,
        message: 'Reconnect failed',
        date: new Date(),
      });
    });
  }

  async shutdown(): Promise<void> {
    this.logConnectionEvent('shutdown', {
      has_active_socket: Boolean(this.client),
      has_session: this.hasSession(),
    });
    this.resetQrReadSession();
    this.qrReadSessionLocked = false;
    this.pendingResolve?.(this.state());
    this.pendingResolve = undefined;
    this.currentPromise = undefined;
    this.connecting = false;
    this.connectionEstablished = false;
    this.retryCount = 0;
    this.healthCheckService.stop();
    this.clearDisconnectRetryTimer();
    this.clearConnectionStateProbe();
    this.incomingMessageService.unbind();

    if (this.client) {
      try {
        await this.client.destroy();
      } catch {}
      this.client = undefined;
    }

    this.clearChromiumProfileLock();
  }

  private startConnection(
    fromDisconnectRestart = false
  ): Promise<IBaileysConnectionState> {
    const attemptId = ++this.connectionAttemptSequence;

    this.prepareFolder();
    this.clearDisconnectRetryTimer();
    this.clearConnectionStateProbe();
    this.connecting = true;
    this.setStatus(Status.connecting, ECodeMessage.awaitConnection);
    this.publishConnectionStarting();
    this.activeConnectionAttemptId = attemptId;
    if (!fromDisconnectRestart) {
      this.retryCount = 0;
    }
    this.logConnectionEvent('connection_attempt_started', {
      attempt_id: attemptId,
      from_disconnect_restart: fromDisconnectRestart,
      connection_type: this.typeConnection,
    });
    this.currentPromise = this.waitForPendingTeardown()
      .then(() => this.createAndWaitClient(attemptId))
      .finally(() => {
        this.connecting = false;
        this.currentPromise = undefined;
        if (this.activeConnectionAttemptId === attemptId) {
          this.activeConnectionAttemptId = undefined;
        }
      });

    return this.currentPromise;
  }

  private waitForPendingTeardown(): Promise<void> {
    return this.teardownPromise.catch(() => undefined);
  }

  private queueTeardown(
    operation: string,
    teardown: () => Promise<void>
  ): void {
    this.teardownPromise = this.teardownPromise
      .catch(() => undefined)
      .then(async () => {
        this.logConnectionEvent('connection_teardown_started', {
          operation,
          active_attempt_id: this.activeConnectionAttemptId,
        });
        await teardown();
        this.logConnectionEvent('connection_teardown_finished', {
          operation,
        });
      });
  }

  private prepareFolder(): void {
    if (!fs.existsSync(FOLDER)) {
      fs.mkdirSync(FOLDER, { recursive: true });
    }
  }

  private clearFolder(): void {
    if (!fs.existsSync(FOLDER)) {
      return;
    }

    for (const f of fs.readdirSync(FOLDER)) {
      try {
        fs.rmSync(path.join(FOLDER, f), { recursive: true, force: true });
      } catch {}
    }
  }

  private getSessionPath(): string {
    return path.join(FOLDER, '.wwebjs_auth', `session-${WORKER}`);
  }

  private clearChromiumProfileLock(): void {
    const sessionDir = this.getSessionPath();
    if (!fs.existsSync(sessionDir)) {
      return;
    }

    for (const subDirectory of CHROMIUM_PROFILE_SUBDIRECTORIES) {
      const targetDir = subDirectory
        ? path.join(sessionDir, subDirectory)
        : sessionDir;

      for (const name of CHROMIUM_LOCK_FILE_NAMES) {
        try {
          fs.rmSync(path.join(targetDir, name), {
            force: true,
            recursive: true,
          });
        } catch {}
      }
    }
  }

  private clearDisconnectRetryTimer(): void {
    if (!this.disconnectRetryTimer) {
      return;
    }

    clearTimeout(this.disconnectRetryTimer);
    this.disconnectRetryTimer = undefined;
  }

  private clearConnectionStateProbe(): void {
    if (!this.connectionStateProbeTimer) {
      return;
    }

    clearTimeout(this.connectionStateProbeTimer);
    this.connectionStateProbeTimer = undefined;
  }

  private publishReconnectAttempt(attempt: number, delayMs: number): void {
    const retryPayload: IBaileysConnectionState = {
      status: Status.connecting,
      worker_id: WORKER,
      account_id: ACCOUNT,
      code: ECodeMessage.awaitConnection,
      attempt,
      max_attempts: MAX_RETRIES,
      seconds_until_next_attempt: Math.ceil(delayMs / 1000),
      connection_attempt_id: this.connectionAttemptId,
    };

    this.publishSub(retryPayload, true);
  }

  private publishConnectionStarting(): void {
    if (
      this.typeConnection === EBaileysConnectionType.qrcode &&
      this.qrReadSessionActive &&
      !this.qrReadSessionLocked
    ) {
      return;
    }

    this.publishSub(
      {
        status: Status.connecting,
        worker_id: WORKER,
        account_id: ACCOUNT,
        code: ECodeMessage.awaitConnection,
        connection_attempt_id: this.connectionAttemptId,
      },
      true
    );
  }

  private publishLogoutInProgress(): void {
    this.setStatus(Status.connecting, ECodeMessage.logoutInProgress);
    this.publishSub(
      {
        status: Status.connecting,
        worker_id: WORKER,
        account_id: ACCOUNT,
        code: ECodeMessage.logoutInProgress,
        disconnected_user: true,
      },
      true
    );
  }

  private scheduleReconnectCooldown(): void {
    this.clearDisconnectRetryTimer();
    this.disconnectRetryTimer = setTimeout(() => {
      this.disconnectRetryTimer = undefined;
      this.scheduleNextReconnectAttempt();
    }, RECONNECT_COOLDOWN_DELAY);
  }

  private scheduleNextReconnectAttempt(forceNew = false): void {
    if (!this.shouldScheduleRetryAfterDisconnect()) {
      return;
    }

    if (this.retryCount >= MAX_RETRIES) {
      this.retryCount = 0;
      this.publishReconnectAttempt(MAX_RETRIES, RECONNECT_COOLDOWN_DELAY);
      this.scheduleReconnectCooldown();
      return;
    }

    const nextAttempt = this.retryCount + 1;
    const delayMs = nextAttempt === 1 ? 0 : RETRY_DELAY;

    this.retryCount = nextAttempt;
    this.logConnectionEvent('reconnect_scheduled', {
      attempt: nextAttempt,
      max_attempts: MAX_RETRIES,
      delay_ms: delayMs,
      force_new: forceNew,
      connection_type: this.typeConnection,
      has_phone_connection: Boolean(this.phoneConnection),
      requested_by_user: false,
      from_disconnect_restart: true,
    });
    this.publishReconnectAttempt(nextAttempt, delayMs);

    this.clearDisconnectRetryTimer();
    this.disconnectRetryTimer = setTimeout(() => {
      this.disconnectRetryTimer = undefined;
      this.logConnectionEvent('reconnect_triggered', {
        attempt: nextAttempt,
        max_attempts: MAX_RETRIES,
        delay_ms: delayMs,
        force_new: forceNew,
        connection_type: this.typeConnection,
        has_phone_connection: Boolean(this.phoneConnection),
        from_disconnect_restart: true,
      });
      this.connect({
        initial_connection: this.initialConnection,
        force_new: forceNew,
        allow_restore: true,
        type: this.typeConnection,
        phone_connection: this.phoneConnection,
        requested_by_user: false,
        from_disconnect_restart: true,
      }).catch(() => {
        this.logConnectionEvent(
          'connection_connect_error',
          {
            attempt: nextAttempt,
            max_attempts: MAX_RETRIES,
            reason: 'Reconnect attempt failed',
          },
          'error'
        );
        this.scheduleNextReconnectAttempt(forceNew);
      });
    }, delayMs);
  }

  private isActiveClient(client: Client): boolean {
    return this.client === client;
  }

  private async printQrInConsole(qr: string): Promise<void> {
    if (!SHOULD_PRINT_QR_IN_TERMINAL) {
      return;
    }

    try {
      const terminalQr = await QRCode.toString(qr, {
        type: 'terminal',
        small: true,
      });

      console.log('\n[Wwebjs][QR] Escaneie o QR code abaixo:\n');
      console.log(terminalQr);
      console.log('[Wwebjs][QR] Fim do QR code\n');
    } catch (error) {
      console.error('[Wwebjs][QR] Falha ao renderizar QR no console', error);
    }
  }

  private isChromiumProfileLockedError(message: string): boolean {
    const normalizedMessage = message.toLowerCase();

    return (
      normalizedMessage.includes(
        'profile appears to be in use by another chromium process'
      ) ||
      normalizedMessage.includes('chromium has locked the profile') ||
      normalizedMessage.includes('process_singleton_posix')
    );
  }

  private reconnectAfterProfileUnlock(): void {
    this.scheduleNextReconnectAttempt(true);
  }

  private isTransientInitializeError(message: string): boolean {
    const normalizedMessage = message.toLowerCase();

    return (
      normalizedMessage.includes('execution context was destroyed') ||
      normalizedMessage.includes('most likely because of a navigation') ||
      normalizedMessage.includes('cannot find context with specified id') ||
      normalizedMessage.includes('target closed') ||
      normalizedMessage.includes('attempted to use detached frame') ||
      normalizedMessage.includes('runtime.callfunctionon timed out') ||
      normalizedMessage.includes('protocol error (runtime.callfunctionon)')
    );
  }

  private reconnectAfterTransientInitializeError(): void {
    this.scheduleNextReconnectAttempt(false);
  }

  private async handleInitializeError(
    message: string,
    client: Client,
    attemptId?: number
  ): Promise<void> {
    if (!this.isActiveClient(client)) {
      this.logConnectionEvent(
        'initialize_error',
        {
          reason: message,
          stale_client: true,
          attempt_id: attemptId,
        },
        'warn'
      );
      console.warn('[Wwebjs] Ignoring initialize error from stale client:', {
        message,
      });
      return;
    }

    this.logConnectionEvent(
      'initialize_error',
      {
        reason: message,
        attempt_id: attemptId,
      },
      'error'
    );
    console.error('[Wwebjs] client.initialize() failed:', message);
    this.setStatus(Status.disconnected, ECodeMessage.connectionLost);
    this.clearConnectionStateProbe();
    this.pendingResolve?.(this.state());
    this.pendingResolve = undefined;
    this.clearDisconnectRetryTimer();

    this.queueTeardown('initialize_error', async () => {
      if (!this.client || !this.isActiveClient(client)) {
        return;
      }

      try {
        await this.client.destroy();
      } catch {}

      this.client = undefined;
      this.clearChromiumProfileLock();
    });

    await this.waitForPendingTeardown();

    if (this.isChromiumProfileLockedError(message)) {
      this.clearChromiumProfileLock();
      this.reconnectAfterProfileUnlock();
    } else if (this.isTransientInitializeError(message)) {
      this.reconnectAfterTransientInitializeError();
    } else {
      this.clearFolder();

      if (
        this.typeConnection === EBaileysConnectionType.qrcode &&
        this.initialConnection &&
        !this.userRequestedDisconnect
      ) {
        this.retryCount = 0;
        this.logConnectionEvent('initialize_error_scheduling_qr', {
          connection_type: this.typeConnection,
          reason: message,
        });
        this.clearDisconnectRetryTimer();
        this.disconnectRetryTimer = setTimeout(() => {
          this.disconnectRetryTimer = undefined;
          this.connect({
            initial_connection: this.initialConnection,
            force_new: false,
            allow_restore: false,
            type: this.typeConnection,
            requested_by_user: false,
            from_disconnect_restart: true,
          }).catch(() => {
            this.scheduleNextReconnectAttempt();
          });
        }, RETRY_DELAY);
      }
    }

    this.saveLogWppConnection({
      worker_id: WORKER,
      status: Status.disconnected,
      code: ECodeMessage.connectionLost,
      message,
      date: new Date(),
    });
  }

  private createAndWaitClient(
    attemptId: number
  ): Promise<IBaileysConnectionState> {
    return new Promise<IBaileysConnectionState>((resolve) => {
      this.pendingResolve = resolve;

      this.clearChromiumProfileLock();

      const authPath = path.join(FOLDER, `.wwebjs_auth`);
      const proxy = readProxyConfig();
      const puppeteerOpts: {
        headless: boolean;
        args: string[];
        executablePath?: string;
        protocolTimeout?: number;
      } = {
        headless: true,
        protocolTimeout: PUPPETEER_PROTOCOL_TIMEOUT_MS,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
        ],
      };

      if (proxy) {
        puppeteerOpts.args.push(
          `--proxy-server=${proxy.protocol}://${proxy.host}:${proxy.port}`
        );
      }

      const systemChrome = process.env.PUPPETEER_EXECUTABLE_PATH;
      if (systemChrome) {
        puppeteerOpts.executablePath = systemChrome;
      }

      const clientOptions: ConstructorParameters<typeof ClientCtor>[0] = {
        authStrategy: new LocalAuth({
          clientId: WORKER,
          dataPath: authPath,
        }),
        puppeteer: puppeteerOpts,
        emitHistoricalEvents: HISTORY_RECONCILIATION_ENABLED,
        resolveCiphertextMessages: true,
        ciphertextResolutionDelaysMs: [
          2000, 5000, 10000, 20000, 30000, 45000, 60000, 90000, 120000,
        ],
      };

      if (proxy?.username && proxy.password) {
        clientOptions.proxyAuthentication = {
          username: proxy.username,
          password: proxy.password,
        };
      }

      if (
        this.typeConnection === EBaileysConnectionType.phone &&
        this.phoneConnection
      ) {
        clientOptions.pairWithPhoneNumber = {
          phoneNumber: this.phoneConnection,
        };
      }

      const client = new ClientCtor(clientOptions);

      this.client = client;
      this.incomingMessageService.bindTo(client);
      this.startConnectionStateProbe(client, attemptId, proxy);
      this.logConnectionEvent('client_initialized', {
        attempt_id: attemptId,
      });

      client.on('code', (code: string) => {
        if (!this.isActiveClient(client)) {
          return;
        }

        if (this.typeConnection !== EBaileysConnectionType.phone) {
          return;
        }

        if (this.connectionEstablished || this.status === Status.connected) {
          return;
        }

        const pairingCode = code?.trim();
        if (!pairingCode) {
          return;
        }

        this.setStatus(Status.connecting, ECodeMessage.awaitingPairingCode);

        const payload: IBaileysConnectionState = {
          status: this.status,
          code: this.code,
          pairing_code: pairingCode,
          worker_id: WORKER,
          account_id: ACCOUNT,
          worker_status_id: EWorkerStatus.disponible,
        };

        this.publishSub(payload, true);
        void this.notifyWorkerStatusSafely(payload, 'pairing_code');
        this.pendingResolve?.(payload);
        this.pendingResolve = undefined;
      });

      client.on('qr', async (qr: string) => {
        if (!this.isActiveClient(client)) {
          return;
        }

        if (
          this.typeConnection !== EBaileysConnectionType.qrcode ||
          !this.qrReadSessionActive ||
          this.qrReadSessionLocked
        ) {
          return;
        }

        const hash = qr.slice(-20);
        if (hash === this.qrHash) {
          return;
        }

        if (this.qrGenerationCount >= MAX_QR_GENERATIONS) {
          this.handleQrGenerationLimitReached();
          return;
        }

        this.qrHash = hash;
        this.qrGenerationCount += 1;
        this.setStatus(Status.connecting, ECodeMessage.awaitingReadQrCode);
        const qrGeneratedAt = new Date().toISOString();
        this.logConnectionEvent('qr_generated', {
          attempt_id: attemptId,
          attempt: this.qrGenerationCount,
          max_attempts: MAX_QR_GENERATIONS,
          connection_type: this.typeConnection,
        });

        await this.printQrInConsole(qr);
        const img = await QRCode.toDataURL(qr);
        if (!this.isActiveClient(client)) {
          return;
        }

        const payload: IBaileysConnectionState = {
          status: this.status,
          code: this.code,
          qrcode: img,
          worker_id: WORKER,
          account_id: ACCOUNT,
          attempt: this.qrGenerationCount,
          max_attempts: MAX_QR_GENERATIONS,
          worker_status_id: EWorkerStatus.disponible,
          connection_attempt_id: this.connectionAttemptId,
          qr_generated_at: qrGeneratedAt,
        };

        void this.notifyWorkerStatusSafely(payload, 'qr');

        if (!this.initialConnection) {
          this.saveLogWppConnection({
            worker_id: WORKER,
            status: this.status,
            code: this.code?.toString(),
            message: 'QR Code received',
            date: new Date(),
          });
        }

        this.pendingResolve?.(this.state(img, qrGeneratedAt));
        this.pendingResolve = undefined;
      });

      client.on('authenticated', () => {
        if (!this.isActiveClient(client)) {
          return;
        }

        if (
          this.typeConnection !== EBaileysConnectionType.qrcode ||
          (!this.qrReadSessionActive &&
            this.code !== ECodeMessage.awaitingReadQrCode) ||
          this.connectionEstablished ||
          this.status === Status.connected
        ) {
          return;
        }

        this.qrReadSessionActive = false;
        this.qrReadSessionLocked = true;
        this.qrHash = undefined;
        this.setStatus(Status.connecting, ECodeMessage.pairingInProgress);

        const payload: IBaileysConnectionState = {
          status: this.status,
          code: this.code,
          worker_id: WORKER,
          account_id: ACCOUNT,
          is_new_login: true,
          worker_status_id: EWorkerStatus.disponible,
        };

        this.publishSub(payload, true);
        void this.notifyWorkerStatusSafely(payload, 'pairing_in_progress');
        this.logConnectionEvent('pairing_in_progress', {
          attempt_id: attemptId,
          connection_type: this.typeConnection,
        });
      });

      client.on('ready', () => {
        if (!this.isActiveClient(client)) {
          return;
        }

        this.markConnected(client, attemptId, proxy, 'ready');
      });

      client.on('disconnected', (reason: string) => {
        if (!this.isActiveClient(client)) {
          return;
        }

        this.connectionEstablished = false;
        this.clearConnectionStateProbe();
        const statusCode = this.mapDisconnectReason(reason);

        void this.healthCheckService.notifyDisconnected(reason);
        this.healthCheckService.stop();
        this.setStatus(Status.disconnected, statusCode);
        this.logConnectionEvent('disconnected', {
          attempt_id: attemptId,
          reason: reason || 'Wwebjs disconnected',
          mapped_code: statusCode,
          from_disconnect_restart: false,
        });

        const isMismatchedStatus =
          statusCode === ECodeMessage.loggedOut ||
          statusCode === ECodeMessage.multideviceMismatch ||
          statusCode === ECodeMessage.badSession ||
          statusCode === ECodeMessage.connectionReplaced;

        const workerStatusId = isMismatchedStatus
          ? EWorkerStatus.mismatched
          : EWorkerStatus.offline;

        const payload: IBaileysConnectionState = {
          status: this.status,
          worker_id: WORKER,
          account_id: ACCOUNT,
          code: statusCode,
          worker_status_id: workerStatusId,
        };

        this.publishSub(payload, true);

        this.saveLogWppConnection({
          worker_id: WORKER,
          status: this.status,
          code: this.code?.toString(),
          message: reason ?? 'Wwebjs disconnected',
          date: new Date(),
        });

        void this.notifyWorkerStatusSafely(payload, 'disconnected');

        if (isMismatchedStatus) {
          this.updateWorkerMismatchedStatus();
        }

        if (statusCode === ECodeMessage.loggedOut) {
          const logoutPayload: IBaileysConnectionState = {
            status: this.status,
            worker_id: WORKER,
            code: statusCode,
            disconnected_user: true,
            account_id: ACCOUNT,
            worker_status_id: EWorkerStatus.mismatched,
          };

          this.publishSub(logoutPayload, true);
          void this.notifyWorkerStatusSafely(logoutPayload, 'logged_out');

          this.clearFolder();
        }

        this.pendingResolve?.(this.state());
        this.pendingResolve = undefined;

        this.incomingMessageService.unbind();
        this.client = undefined;

        if (
          statusCode === ECodeMessage.loggedOut &&
          this.typeConnection === EBaileysConnectionType.qrcode &&
          this.initialConnection &&
          !this.userRequestedDisconnect
        ) {
          this.retryCount = 0;
          this.logConnectionEvent('session_invalidated_scheduling_qr', {
            connection_type: this.typeConnection,
          });
          this.clearDisconnectRetryTimer();
          this.disconnectRetryTimer = setTimeout(() => {
            this.disconnectRetryTimer = undefined;
            this.connect({
              initial_connection: this.initialConnection,
              force_new: false,
              allow_restore: false,
              type: this.typeConnection,
              requested_by_user: false,
              from_disconnect_restart: true,
            }).catch(() => {
              this.scheduleNextReconnectAttempt();
            });
          }, RETRY_DELAY);
        } else {
          this.scheduleNextReconnectAttempt();
        }
      });

      client.on('auth_failure', () => {
        if (!this.isActiveClient(client)) {
          return;
        }

        this.setStatus(Status.disconnected, ECodeMessage.badSession);
        this.clearConnectionStateProbe();
        this.logConnectionEvent('auth_failure', {
          attempt_id: attemptId,
          reason: 'auth_failure_event',
          mapped_code: ECodeMessage.badSession,
        });
        const payload: IBaileysConnectionState = {
          status: this.status,
          worker_id: WORKER,
          account_id: ACCOUNT,
          code: this.code,
          worker_status_id: EWorkerStatus.mismatched,
        };
        this.publishSub(payload, true);
        void this.notifyWorkerStatusSafely(payload, 'auth_failure');
        this.pendingResolve?.(this.state());
        this.pendingResolve = undefined;
        this.queueTeardown('auth_failure', async () => {
          if (!this.client || !this.isActiveClient(client)) {
            return;
          }

          try {
            await this.client.destroy();
          } catch {}

          this.client = undefined;
          this.clearChromiumProfileLock();
        });
        this.incomingMessageService.unbind();
        this.clearFolder();

        if (
          this.typeConnection === EBaileysConnectionType.qrcode &&
          this.initialConnection &&
          !this.userRequestedDisconnect
        ) {
          this.retryCount = 0;
          this.logConnectionEvent('auth_failure_scheduling_qr', {
            connection_type: this.typeConnection,
          });
          this.clearDisconnectRetryTimer();
          this.disconnectRetryTimer = setTimeout(() => {
            this.disconnectRetryTimer = undefined;
            this.connect({
              initial_connection: this.initialConnection,
              force_new: false,
              allow_restore: false,
              type: this.typeConnection,
              requested_by_user: false,
              from_disconnect_restart: true,
            }).catch(() => {
              this.scheduleNextReconnectAttempt();
            });
          }, RETRY_DELAY);
        }
      });

      client.on('chat_state', (state) => {
        if (!this.isActiveClient(client)) {
          return;
        }

        this.handleChatState(state);
      });

      client.initialize().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        void this.handleInitializeError(msg, client, attemptId);
      });
    });
  }

  private async logConnectionIpInLocal(
    client: Client,
    proxy: ReturnType<typeof readProxyConfig>
  ): Promise<void> {
    if (!SHOULD_LOG_CONNECTION_IP) {
      return;
    }

    const proxyLabel = proxy
      ? `${proxy.protocol}://${proxy.host}:${proxy.port}`
      : 'disabled';

    try {
      const browser = client.pupBrowser;
      if (!browser) {
        console.log('[Wwebjs][LOCAL][IP] pupBrowser indisponivel', {
          proxy: proxyLabel,
        });
        return;
      }

      const endpoints = [
        'https://api.ipify.org?format=json',
        'https://api64.ipify.org?format=json',
        'https://ifconfig.me/ip',
        'https://ipv4.icanhazip.com',
        'http://api.ipify.org',
      ];
      const probePage = await browser.newPage();

      try {
        if (proxy?.username && proxy.password) {
          await probePage.authenticate({
            username: proxy.username,
            password: proxy.password,
          });
        }

        const attempts: Array<{
          endpoint: string;
          status?: number;
          error?: string;
        }> = [];

        for (const endpoint of endpoints) {
          const response = await probePage
            .goto(endpoint, {
              waitUntil: 'domcontentloaded',
              timeout: 15000,
            })
            .catch((error) => {
              attempts.push({
                endpoint,
                error: error instanceof Error ? error.message : String(error),
              });
              return null;
            });

          if (!response) {
            continue;
          }

          const bodyText = await response.text().catch(() => '');
          const ip = this.extractPublicIpFromBody(bodyText);

          if (ip) {
            console.log('[Wwebjs][LOCAL][IP] Resultado de rede', {
              proxy: proxyLabel,
              public_ip: ip,
              endpoint,
              status: response.status(),
              method: 'browser.goto',
            });
            return;
          }

          attempts.push({
            endpoint,
            status: response.status(),
            error: 'Unable to parse IP response body',
          });
        }

        const tunnelBlocked = attempts.some((attempt) =>
          attempt.error?.includes('ERR_TUNNEL_CONNECTION_FAILED')
        );

        console.error('[Wwebjs][LOCAL][IP] Falha ao validar IP de conexao', {
          proxy: proxyLabel,
          error: tunnelBlocked
            ? 'Proxy bloqueou o tunel CONNECT para os endpoints de validacao'
            : 'Nao foi possivel obter IP publico',
          attempts,
        });
      } finally {
        await probePage.close().catch(() => {});
      }
    } catch (error) {
      console.error('[Wwebjs][LOCAL][IP] Falha ao validar IP de conexao', {
        proxy: proxyLabel,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private getClientStateWithTimeout(
    client: Client,
    timeoutMs = CONNECTION_STATE_CHECK_TIMEOUT_MS
  ): Promise<string | undefined> {
    return this.withTimeout(
      Promise.resolve()
        .then(() => client.getState())
        .then((state) => state ?? undefined),
      timeoutMs,
      'State check timeout'
    );
  }

  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    errorMessage: string
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(errorMessage));
      }, timeoutMs);

      promise.then(
        (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      );
    });
  }

  private getClientIdentityJid(client: Client): string | undefined {
    const rawWid = client.info?.wid?._serialized?.trim();
    return rawWid || undefined;
  }

  private getClientPhone(client: Client): string | undefined {
    const identityJid = this.getClientIdentityJid(client);
    return identityJid ? getPhoneNumber(identityJid) : undefined;
  }

  private async hasWwebjsStoreInjected(client: Client): Promise<boolean> {
    const page = (client as WwebjsClientInternals).pupPage;
    if (!page) {
      return false;
    }

    return this.withTimeout(
      page.evaluate(() => {
        return (
          typeof (globalThis as unknown as { WWebJS?: unknown }).WWebJS !==
          'undefined'
        );
      }),
      CONNECTION_PAGE_CHECK_TIMEOUT_MS,
      'WWebJS store check timeout'
    );
  }

  private async ensureClientEventBridgeReady(
    client: Client,
    attemptId: number
  ): Promise<boolean> {
    const clientWithInternals = client as WwebjsClientInternals;
    if (!this.getClientIdentityJid(client)) {
      return false;
    }

    try {
      const hasStore = await this.hasWwebjsStoreInjected(client);
      if (!hasStore) {
        this.logConnectionEvent('connection_state_probe_waiting_store', {
          attempt_id: attemptId,
        });
        return false;
      }
    } catch (error) {
      this.logConnectionEvent('connection_state_probe_waiting_store', {
        attempt_id: attemptId,
        reason: error instanceof Error ? error.message : String(error),
      });
      return false;
    }

    if (typeof clientWithInternals.attachEventListeners !== 'function') {
      this.logConnectionEvent(
        'connection_event_bridge_unavailable',
        {
          attempt_id: attemptId,
          reason: 'attachEventListeners_missing',
        },
        'warn'
      );
      return false;
    }

    try {
      await this.withTimeout(
        clientWithInternals.attachEventListeners.call(client),
        CONNECTION_EVENT_BRIDGE_ATTACH_TIMEOUT_MS,
        'Event bridge attach timeout'
      );
      this.logConnectionEvent('connection_event_bridge_ready', {
        attempt_id: attemptId,
      });
      return true;
    } catch (error) {
      this.logConnectionEvent(
        'connection_event_bridge_pending',
        {
          attempt_id: attemptId,
          reason: error instanceof Error ? error.message : String(error),
        },
        'warn'
      );
      return false;
    }
  }

  private startConnectionStateProbe(
    client: Client,
    attemptId: number,
    proxy: ReturnType<typeof readProxyConfig>
  ): void {
    this.clearConnectionStateProbe();

    const startedAt = Date.now();
    const probe = async (): Promise<void> => {
      if (
        !this.isActiveClient(client) ||
        this.status !== Status.connecting ||
        this.connectionEstablished
      ) {
        this.clearConnectionStateProbe();
        return;
      }

      let waState: string | undefined;
      try {
        waState = await this.getClientStateWithTimeout(client);
      } catch (error) {
        this.logConnectionEvent('connection_state_probe_pending', {
          attempt_id: attemptId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }

      if (
        !this.isActiveClient(client) ||
        this.status !== Status.connecting ||
        this.connectionEstablished
      ) {
        this.clearConnectionStateProbe();
        return;
      }

      const elapsedMs = Date.now() - startedAt;
      if (waState === 'CONNECTED') {
        if (!this.getClientIdentityJid(client)) {
          this.logConnectionEvent('connection_state_probe_waiting_identity', {
            attempt_id: attemptId,
            wa_state: waState,
            has_info: Boolean(client.info),
            has_wid: Boolean(client.info?.wid),
          });
        } else if (elapsedMs < CONNECTION_STATE_READY_GRACE_MS) {
          this.logConnectionEvent('connection_state_probe_waiting_ready', {
            attempt_id: attemptId,
            wa_state: waState,
            elapsed_ms: elapsedMs,
            grace_ms: CONNECTION_STATE_READY_GRACE_MS,
          });
        } else if (await this.ensureClientEventBridgeReady(client, attemptId)) {
          if (
            this.isActiveClient(client) &&
            this.status === Status.connecting &&
            !this.connectionEstablished
          ) {
            this.markConnected(client, attemptId, proxy, 'state_probe');
          }
          return;
        }
      }

      if (elapsedMs >= CONNECTION_STATE_RECONCILE_TIMEOUT_MS) {
        this.logConnectionEvent(
          'connection_state_probe_timeout',
          {
            attempt_id: attemptId,
            elapsed_ms: elapsedMs,
            wa_state: waState,
          },
          'warn'
        );
        this.clearConnectionStateProbe();

        if (this.shouldScheduleRetryAfterDisconnect()) {
          this.setStatus(Status.disconnected, ECodeMessage.connectionLost);
          this.pendingResolve?.(this.state());
          this.pendingResolve = undefined;
          this.queueTeardown('connection_state_probe_timeout', async () => {
            if (!this.client || !this.isActiveClient(client)) {
              return;
            }

            try {
              await this.client.destroy();
            } catch {}

            this.client = undefined;
            this.clearChromiumProfileLock();
          });
          await this.waitForPendingTeardown();
          this.scheduleNextReconnectAttempt(true);
        }

        return;
      }

      this.connectionStateProbeTimer = setTimeout(() => {
        void probe();
      }, CONNECTION_STATE_RECONCILE_INTERVAL_MS);
    };

    this.connectionStateProbeTimer = setTimeout(() => {
      void probe();
    }, CONNECTION_STATE_RECONCILE_INTERVAL_MS);
  }

  private markConnected(
    client: Client,
    attemptId: number,
    proxy: ReturnType<typeof readProxyConfig>,
    source: 'ready' | 'state_probe'
  ): void {
    if (!this.isActiveClient(client)) {
      return;
    }

    if (this.connectionEstablished && this.status === Status.connected) {
      this.logConnectionEvent('connect_short_circuit', {
        reason: 'already_marked_connected',
        attempt_id: attemptId,
        source,
      });
      return;
    }

    this.clearConnectionStateProbe();
    this.resetQrReadSession();
    this.qrReadSessionLocked = false;
    this.qrHash = undefined;
    this.retryCount = 0;
    this.clearDisconnectRetryTimer();
    this.setStatus(Status.connected, ECodeMessage.connectionEstablished);
    this.connectionEstablished = true;
    this.incomingMessageService.markConnectionReady();
    const phone = this.getClientPhone(client);

    const payload: IBaileysConnectionState = {
      status: this.status,
      worker_id: WORKER,
      account_id: ACCOUNT,
      code: this.code,
      phone,
      worker_status_id: EWorkerStatus.online,
    };

    this.publishSub(payload, true);
    void this.notifyWorkerStatusSafely(payload, source);
    void this.logConnectionIpInLocal(client, proxy);
    this.logConnectionEvent('connected_ready', {
      attempt_id: attemptId,
      source,
      worker_status_id: payload.worker_status_id,
      has_phone: Boolean(payload.phone),
    });
    this.healthCheckService.start(HEALTH_CHECK_INTERVAL_MS);
    this.pendingResolve?.(payload);
    this.pendingResolve = undefined;
  }

  private extractPublicIpFromBody(bodyText: string): string | undefined {
    const trimmed = bodyText.trim();

    if (!trimmed) {
      return undefined;
    }

    if (!trimmed.startsWith('{')) {
      return trimmed;
    }

    try {
      const payload = JSON.parse(trimmed) as { ip?: string };
      const ip = payload.ip?.trim();

      return ip || undefined;
    } catch {
      return undefined;
    }
  }

  private normalizeChatStateUsers(userIds: string[] | undefined): Set<string> {
    const normalized = new Set<string>();

    if (!Array.isArray(userIds)) {
      return normalized;
    }

    for (const userId of userIds) {
      const resolved = normalizeJid(userId) ?? userId;
      if (resolved) {
        normalized.add(resolved);
      }
    }

    return normalized;
  }

  private resolveChatStateType(state: ChatState): {
    is_typing: boolean;
    is_recording: boolean;
    typing_state: 'typing' | 'recording' | 'available';
  } | null {
    const normalizedState = state.state?.toLowerCase();

    if (
      normalizedState === 'available' ||
      normalizedState === 'unavailable' ||
      normalizedState === 'paused'
    ) {
      return {
        is_typing: false,
        is_recording: false,
        typing_state: 'available',
      };
    }

    if (normalizedState === 'typing' || normalizedState === 'composing') {
      return {
        is_typing: true,
        is_recording: false,
        typing_state: 'typing',
      };
    }

    if (
      normalizedState === 'recording' ||
      normalizedState === 'recording_audio'
    ) {
      return {
        is_typing: false,
        is_recording: true,
        typing_state: 'recording',
      };
    }

    const normalizedUserId =
      normalizeJid(state.userId ?? '') ?? state.userId ?? '';
    const typingUserIds = this.normalizeChatStateUsers(state.typingUserIds);
    const recordingUserIds = this.normalizeChatStateUsers(
      state.recordingUserIds
    );

    const isRecording = normalizedUserId
      ? recordingUserIds.has(normalizedUserId)
      : recordingUserIds.size > 0;
    const isTyping = isRecording
      ? false
      : normalizedUserId
        ? typingUserIds.has(normalizedUserId)
        : typingUserIds.size > 0;

    if (!isTyping && !isRecording) {
      return null;
    }

    return {
      is_typing: isTyping,
      is_recording: isRecording,
      typing_state: isRecording ? 'recording' : 'typing',
    };
  }

  private handleChatState(state: ChatState): void {
    const chatJid = normalizeJid(state.chatId) ?? state.chatId;
    if (!chatJid) {
      return;
    }

    const resolved = this.resolveChatStateType(state);
    if (!resolved) {
      return;
    }

    const typingEvent: IChatTyping = {
      type: 'typing',
      jid: chatJid,
      is_typing: resolved.is_typing,
      is_recording: resolved.is_recording,
      typing_state: resolved.typing_state,
      account_id: ACCOUNT,
      worker_id: WORKER,
    };

    void this.centrifugo.publishSub(CHAT_CHANNEL, typingEvent).catch(() => {});
  }

  private trackQrReadSession(
    requestedByUser: boolean,
    typeConnection: EBaileysConnectionType
  ): void {
    if (typeConnection !== EBaileysConnectionType.qrcode) {
      this.resetQrReadSession();
      this.qrReadSessionLocked = false;
      return;
    }

    if (requestedByUser) {
      this.qrReadSessionActive = true;
      this.qrReadSessionLocked = false;
      this.qrGenerationCount = 0;
      this.qrHash = undefined;
    }
  }

  private normalizePhoneConnection(
    phoneConnection?: string
  ): string | undefined {
    const normalized = phoneConnection?.replace(/\D/g, '');

    if (!normalized) {
      return undefined;
    }

    return normalized;
  }

  private resetQrReadSession(): void {
    this.qrReadSessionActive = false;
    this.qrGenerationCount = 0;
  }

  private shouldScheduleRetryAfterDisconnect(): boolean {
    if (this.userRequestedDisconnect) {
      return false;
    }

    if (!this.initialConnection) {
      return false;
    }

    if (!this.hasSession()) {
      return false;
    }

    return true;
  }

  private handleQrGenerationLimitReached(): void {
    this.qrReadSessionActive = false;
    this.qrReadSessionLocked = true;
    this.retryCount = 0;
    this.qrHash = undefined;
    this.setStatus(Status.disconnected, ECodeMessage.connectionClosed);

    const payload: IBaileysConnectionState = {
      status: this.status,
      code: this.code,
      worker_id: WORKER,
      account_id: ACCOUNT,
      attempt: MAX_QR_GENERATIONS + 1,
      max_attempts: MAX_QR_GENERATIONS,
      worker_status_id: EWorkerStatus.disponible,
    };

    this.publishSub(payload, true);
    void this.notifyWorkerStatusSafely(payload, 'qr_limit_reached');
    this.cancelAttempt(false);
  }

  private mapDisconnectReason(reason: string): ECodeMessage {
    const lower = reason?.toLowerCase() ?? '';
    if (lower.includes('logged') || lower.includes('logout')) {
      return ECodeMessage.loggedOut;
    }
    if (lower.includes('replaced') || lower.includes('connectionreplaced')) {
      return ECodeMessage.connectionReplaced;
    }
    if (lower.includes('multidevice') || lower.includes('mismatch')) {
      return ECodeMessage.multideviceMismatch;
    }
    if (lower.includes('restart')) {
      return ECodeMessage.restartRequired;
    }
    return ECodeMessage.connectionLost;
  }

  private cancelAttempt(skipDestroy = false): void {
    this.clearConnectionStateProbe();
    this.pendingResolve?.(this.state());
    this.pendingResolve = undefined;
    this.currentPromise = undefined;
    this.connecting = false;
    this.connectionEstablished = false;
    this.clearDisconnectRetryTimer();
    this.incomingMessageService.unbind();

    if (!skipDestroy && this.client) {
      const clientToDestroy = this.client;
      this.client = undefined;

      this.queueTeardown('cancel_attempt', async () => {
        try {
          await clientToDestroy.destroy();
        } catch {}

        this.clearChromiumProfileLock();
      });
    }
  }

  private async safeDestroy(forceLogout = false): Promise<void> {
    this.clearDisconnectRetryTimer();
    this.clearConnectionStateProbe();

    if (!this.client) {
      return;
    }

    if (forceLogout) {
      try {
        await this.client.logout();
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch {
        this.saveLogWppConnection({
          worker_id: WORKER,
          status: Status.disconnected,
          code: ECodeMessage.connectionLost,
          message: 'Error during logout',
          date: new Date(),
        });
      }
    }

    try {
      await this.client.destroy();
    } catch {
      this.saveLogWppConnection({
        worker_id: WORKER,
        status: Status.disconnected,
        code: ECodeMessage.connectionLost,
        message: 'Error during destroy',
        date: new Date(),
      });
    }

    this.client = undefined;
    this.clearChromiumProfileLock();
    this.setStatus(
      Status.disconnected,
      forceLogout ? ECodeMessage.loggedOut : ECodeMessage.connectionLost
    );
  }

  private reportConnected(): IBaileysConnectionState {
    if (this.initialConnection) {
      this.lastPayload = null;

      const payload = {
        status: this.status,
        code: ECodeMessage.connectionEstablished,
        worker_id: WORKER,
        account_id: ACCOUNT,
        phone: getPhoneNumber(this.client?.info?.wid?._serialized),
        worker_status_id: EWorkerStatus.online,
      };

      this.publishSub(payload);
      void this.notifyWorkerStatusSafely(payload, 'report_connected');
    }

    return this.state();
  }

  private setStatus(s: Status, c?: ECodeMessage): void {
    const previousStatus = this.status;
    const previousCode = this.code;
    const nextCode = c ?? this.code;

    this.status = s;
    if (c) {
      this.code = c;
    }

    if (previousStatus !== s || previousCode !== nextCode) {
      this.logConnectionEvent('connection_status_transition', {
        previous_status: previousStatus,
        previous_code: previousCode,
        status: this.status,
        code: this.code,
      });
    }
  }

  private state(qr?: string, qrGeneratedAt?: string): IBaileysConnectionState {
    const result: IBaileysConnectionState = {
      status: this.status,
      worker_id: WORKER,
      account_id: ACCOUNT,
      qrcode: qr,
      code: this.code,
      connection_attempt_id: this.connectionAttemptId,
    };
    if (qr && qrGeneratedAt) {
      result.qr_generated_at = qrGeneratedAt;
    }
    if (this.status === Status.connecting) {
      result.attempt = this.retryCount > 0 ? this.retryCount : 1;
      result.max_attempts = MAX_RETRIES;
    }
    return result;
  }

  private publishSub(payload: IBaileysConnectionState, force = false): void {
    if (!this.initialConnection && !force) {
      recordConnectionLifecycle({
        stage: 'connection.wwebjs.centrifugo.publish_skipped',
        decision: 'publish_sub_initial_connection_gate',
        outcome: 'skipped',
        reason: 'initial_connection_false',
        source_provider: 'wwebjs',
        worker_type: 'wwebjs',
        worker_id: WORKER,
        channel_id: WORKER,
        account_id: ACCOUNT,
        status: payload.status,
        code: payload.code,
      });
      return;
    }

    const data = JSON.stringify(payload);
    if (data === this.lastPayload && !force) {
      recordConnectionLifecycle({
        stage: 'connection.wwebjs.centrifugo.publish_skipped',
        decision: 'publish_sub_dedupe',
        outcome: 'skipped',
        reason: 'payload_duplicated',
        source_provider: 'wwebjs',
        worker_type: 'wwebjs',
        worker_id: WORKER,
        channel_id: WORKER,
        account_id: ACCOUNT,
        status: payload.status,
        code: payload.code,
      });
      return;
    }

    this.lastPayload = data;
    const startedAt = Date.now();
    recordConnectionLifecycle({
      stage: 'connection.wwebjs.centrifugo.publish_start',
      decision: 'publish_sub',
      outcome: 'started',
      source_provider: 'wwebjs',
      worker_type: 'wwebjs',
      worker_id: WORKER,
      channel_id: WORKER,
      account_id: ACCOUNT,
      status: payload.status,
      code: payload.code,
      worker_status_id: payload.worker_status_id,
      has_qr: Boolean(payload.qrcode),
      has_pairing_code: Boolean(payload.pairing_code),
      force,
    });
    void this.centrifugo
      .publishSub(CHANNEL, payload)
      .then(() => {
        recordConnectionLifecycle({
          stage: 'connection.wwebjs.centrifugo.publish_success',
          decision: 'publish_sub',
          outcome: 'success',
          source_provider: 'wwebjs',
          worker_type: 'wwebjs',
          worker_id: WORKER,
          channel_id: WORKER,
          account_id: ACCOUNT,
          status: payload.status,
          code: payload.code,
          worker_status_id: payload.worker_status_id,
          duration_ms: Date.now() - startedAt,
        });
      })
      .catch((error) => {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        recordConnectionLifecycle({
          stage: 'connection.wwebjs.centrifugo.publish_error',
          decision: 'publish_sub',
          outcome: 'error',
          reason: 'centrifugo_publish_failed',
          level: 'error',
          source_provider: 'wwebjs',
          worker_type: 'wwebjs',
          worker_id: WORKER,
          channel_id: WORKER,
          account_id: ACCOUNT,
          status: payload.status,
          code: payload.code,
          worker_status_id: payload.worker_status_id,
          duration_ms: Date.now() - startedAt,
          error: errorMessage,
        });
        console.error('[WwebjsConnection] Publish failed', error);
      });
  }

  private async notifyWorkerStatusSafely(
    payload: IBaileysConnectionState,
    context: string
  ): Promise<void> {
    const startedAt = Date.now();
    recordConnectionLifecycle({
      stage: 'connection.wwebjs.balance.notify_start',
      decision: 'notify_worker_status',
      outcome: 'started',
      source_provider: 'wwebjs',
      worker_type: 'wwebjs',
      worker_id: WORKER,
      channel_id: WORKER,
      account_id: ACCOUNT,
      status: payload.status,
      code: payload.code,
      worker_status_id: payload.worker_status_id,
      reason: context,
      has_qr: Boolean(payload.qrcode),
      has_pairing_code: Boolean(payload.pairing_code),
    });
    try {
      await this.balanceWorkerStatusGrpcClientService.notifyWorkerStatus(
        payload
      );
      recordConnectionLifecycle({
        stage: 'connection.wwebjs.balance.notify_success',
        decision: 'notify_worker_status',
        outcome: 'success',
        source_provider: 'wwebjs',
        worker_type: 'wwebjs',
        worker_id: WORKER,
        channel_id: WORKER,
        account_id: ACCOUNT,
        status: payload.status,
        code: payload.code,
        worker_status_id: payload.worker_status_id,
        reason: context,
        duration_ms: Date.now() - startedAt,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      recordConnectionLifecycle({
        stage: 'connection.wwebjs.balance.notify_error',
        decision: 'notify_worker_status',
        outcome: 'error',
        reason: context,
        level: 'error',
        source_provider: 'wwebjs',
        worker_type: 'wwebjs',
        worker_id: WORKER,
        channel_id: WORKER,
        account_id: ACCOUNT,
        status: payload.status,
        code: payload.code,
        worker_status_id: payload.worker_status_id,
        duration_ms: Date.now() - startedAt,
        error: errorMessage,
      });
      console.error('[WwebjsConnection] NotifyWorkerStatus failed', {
        context,
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        worker_status_id: payload.worker_status_id,
        error: errorMessage,
      });
    }
  }

  private async updateWorkerMismatchedStatus(): Promise<void> {
    const payload: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: Status.disconnected,
      worker_id: WORKER,
      account_id: ACCOUNT,
      worker_status_id: EWorkerStatus.mismatched,
    };

    this.publishSub(payload);
    await this.balanceWorkerStatusGrpcClientService.notifyWorkerStatus(payload);
  }

  private logConnectionEvent(
    event: string,
    details: Record<string, unknown> = {},
    level: 'info' | 'warn' | 'error' = 'info'
  ): void {
    const payload = {
      module: 'worker_wwebjs',
      component: 'wwebjs_connection_service',
      type: 'connection_status',
      event,
      worker_id: WORKER,
      account_id: ACCOUNT,
      status: this.status,
      code: this.code,
      ...details,
    };

    recordConnectionLifecycle({
      stage: `connection.wwebjs.service.${event}`,
      decision: event,
      outcome: level === 'error' ? 'error' : 'logged',
      level,
      source_provider: 'wwebjs',
      worker_type: 'wwebjs',
      worker_id: WORKER,
      channel_id: WORKER,
      account_id: ACCOUNT,
      status: this.status,
      code: this.code,
      ...details,
    });

    if (level === 'error') {
      logger.error(payload, 'Wwebjs connection event');
      return;
    }

    if (level === 'warn') {
      logger.warn(payload, 'Wwebjs connection event');
      return;
    }

    logger.info(payload, 'Wwebjs connection event');
  }

  private readonly saveLogWppConnection = async (
    wppLog: EWppConnection
  ): Promise<boolean> => {
    const startedAt = Date.now();
    recordConnectionLifecycle({
      stage: 'connection.wwebjs.elastic.wpp_connection_start',
      decision: 'save_wpp_connection',
      outcome: 'started',
      source_provider: 'wwebjs',
      worker_type: 'wwebjs',
      worker_id: WORKER,
      channel_id: WORKER,
      account_id: ACCOUNT,
      status: wppLog?.status,
      code: wppLog?.code,
      elastic_index: EElasticIndex.wpp_connection,
    });
    const mappings = wppConnectionMappings();
    const result = await this.elasticDatabaseService.indices(
      EElasticIndex.wpp_connection,
      mappings
    );

    if (!result || !wppLog) {
      recordConnectionLifecycle({
        stage: 'connection.wwebjs.elastic.wpp_connection_skipped',
        decision: 'save_wpp_connection',
        outcome: 'skipped',
        reason: !wppLog ? 'missing_wpp_log' : 'index_creation_failed',
        level: 'warn',
        source_provider: 'wwebjs',
        worker_type: 'wwebjs',
        worker_id: WORKER,
        channel_id: WORKER,
        account_id: ACCOUNT,
        elastic_index: EElasticIndex.wpp_connection,
        duration_ms: Date.now() - startedAt,
      });
      return false;
    }

    const documentId = buildWppConnectionDocumentId(ACCOUNT, wppLog.worker_id);

    try {
      const updateResult = await this.elasticDatabaseService.updateWithOCC(
        EElasticIndex.wpp_connection,
        documentId,
        wppLog as unknown as Record<string, unknown>,
        { upsert: true, maxRetries: 5 }
      );

      const success =
        updateResult === 'updated' ||
        updateResult === 'created' ||
        updateResult === 'noop';

      recordConnectionLifecycle({
        stage: success
          ? 'connection.wwebjs.elastic.wpp_connection_success'
          : 'connection.wwebjs.elastic.wpp_connection_unexpected_result',
        decision: 'save_wpp_connection',
        outcome: success ? 'success' : 'error',
        level: success ? 'info' : 'warn',
        reason: updateResult,
        source_provider: 'wwebjs',
        worker_type: 'wwebjs',
        worker_id: WORKER,
        channel_id: WORKER,
        account_id: ACCOUNT,
        status: wppLog.status,
        code: wppLog.code,
        elastic_index: EElasticIndex.wpp_connection,
        document_id: documentId,
        duration_ms: Date.now() - startedAt,
      });

      return success;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      recordConnectionLifecycle({
        stage: 'connection.wwebjs.elastic.wpp_connection_error',
        decision: 'save_wpp_connection',
        outcome: 'error',
        reason: 'elastic_update_failed',
        level: 'error',
        source_provider: 'wwebjs',
        worker_type: 'wwebjs',
        worker_id: WORKER,
        channel_id: WORKER,
        account_id: ACCOUNT,
        status: wppLog.status,
        code: wppLog.code,
        elastic_index: EElasticIndex.wpp_connection,
        document_id: documentId,
        duration_ms: Date.now() - startedAt,
        error: errorMessage,
      });
      throw error;
    }
  };
}
