import {
  Browsers,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  makeWASocket,
  useMultiFileAuthState,
  type WASocket,
} from '@whiskeysockets/baileys';
import type WebSocket from 'ws';
import QRCode from 'qrcode';
import P from 'pino';
import fs from 'node:fs';
import path from 'node:path';
import { request as httpsRequest, type Agent as HttpsAgent } from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { singleton, inject } from 'tsyringe';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { baileysEnvironment } from '@core/config/environments';
import { EBaileysConnectionStatus as Status } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { IBaileysUpdateEvent } from '@core/common/interfaces/IBaileysUpdateEvent';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EWppConnection } from '@core/common/enums/EWppConnection';
import { wppConnectionMappings } from '@core/mappings/wppConnection.mappings';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { IBaileysConnection } from '@core/common/interfaces/IBaileysConnection';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { EAppEnvironment } from '@core/common/enums/EAppEnvironment';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { BalanceWorkerStatusGrpcClientService } from '@core/services/balanceWorkerStatusGrpcClient.service';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { BaileysIncomingMessageService } from './incoming.service';
import { BaileysHealthCheckService } from './healthCheck.service';
import { getPhoneNumber } from '@core/common/functions/getPhoneNumber';
import { buildWppConnectionDocumentId } from '@core/common/functions/buildWppConnectionDocumentId';
import { EProxyProtocol } from '@core/common/enums/EProxyProtocol';
import { logger } from '@core/plugins/telemetry/logger';

const FOLDER = `/app/data/storage/${baileysEnvironment.baileysWorkerId}`;
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const CHANNEL = workerCentrifugoQueue(baileysEnvironment.baileysAccountId);
const WORKER = baileysEnvironment.baileysWorkerId;
const ACCOUNT = baileysEnvironment.baileysAccountId;
const WA_VERSION_TTL_MS = 6 * 60 * 60 * 1000;
const SHOULD_PRINT_QR_IN_TERMINAL =
  process.env.APP_ENVIRONMENT === EAppEnvironment.local;
const SHOULD_LOG_CONNECTION_IP =
  process.env.APP_ENVIRONMENT === EAppEnvironment.local;
let cachedWaVersion: {
  version: [number, number, number];
  fetchedAt: number;
} | null = null;

function readProxyConfig(): {
  protocol: EProxyProtocol;
  url: string;
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
  const auth =
    username && password
      ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
      : '';

  return {
    protocol,
    url: `${protocol}://${auth}${host}:${port}`,
  };
}

function createProxyAgent(config: {
  protocol: EProxyProtocol;
  url: string;
}): HttpsAgent {
  if (
    config.protocol === EProxyProtocol.socks4 ||
    config.protocol === EProxyProtocol.socks5
  ) {
    return new SocksProxyAgent(config.url) as unknown as HttpsAgent;
  }

  return new HttpsProxyAgent(config.url) as unknown as HttpsAgent;
}

async function getCachedWaWebVersion(): Promise<[number, number, number]> {
  if (
    cachedWaVersion &&
    Date.now() - cachedWaVersion.fetchedAt < WA_VERSION_TTL_MS
  ) {
    return cachedWaVersion.version;
  }

  const waResult = await fetchLatestWaWebVersion();
  if (!('error' in waResult)) {
    cachedWaVersion = { version: waResult.version, fetchedAt: Date.now() };
    return waResult.version;
  }

  const baileysResult = await fetchLatestBaileysVersion();
  cachedWaVersion = { version: baileysResult.version, fetchedAt: Date.now() };
  return baileysResult.version;
}

@singleton()
export class BaileysConnectionService {
  private readonly retryDelay = 60_000;
  private readonly maxRetries = 10;
  private readonly reconnectCooldownDelay = 30 * 60 * 1000;
  private readonly maxQrGenerations = 5;

  private socket?: WASocket;
  private status: Status = Status.initial;
  private code: ECodeMessage = ECodeMessage.awaitConnection;

  private socketId = 0;
  private qrHash?: string;
  private initialConnection = false;
  private awaitingNewLogin = false;
  private lastPayload: string | null = null;
  private lastStatusPayload: string | null = null;
  private typeConnection: EBaileysConnectionType =
    EBaileysConnectionType.qrcode;
  private phoneConnection?: string = undefined;

  private connecting = false;
  private retryCount = 0;
  private qrGenerationCount = 0;
  private qrReadSessionActive = false;
  private qrReadSessionLocked = false;
  private currentPromise?: Promise<IBaileysConnectionState>;
  private pendingResolve?: (s: IBaileysConnectionState) => void;
  private connectionEstablished = false;
  private userRequestedDisconnect = false;
  private activeProxyUrl: string | null = null;
  private activeProxyAgent?: HttpsAgent;
  private reconnectRetryTimer: NodeJS.Timeout | undefined;

  constructor(
    @inject(CentrifugoService)
    private readonly centrifugo: CentrifugoService,
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(BalanceWorkerStatusGrpcClientService)
    private readonly balanceWorkerStatusGrpcClientService: BalanceWorkerStatusGrpcClientService,
    @inject(BaileysIncomingMessageService)
    private readonly baileysIncomingMessageService: BaileysIncomingMessageService,
    @inject(BaileysHealthCheckService)
    private readonly healthCheckService: BaileysHealthCheckService
  ) {
    this.configureHealthCheck();
  }

  private configureHealthCheck(): void {
    this.healthCheckService.configure({
      getSocket: () => this.socket,
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
      const socketReference = this.socket as unknown as {
        ws?: { isOpen?: boolean };
      };
      const wsClientIsOpen = socketReference.ws?.isOpen === true;
      const wsReadyState = this.resolveWebSocket()?.readyState;

      if (wsClientIsOpen || wsReadyState === 1) {
        console.warn(
          '[BaileysConnection] Health check mismatch ignored: socket still OPEN'
        );
        return;
      }

      console.log(
        '[BaileysConnection] Health check detected disconnection, triggering reconnect'
      );
      this.connectionEstablished = false;
      this.setStatus(Status.disconnected, ECodeMessage.connectionLost);

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

  getSocket(): WASocket | undefined {
    return this.socket;
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
        console.error('[BaileysConnection] Republish failed', error);
      });
    } catch (error) {
      console.error('[BaileysConnection] Failed to parse lastPayload', error);
    }
  }

  private clearReconnectRetryTimer(): void {
    if (!this.reconnectRetryTimer) {
      return;
    }

    clearTimeout(this.reconnectRetryTimer);
    this.reconnectRetryTimer = undefined;
  }

  private scheduleReconnect(delayMs: number): void {
    this.clearReconnectRetryTimer();
    this.reconnectRetryTimer = setTimeout(() => {
      this.reconnectRetryTimer = undefined;
      this.logConnectionEvent('reconnect_triggered', {
        delay_ms: delayMs,
        attempt: this.retryCount,
        max_attempts: this.maxRetries,
        connection_type: this.typeConnection,
        from_disconnect_restart: true,
      });
      this.connect({
        initial_connection: this.initialConnection,
        from_disconnect_restart: true,
        requested_by_user: false,
        type: this.typeConnection,
        phone_connection: this.phoneConnection,
      }).catch(() => {
        this.logConnectionEvent(
          'connection_connect_error',
          {
            reason: `Reconnect failed after ${delayMs}ms retry`,
            delay_ms: delayMs,
            attempt: this.retryCount,
            max_attempts: this.maxRetries,
          },
          'error'
        );
        this.saveLogWppConnection({
          worker_id: WORKER,
          status: this.status ?? Status.disconnected,
          code: this.code ?? ECodeMessage.connectionLost,
          message: `Reconnect failed after ${delayMs}ms retry`,
          date: new Date(),
        });
        this.scheduleNextReconnectAttempt();
      });
    }, delayMs);
  }

  private scheduleReconnectCooldown(): void {
    this.clearReconnectRetryTimer();
    this.reconnectRetryTimer = setTimeout(() => {
      this.reconnectRetryTimer = undefined;
      this.scheduleNextReconnectAttempt();
    }, this.reconnectCooldownDelay);
  }

  private publishReconnectAttempt(attempt: number, delayMs: number): void {
    const retryPayload: IBaileysConnectionState = {
      status: Status.connecting,
      worker_id: WORKER,
      account_id: ACCOUNT,
      code: ECodeMessage.awaitConnection,
      attempt,
      max_attempts: this.maxRetries,
      seconds_until_next_attempt: Math.ceil(delayMs / 1000),
    };
    this.publishSub(retryPayload, true);
  }

  private publishConnectionStarting(): void {
    this.publishSub(
      {
        status: Status.connecting,
        worker_id: WORKER,
        account_id: ACCOUNT,
        code: ECodeMessage.awaitConnection,
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

  private scheduleNextReconnectAttempt(): void {
    if (!this.shouldScheduleRetryAfterClose()) {
      return;
    }

    if (this.retryCount >= this.maxRetries) {
      this.retryCount = 0;
      this.publishReconnectAttempt(
        this.maxRetries,
        this.reconnectCooldownDelay
      );
      this.scheduleReconnectCooldown();
      return;
    }

    const nextAttempt = this.retryCount + 1;
    const delayMs = nextAttempt === 1 ? 0 : this.retryDelay;

    this.retryCount = nextAttempt;
    this.logConnectionEvent('reconnect_scheduled', {
      attempt: nextAttempt,
      max_attempts: this.maxRetries,
      delay_ms: delayMs,
      connection_type: this.typeConnection,
      has_phone_connection: Boolean(this.phoneConnection),
      requested_by_user: false,
      from_disconnect_restart: true,
    });
    this.publishReconnectAttempt(nextAttempt, delayMs);
    this.scheduleReconnect(delayMs);
  }

  private canRestoreSession(allowRestore: boolean): boolean {
    return (
      allowRestore &&
      (this.status === Status.initial || this.status === Status.disconnected) &&
      this.hasSession()
    );
  }

  private handleRestoreSession(): Promise<IBaileysConnectionState> | null {
    if (!this.restoreSessionInProgress()) {
      return this.restoreWithRetries();
    }

    if (this.currentPromise) {
      return this.currentPromise;
    }

    return Promise.resolve(this.reportConnecting());
  }

  private handleExistingConnection(): Promise<IBaileysConnectionState> | null {
    if (this.connected) {
      return Promise.resolve(this.reportConnected());
    }

    if (this.connecting) {
      if (this.currentPromise) {
        return this.currentPromise;
      }
      return Promise.resolve(this.reportConnecting());
    }

    if (this.status === Status.connected) {
      return Promise.resolve(this.reportConnected());
    }

    return null;
  }

  private handleDisconnectedWithRestore(
    allowRestore: boolean
  ): Promise<IBaileysConnectionState> | null {
    if (!allowRestore) return null;
    if (this.status !== Status.disconnected) return null;
    if (!this.hasSession()) return null;
    return this.restoreWithRetries();
  }

  private handleConnectingWithRestore(
    allowRestore: boolean
  ): Promise<IBaileysConnectionState> | null {
    if (!allowRestore) return null;
    if (this.status !== Status.connecting) return null;
    if (!this.currentPromise) return null;
    return this.currentPromise;
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
    } = input;

    this.logConnectionEvent('connect_requested', {
      requested_by_user: requestedByUser,
      from_disconnect_restart: fromDisconnectRestart,
      force_new: forceNew,
      allow_restore: allowRestore,
      connection_type: typeConnection,
      has_phone_connection: Boolean(phoneConnection),
      has_session: this.hasSession(),
      has_active_socket: Boolean(this.socket),
    });

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
    this.phoneConnection = phoneConnection;
    this.trackQrReadSession(requestedByUser, typeConnection);

    if (this.connected) {
      this.logConnectionEvent('connect_short_circuit', {
        reason: 'already_connected',
      });
      return this.reportConnected();
    }

    if (this.connecting && this.currentPromise) {
      this.logConnectionEvent('connect_short_circuit', {
        reason: 'already_connecting',
      });
      return this.currentPromise;
    }

    if (forceNew && (!this.connecting || fromDisconnectRestart)) {
      this.cancelAttempt(false);
    }

    if (this.canRestoreSession(allowRestore)) {
      const restoreState = this.handleRestoreSession();
      if (restoreState) {
        this.logConnectionEvent('connect_short_circuit', {
          reason: 'restore_session',
          allow_restore: allowRestore,
        });
        return restoreState;
      }
    }

    const existingState = this.handleExistingConnection();
    if (existingState) {
      this.logConnectionEvent('connect_short_circuit', {
        reason: 'existing_connection_state',
      });
      return existingState;
    }

    const disconnectedState = this.handleDisconnectedWithRestore(allowRestore);
    if (disconnectedState) {
      this.logConnectionEvent('connect_short_circuit', {
        reason: 'disconnected_with_restore',
        allow_restore: allowRestore,
      });
      return disconnectedState;
    }

    const connectingState = this.handleConnectingWithRestore(allowRestore);
    if (connectingState) {
      this.logConnectionEvent('connect_short_circuit', {
        reason: 'connecting_with_restore',
        allow_restore: allowRestore,
      });
      return connectingState;
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

    this.clearReconnectRetryTimer();
    this.prepareFolder();
    this.connecting = true;
    this.setStatus(Status.connecting, ECodeMessage.awaitConnection);
    this.publishConnectionStarting();
    if (!fromDisconnectRestart) {
      this.retryCount = 0;
    }
    this.socketId += 1;

    const { socket } = await this.createSocket();
    this.baileysIncomingMessageService.bindTo(socket);
    this.socket = socket;

    if (this.typeConnection === EBaileysConnectionType.phone) {
      await this.requestPairing(socket);
    }

    this.currentPromise = this.wait(socket, this.socketId).finally(() => {
      this.connecting = false;
      this.currentPromise = undefined;
    });

    return this.currentPromise;
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
    this.clearReconnectRetryTimer();

    if (disconnectedUser) {
      this.userRequestedDisconnect = true;
    }
    this.retryCount = 0;
    this.resetQrReadSession();
    this.qrReadSessionLocked = false;

    await this.safeLogout(shouldRemoveSession);
    this.cancelAttempt(false);
    if (shouldRemoveSession) {
      this.clearFolder();
    }

    this.saveLogWppConnection({
      worker_id: WORKER,
      status: this.status,
      code: this.code?.toString(),
      message: 'BaileysConnectionService disconnected',
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
      has_active_socket: Boolean(this.socket),
      has_session: this.hasSession(),
    });
    this.resetQrReadSession();
    this.qrReadSessionLocked = false;
    this.pendingResolve?.(this.state());
    this.pendingResolve = undefined;
    this.currentPromise = undefined;
    this.connecting = false;
    this.awaitingNewLogin = false;
    this.connectionEstablished = false;
    this.retryCount = 0;
    this.healthCheckService.stop();
    this.clearReconnectRetryTimer();
    this.baileysIncomingMessageService.unbind();
    this.cancelAttempt(false);
  }

  private async createSocket() {
    const { state, saveCreds } = await useMultiFileAuthState(FOLDER);
    const version = await getCachedWaWebVersion();
    const proxyConfig = readProxyConfig();

    const proxyAgent = proxyConfig ? createProxyAgent(proxyConfig) : undefined;
    this.activeProxyUrl = proxyConfig?.url ?? null;
    this.activeProxyAgent = proxyAgent;

    const socket = makeWASocket({
      auth: state,
      version,
      browser: Browsers.macOS('Desktop'),
      logger: P({ level: 'silent' }),
      getMessage: async (key) =>
        this.baileysIncomingMessageService.getCachedMessage(key),
      enableAutoSessionRecreation: true,
      enableRecentMessageCache: true,
      retryRequestDelayMs: 5_000,
      connectTimeoutMs: 30_000,
      keepAliveIntervalMs: 15_000,
      defaultQueryTimeoutMs: 60_000,
      maxMsgRetryCount: 10,
      ...(proxyAgent
        ? {
            agent: proxyAgent,
            fetchAgent: proxyAgent,
          }
        : {}),
    });

    socket.ev.on('creds.update', saveCreds);

    return { socket, saveCreds };
  }

  private async requestPairing(socket: WASocket): Promise<void> {
    if (!this.phoneConnection) {
      return;
    }

    if (!socket.authState.creds.registered) {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const code = await socket.requestPairingCode(this.phoneConnection);

      const payload: IBaileysConnectionState = {
        status: Status.connecting,
        worker_id: WORKER,
        account_id: ACCOUNT,
        pairing_code: code,
        code: ECodeMessage.awaitingPairingCode,
        worker_status_id: EWorkerStatus.disponible,
      };

      this.publishSub(payload);
      void this.notifyWorkerStatusSafely(payload, 'pairing_code');
    }
  }

  private restoreSessionInProgress(): boolean {
    return (
      this.connecting &&
      !!this.currentPromise &&
      this.hasSession() &&
      (this.status === Status.connecting || this.status === Status.initial)
    );
  }

  private reportConnecting(): IBaileysConnectionState {
    if (this.status !== Status.connecting) {
      this.setStatus(Status.connecting, ECodeMessage.awaitConnection);
    }

    return this.state();
  }

  private wait(socket: WASocket, id: number): Promise<IBaileysConnectionState> {
    return new Promise<IBaileysConnectionState>((resolve) => {
      this.pendingResolve = resolve;
      let opened = false;

      socket.ev.on('connection.update', async (u: IBaileysUpdateEvent) => {
        if (id !== this.socketId) {
          return;
        }

        const { qr, connection, isNewLogin, lastDisconnect } = u;

        if (
          qr &&
          this.canShowQr() &&
          this.typeConnection === EBaileysConnectionType.qrcode
        ) {
          this.awaitingNewLogin = false;
          return this.onQr(qr, resolve, id);
        }

        if (isNewLogin) {
          return this.onNewLoginAttempt();
        }

        if (connection === 'open' && !opened) {
          opened = true;
          this.retryCount = 0;

          return void this.onOpen(resolve, id);
        }

        if (connection === 'close') {
          return this.onClose(lastDisconnect, resolve, id);
        }

        this.awaitingNewLogin = false;
      });
    });
  }

  private async onQr(
    qr: string,
    resolve: (s: IBaileysConnectionState) => void,
    id: number
  ): Promise<void> {
    if (id !== this.socketId) {
      return;
    }

    if (qr.slice(-20) === this.qrHash) {
      return;
    }

    if (this.qrGenerationCount >= this.maxQrGenerations) {
      await this.handleQrGenerationLimitReached();
      return;
    }

    this.qrHash = qr.slice(-20);
    this.qrGenerationCount += 1;
    this.setStatus(Status.connecting, ECodeMessage.awaitingReadQrCode);
    this.logConnectionEvent('qr_generated', {
      attempt: this.qrGenerationCount,
      max_attempts: this.maxQrGenerations,
      connection_type: this.typeConnection,
    });

    await this.printQrInConsole(qr);
    const img = await QRCode.toDataURL(qr);
    if (id !== this.socketId) {
      return;
    }

    const payload: IBaileysConnectionState = {
      status: this.status,
      code: this.code,
      qrcode: img,
      worker_id: WORKER,
      account_id: ACCOUNT,
      worker_status_id: EWorkerStatus.disponible,
    };
    this.publishSub(payload, true);
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

    resolve(this.state(img));

    this.pendingResolve = undefined;
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

      console.log('\n[Baileys][QR] Escaneie o QR code abaixo:\n');
      console.log(terminalQr);
      console.log('[Baileys][QR] Fim do QR code\n');
    } catch (error) {
      console.error('[Baileys][QR] Falha ao renderizar QR no console', error);
    }
  }

  private async onOpen(
    resolve: (s: IBaileysConnectionState) => void,
    id: number
  ): Promise<void> {
    if (id !== this.socketId) {
      return;
    }

    this.resetQrReadSession();
    this.qrReadSessionLocked = false;
    this.qrHash = undefined;
    this.clearReconnectRetryTimer();
    this.setStatus(Status.connected, ECodeMessage.connectionEstablished);
    this.connectionEstablished = true;

    const payload: IBaileysConnectionState = {
      status: this.status,
      worker_id: WORKER,
      account_id: ACCOUNT,
      code: this.code,
      phone: getPhoneNumber(this.socket?.user?.id),
      worker_status_id: EWorkerStatus.online,
    };

    this.publishSub(payload);
    this.lastStatusPayload = JSON.stringify(payload);
    void this.notifyWorkerStatusSafely(payload, 'open');
    void this.logConnectionIpInLocal();
    this.logConnectionEvent('connected_ready', {
      worker_status_id: payload.worker_status_id,
      has_phone: Boolean(payload.phone),
    });

    this.healthCheckService.start(HEALTH_CHECK_INTERVAL_MS);

    resolve(this.state());

    this.pendingResolve = undefined;
  }

  private async logConnectionIpInLocal(): Promise<void> {
    if (!SHOULD_LOG_CONNECTION_IP) {
      return;
    }

    const proxy = this.activeProxyUrl ?? 'disabled';
    const publicIp = await this.resolvePublicIp(this.activeProxyAgent);
    const ws = this.resolveWebSocket();
    const rawSocket = (
      ws as unknown as {
        _socket?: { remoteAddress?: string; remotePort?: number };
      }
    )._socket;

    console.log('[Baileys][LOCAL][IP] Resultado de rede', {
      proxy,
      public_ip: publicIp ?? 'unknown',
      ws_remote_address: rawSocket?.remoteAddress ?? 'unknown',
      ws_remote_port:
        typeof rawSocket?.remotePort === 'number'
          ? rawSocket.remotePort
          : 'unknown',
      ip_endpoint: 'https://api.ipify.org?format=json',
    });
  }

  private async resolvePublicIp(agent?: HttpsAgent): Promise<string | null> {
    return new Promise((resolve) => {
      let resolved = false;
      const settle = (value: string | null): void => {
        if (resolved) {
          return;
        }
        resolved = true;
        resolve(value);
      };

      const req = httpsRequest(
        'https://api.ipify.org?format=json',
        {
          method: 'GET',
          agent,
          timeout: 8000,
          headers: {
            accept: 'application/json',
          },
        },
        (res) => {
          const chunks: Buffer[] = [];

          res.on('data', (chunk: Buffer | string) => {
            chunks.push(
              typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
            );
          });

          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              settle(null);
              return;
            }

            try {
              const body = Buffer.concat(chunks).toString('utf8');
              const payload = JSON.parse(body) as { ip?: string };
              settle(typeof payload.ip === 'string' ? payload.ip : null);
            } catch {
              settle(null);
            }
          });
        }
      );

      req.on('timeout', () => {
        req.destroy(new Error('IP lookup timeout'));
      });

      req.on('error', (error) => {
        console.error('[Baileys][LOCAL][IP] Falha ao consultar IP publico', {
          proxy: this.activeProxyUrl ?? 'disabled',
          error: error instanceof Error ? error.message : String(error),
        });
        settle(null);
      });

      req.end();
    });
  }

  private async onClose(
    last: IBaileysUpdateEvent['lastDisconnect'],
    resolve: (s: IBaileysConnectionState) => void,
    id: number
  ): Promise<void> {
    if (id !== this.socketId) {
      return;
    }

    this.connectionEstablished = false;
    const statusCode = this.extractStatusCode(last?.error);
    const statusMessage = this.extractStatusMessage(last?.error);

    await this.healthCheckService.notifyDisconnected(
      statusMessage ?? 'Connection closed'
    );
    this.healthCheckService.stop();
    this.clearReconnectRetryTimer();

    if (statusCode === ECodeMessage.restartRequired) {
      this.setStatus(Status.connecting, ECodeMessage.awaitConnection);
      resolve(this.state());
      this.pendingResolve = undefined;

      this.scheduleNextReconnectAttempt();

      return;
    }

    const disconnectionCode =
      statusCode ?? this.code ?? ECodeMessage.connectionLost;

    this.setStatus(Status.disconnected, disconnectionCode);
    this.logConnectionEvent('disconnected', {
      reason: statusMessage ?? 'Connection closed',
      mapped_code: disconnectionCode,
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

    if (!this.awaitingNewLogin) {
      const payload: IBaileysConnectionState = {
        status: this.status,
        worker_id: WORKER,
        account_id: ACCOUNT,
        code: disconnectionCode,
        worker_status_id: workerStatusId,
      };

      const payloadStr = JSON.stringify(payload);
      if (payloadStr !== this.lastStatusPayload) {
        this.publishSub(payload, true);
        this.lastStatusPayload = payloadStr;

        this.saveLogWppConnection({
          worker_id: WORKER,
          status: this.status,
          code: this.code?.toString(),
          message: statusMessage ?? 'BaileysConnectionService disconnected',
          date: new Date(),
        });
      }

      await this.notifyWorkerStatusSafely(payload, 'close');
    }

    if (isMismatchedStatus) {
      await this.updateWorkerMismatchedStatus();
    }

    if (statusCode === ECodeMessage.loggedOut) {
      const payload: IBaileysConnectionState = {
        status: this.status,
        worker_id: WORKER,
        code: disconnectionCode,
        disconnected_user: true,
        account_id: ACCOUNT,
        worker_status_id: EWorkerStatus.mismatched,
      };

      this.publishSub(payload, true);

      await this.notifyWorkerStatusSafely(payload, 'logged_out');

      this.clearFolder();
    }

    resolve(this.state());
    this.pendingResolve = undefined;

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
      this.scheduleReconnect(this.retryDelay);
    } else {
      this.scheduleNextReconnectAttempt();
    }
  }

  private onNewLoginAttempt() {
    this.awaitingNewLogin = true;
    this.connectionEstablished = false;
    this.qrReadSessionActive = false;
    this.qrReadSessionLocked = true;
    this.qrHash = undefined;
    this.setStatus(Status.connecting, ECodeMessage.pairingInProgress);

    const payload: IBaileysConnectionState = {
      status: Status.connecting,
      worker_id: WORKER,
      account_id: ACCOUNT,
      is_new_login: true,
      code: ECodeMessage.pairingInProgress,
      worker_status_id: EWorkerStatus.disponible,
    };

    this.publishSub(payload);
    void this.notifyWorkerStatusSafely(payload, 'pairing_in_progress');
  }

  private canShowQr(): boolean {
    return (
      this.initialConnection &&
      !this.connected &&
      this.qrReadSessionActive &&
      !this.qrReadSessionLocked
    );
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

    if (
      !this.qrReadSessionActive &&
      !this.qrReadSessionLocked &&
      !this.hasSession()
    ) {
      this.qrReadSessionActive = true;
      this.qrGenerationCount = 0;
      this.qrHash = undefined;
    }
  }

  private resetQrReadSession(): void {
    this.qrReadSessionActive = false;
    this.qrGenerationCount = 0;
  }

  private shouldScheduleRetryAfterClose(): boolean {
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

  private async handleQrGenerationLimitReached(): Promise<void> {
    this.qrReadSessionActive = false;
    this.qrReadSessionLocked = true;
    this.retryCount = 0;
    this.qrHash = undefined;
    this.setStatus(Status.connecting, ECodeMessage.awaitConnection);

    const payload: IBaileysConnectionState = {
      status: this.status,
      code: this.code,
      worker_id: WORKER,
      account_id: ACCOUNT,
      attempt: this.maxQrGenerations + 1,
      max_attempts: this.maxQrGenerations,
      worker_status_id: EWorkerStatus.disponible,
    };

    this.publishSub(payload, true);
    void this.notifyWorkerStatusSafely(payload, 'qr_limit_reached');
    this.cancelAttempt(false);
  }

  hasSession(): boolean {
    return fs.existsSync(FOLDER) && fs.readdirSync(FOLDER).length > 0;
  }

  private async restoreWithRetries(): Promise<IBaileysConnectionState> {
    try {
      return await this.connect({
        initial_connection: this.initialConnection,
        allow_restore: false,
        from_disconnect_restart: true,
        requested_by_user: false,
      });
    } catch (e) {
      this.saveLogWppConnection({
        worker_id: WORKER,
        status: Status.disconnected,
        code: ECodeMessage.connectionLost,
        message: `Failed to restore session: ${e instanceof Error ? e.message : String(e)}`,
        date: new Date(),
      });

      this.setStatus(Status.disconnected, ECodeMessage.connectionLost);
      this.scheduleNextReconnectAttempt();

      return this.state();
    }
  }

  private publishSub(payload: IBaileysConnectionState, force = false): void {
    if (!this.initialConnection && !force) {
      return;
    }

    const data = JSON.stringify(payload);
    if (data === this.lastPayload && !force) {
      return;
    }

    this.lastPayload = data;
    void this.centrifugo.publishSub(CHANNEL, payload).catch((error) => {
      console.error('[BaileysConnection] publishSub - Failed', error);
    });
  }

  private async notifyWorkerStatusSafely(
    payload: IBaileysConnectionState,
    context: string
  ): Promise<void> {
    try {
      await this.balanceWorkerStatusGrpcClientService.notifyWorkerStatus(
        payload
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error('[BaileysConnection] NotifyWorkerStatus failed', {
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

  private async safeLogout(forceLogout = false): Promise<void> {
    this.clearReconnectRetryTimer();

    if (forceLogout && this.socket?.user) {
      try {
        await this.socket.logout();
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

      this.socket = undefined;
      this.setStatus(Status.disconnected, ECodeMessage.loggedOut);
      return;
    }

    try {
      const ws = this.resolveWebSocket();
      if (!ws) {
        this.socket = undefined;
        this.setStatus(Status.disconnected, ECodeMessage.loggedOut);

        return;
      }

      const readyState = ws.readyState;
      if (readyState === 1) {
        ws.close(1000, 'logout');

        return;
      }

      if (readyState === 0 || readyState === 2) {
        ws.terminate?.();
      }
    } catch {
      this.saveLogWppConnection({
        worker_id: WORKER,
        status: Status.disconnected,
        code: ECodeMessage.connectionLost,
        message: 'Error during WebSocket close',
        date: new Date(),
      });
    }

    this.socket = undefined;
    this.setStatus(Status.disconnected, ECodeMessage.loggedOut);
  }

  private cancelAttempt(skipWebSocketClose = false) {
    this.clearReconnectRetryTimer();

    try {
      this.socket?.ev.removeAllListeners('connection.update');
    } catch {
      this.saveLogWppConnection({
        worker_id: WORKER,
        status: Status.disconnected,
        code: ECodeMessage.connectionLost,
        message: 'Error during cancel attempt',
        date: new Date(),
      });
    }

    this.baileysIncomingMessageService.unbind();

    if (!skipWebSocketClose) {
      try {
        const ws = this.resolveWebSocket();
        if (ws) {
          const readyState = ws.readyState;
          if (readyState === 1) {
            ws.close(1000, 'reconnect');
          } else if (readyState === 0 || readyState === 2) {
            ws.terminate?.();
          }
        }
      } catch {
        this.saveLogWppConnection({
          worker_id: WORKER,
          status: Status.disconnected,
          code: ECodeMessage.connectionLost,
          message: 'Error closing websocket during cancel attempt',
          date: new Date(),
        });
      }
    }

    this.pendingResolve?.(this.state());
    this.pendingResolve = undefined;

    this.currentPromise = undefined;
    this.connecting = false;
    this.awaitingNewLogin = false;
    this.connectionEstablished = false;

    if (!skipWebSocketClose) {
      this.socket = undefined;
    }
  }

  private reportConnected(): IBaileysConnectionState {
    if (this.initialConnection) {
      this.lastPayload = null;

      const payload = {
        status: this.status,
        code: ECodeMessage.connectionEstablished,
        worker_id: WORKER,
        account_id: ACCOUNT,
        phone: getPhoneNumber(this.socket?.user?.id),
        worker_status_id: EWorkerStatus.online,
      };

      this.publishSub(payload);
      void this.notifyWorkerStatusSafely(payload, 'report_connected');
    }

    return this.state();
  }

  private prepareFolder() {
    if (!fs.existsSync(FOLDER)) {
      fs.mkdirSync(FOLDER, {
        recursive: true,
      });
    }
  }

  private clearFolder() {
    if (!fs.existsSync(FOLDER)) {
      return;
    }

    for (const f of fs.readdirSync(FOLDER)) {
      fs.rmSync(path.join(FOLDER, f), {
        recursive: true,
        force: true,
      });
    }
  }

  private setStatus(s: Status, c?: ECodeMessage) {
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

  private state(qr?: string): IBaileysConnectionState {
    const result: IBaileysConnectionState = {
      status: this.status,
      worker_id: WORKER,
      account_id: ACCOUNT,
      qrcode: qr,
      code: this.code,
    };
    if (this.status === Status.connecting) {
      result.attempt = this.retryCount > 0 ? this.retryCount : 1;
      result.max_attempts = this.maxRetries;
    }
    return result;
  }

  private resolveWebSocket(): WebSocket | undefined {
    const reference = this.socket as unknown;
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

  private extractStatusCode(error: unknown): ECodeMessage | undefined {
    if (!error || typeof error !== 'object') {
      return undefined;
    }

    const errorWithOutput = error as {
      output?: { statusCode?: number };
      statusCode?: number;
    };

    const outputCode = errorWithOutput.output?.statusCode;
    if (typeof outputCode === 'number') {
      return outputCode as ECodeMessage;
    }

    const directCode = errorWithOutput.statusCode;
    if (typeof directCode === 'number') {
      return directCode as ECodeMessage;
    }

    return undefined;
  }

  private extractStatusMessage(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') {
      return undefined;
    }

    const errorWithMessage = error as {
      message?: unknown;
      data?: { message?: unknown };
    };

    const directMessage = errorWithMessage.message;
    if (typeof directMessage === 'string') {
      return directMessage;
    }

    const nestedMessage = errorWithMessage.data?.message;
    if (typeof nestedMessage === 'string') {
      return nestedMessage;
    }

    return undefined;
  }

  private logConnectionEvent(
    event: string,
    details: Record<string, unknown> = {},
    level: 'info' | 'warn' | 'error' = 'info'
  ): void {
    const payload = {
      module: 'worker_baileys',
      component: 'baileys_connection_service',
      type: 'connection_status',
      event,
      worker_id: WORKER,
      account_id: ACCOUNT,
      status: this.status,
      code: this.code,
      ...details,
    };

    if (level === 'error') {
      logger.error(payload, 'Baileys connection event');
      return;
    }

    if (level === 'warn') {
      logger.warn(payload, 'Baileys connection event');
      return;
    }

    logger.info(payload, 'Baileys connection event');
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

    const documentId = buildWppConnectionDocumentId(ACCOUNT, wppLog.worker_id);

    const updateResult = await this.elasticDatabaseService.updateWithOCC(
      EElasticIndex.wpp_connection,
      documentId,
      wppLog as unknown as Record<string, unknown>,
      {
        upsert: true,
        maxRetries: 5,
      }
    );

    return (
      updateResult === 'updated' ||
      updateResult === 'created' ||
      updateResult === 'noop'
    );
  };
}
