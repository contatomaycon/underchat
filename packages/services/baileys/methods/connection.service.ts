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
import { HttpsProxyAgent } from 'https-proxy-agent';
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
import { triggerConnectionEstablished } from '../callbacks';

const FOLDER = `/app/data/storage/${baileysEnvironment.baileysWorkerId}`;
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const CHANNEL = workerCentrifugoQueue(baileysEnvironment.baileysAccountId);
const WORKER = baileysEnvironment.baileysWorkerId;
const ACCOUNT = baileysEnvironment.baileysAccountId;
const WA_VERSION_TTL_MS = 6 * 60 * 60 * 1000;
const SHOULD_PRINT_QR_IN_TERMINAL =
  process.env.APP_ENVIRONMENT === EAppEnvironment.local;
let cachedWaVersion: {
  version: [number, number, number];
  fetchedAt: number;
} | null = null;

function readProxyUrl(): string | null {
  const host = process.env.PROXY_HOST?.trim();
  const port = Number.parseInt(process.env.PROXY_PORT ?? '', 10);

  if (!host || !Number.isFinite(port) || port <= 0) {
    return null;
  }

  const username = process.env.PROXY_USERNAME?.trim();
  const password = process.env.PROXY_PASSWORD?.trim();
  const auth =
    username && password
      ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
      : '';

  return `http://${auth}${host}:${port}`;
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
  private readonly retryDelay = 2000;
  private readonly maxRetries = 5;

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
  private currentPromise?: Promise<IBaileysConnectionState>;
  private pendingResolve?: (s: IBaileysConnectionState) => void;
  private connectionEstablished = false;
  private userRequestedDisconnect = false;

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
      onStatusMismatch: (detectedStatus) => {
        this.handleHealthCheckMismatch(detectedStatus);
      },
    });
  }

  private handleHealthCheckMismatch(detectedStatus: Status): void {
    if (detectedStatus === Status.disconnected && this.connectionEstablished) {
      console.log(
        '[BaileysConnection] Health check detected disconnection, triggering reconnect'
      );
      this.connectionEstablished = false;
      this.setStatus(Status.disconnected, ECodeMessage.connectionLost);

      if (!this.userRequestedDisconnect) {
        this.reconnect({ initial_connection: this.initialConnection });
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

  private handleInitialConnectionState(
    initialConnection: boolean
  ): Promise<IBaileysConnectionState> | null {
    if (!this.connecting) return null;

    if (initialConnection) {
      this.cancelAttempt();
    }

    if (this.currentPromise) {
      return this.currentPromise;
    }

    return null;
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

    if (requestedByUser) {
      this.userRequestedDisconnect = false;
    }

    if (this.userRequestedDisconnect && !fromDisconnectRestart) {
      return this.state();
    }

    this.initialConnection = initialConnection;
    this.typeConnection = typeConnection;
    this.phoneConnection = phoneConnection;

    if (forceNew) {
      this.cancelAttempt(false);
    }

    if (this.connected) {
      return this.reportConnected();
    }

    const initialState = this.handleInitialConnectionState(initialConnection);
    if (initialState) {
      return initialState;
    }

    if (this.canRestoreSession(allowRestore)) {
      const restoreState = this.handleRestoreSession();
      if (restoreState) {
        return restoreState;
      }
    }

    const existingState = this.handleExistingConnection();
    if (existingState) {
      return existingState;
    }

    const disconnectedState = this.handleDisconnectedWithRestore(allowRestore);
    if (disconnectedState) {
      return disconnectedState;
    }

    const connectingState = this.handleConnectingWithRestore(allowRestore);
    if (connectingState) {
      return connectingState;
    }

    this.prepareFolder();
    this.connecting = true;
    this.retryCount = 0;
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
    } = input;

    this.initialConnection = initialConnection;
    this.connectionEstablished = false;

    await this.healthCheckService.notifyDisconnected(
      disconnectedUser ? 'User requested disconnect' : 'Connection closed'
    );
    this.healthCheckService.stop();

    if (disconnectedUser) {
      this.userRequestedDisconnect = true;
    }

    await this.safeLogout(true);
    this.cancelAttempt(false);
    this.clearFolder();

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

    const shouldReconnect = this.initialConnection && !disconnectedUser;

    if (shouldReconnect) {
      this.connect({
        initial_connection: true,
      });
    }
  }

  reconnect(input: IBaileysConnection): void {
    const { initial_connection: initialConnection = true } = input;

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

  private async createSocket() {
    const { state, saveCreds } = await useMultiFileAuthState(FOLDER);
    const version = await getCachedWaWebVersion();
    const proxyUrl = readProxyUrl();
    const proxyAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

    const socket = makeWASocket({
      auth: state,
      version,
      browser: Browsers.ubuntu('Chrome'),
      logger: P({ level: 'silent' }),
      printQRInTerminal: false,
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
          return this.onQr(qr, resolve);
        }

        if (isNewLogin) {
          return this.onNewLoginAttempt();
        }

        if (connection === 'open' && !opened) {
          opened = true;
          this.retryCount = 0;

          return void this.onOpen(resolve);
        }

        if (connection === 'close') {
          return this.onClose(lastDisconnect, resolve);
        }

        this.awaitingNewLogin = false;
      });
    });
  }

  private async onQr(
    qr: string,
    resolve: (s: IBaileysConnectionState) => void
  ): Promise<void> {
    if (qr.slice(-20) === this.qrHash) {
      return;
    }

    this.qrHash = qr.slice(-20);
    this.setStatus(Status.connecting, ECodeMessage.awaitingReadQrCode);

    await this.printQrInConsole(qr);
    const img = await QRCode.toDataURL(qr);

    this.publishSub({
      status: this.status,
      code: this.code,
      qrcode: img,
      worker_id: WORKER,
      account_id: ACCOUNT,
      worker_status_id: EWorkerStatus.disponible,
    });

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
    resolve: (s: IBaileysConnectionState) => void
  ): Promise<void> {
    this.qrHash = undefined;
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

    this.healthCheckService.start(HEALTH_CHECK_INTERVAL_MS);

    triggerConnectionEstablished();

    resolve(this.state());

    this.pendingResolve = undefined;
  }

  private async onClose(
    last: IBaileysUpdateEvent['lastDisconnect'],
    resolve: (s: IBaileysConnectionState) => void
  ): Promise<void> {
    this.connectionEstablished = false;
    const statusCode = this.extractStatusCode(last?.error);
    const statusMessage = this.extractStatusMessage(last?.error);

    await this.healthCheckService.notifyDisconnected(
      statusMessage ?? 'Connection closed'
    );
    this.healthCheckService.stop();

    if (statusCode === ECodeMessage.restartRequired) {
      this.setStatus(Status.connecting, ECodeMessage.awaitConnection);
      resolve(this.state());
      this.pendingResolve = undefined;

      setTimeout(() => {
        this.connect({
          initial_connection: this.initialConnection,
        }).catch(() => {
          this.saveLogWppConnection({
            worker_id: WORKER,
            status: this.status ?? Status.disconnected,
            code: this.code ?? ECodeMessage.connectionLost,
            message: 'Reconnect failed after restartRequired',
            date: new Date(),
          });
        });
      }, 0);

      return;
    }

    const disconnectionCode =
      statusCode ?? this.code ?? ECodeMessage.connectionLost;

    this.setStatus(Status.disconnected, disconnectionCode);

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

        try {
          await this.balanceWorkerStatusGrpcClientService.notifyWorkerStatus(
            payload
          );
        } catch {}

        this.saveLogWppConnection({
          worker_id: WORKER,
          status: this.status,
          code: this.code?.toString(),
          message: statusMessage ?? 'BaileysConnectionService disconnected',
          date: new Date(),
        });
      }
    }

    if (isMismatchedStatus) {
      await this.updateWorkerMismatchedStatus();
    }

    if (statusCode === ECodeMessage.loggedOut) {
      if (!this.initialConnection) {
        this.clearFolder();
      }

      const payload: IBaileysConnectionState = {
        status: this.status,
        worker_id: WORKER,
        code: disconnectionCode,
        disconnected_user: true,
        account_id: ACCOUNT,
        worker_status_id: EWorkerStatus.mismatched,
      };

      this.publishSub(payload, true);

      try {
        await this.balanceWorkerStatusGrpcClientService.notifyWorkerStatus(
          payload
        );
      } catch {}
    }

    resolve(this.state());
    this.pendingResolve = undefined;

    if (this.retryCount < this.maxRetries) {
      const retryPayload: IBaileysConnectionState = {
        status: Status.connecting,
        worker_id: WORKER,
        account_id: ACCOUNT,
        code: ECodeMessage.awaitConnection,
        attempt: this.retryCount + 1,
        max_attempts: this.maxRetries,
        seconds_until_next_attempt: Math.ceil(this.retryDelay / 1000),
      };
      this.publishSub(retryPayload, true);

      setTimeout(() => {
        this.retryCount++;

        this.connect({
          initial_connection: this.initialConnection,
        }).catch(() => {
          this.saveLogWppConnection({
            worker_id: WORKER,
            status: this.status ?? Status.disconnected,
            code: this.code ?? ECodeMessage.connectionLost,
            message: 'Retry failed',
            date: new Date(),
          });
        });
      }, this.retryDelay);
    }
  }

  private onNewLoginAttempt() {
    this.awaitingNewLogin = true;
    this.connectionEstablished = false;

    const payload: IBaileysConnectionState = {
      status: this.status,
      worker_id: WORKER,
      account_id: ACCOUNT,
      is_new_login: true,
      code: ECodeMessage.newLoginAttempt,
      worker_status_id: EWorkerStatus.disponible,
    };

    this.centrifugo.publishSub(CHANNEL, payload);
  }

  private canShowQr(): boolean {
    return this.initialConnection && !this.connected;
  }

  hasSession(): boolean {
    return fs.existsSync(FOLDER) && fs.readdirSync(FOLDER).length > 0;
  }

  private async restoreWithRetries(): Promise<IBaileysConnectionState> {
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        const s = await this.connect({
          initial_connection: this.initialConnection,
          allow_restore: false,
        });

        if (s.status === Status.connected) {
          return s;
        }
      } catch (e) {
        this.saveLogWppConnection({
          worker_id: WORKER,
          status: Status.disconnected,
          code: ECodeMessage.connectionLost,
          message: `Failed to restore session: ${e instanceof Error ? e.message : String(e)}`,
          date: new Date(),
        });
      }

      await new Promise((r) => setTimeout(r, this.retryDelay));
    }
    this.setStatus(Status.disconnected, ECodeMessage.badSession);
    this.clearFolder();

    await this.updateWorkerMismatchedStatus();

    return this.connect({
      initial_connection: this.initialConnection,
      allow_restore: true,
    });
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
    for (const f of fs.readdirSync(FOLDER)) {
      fs.rmSync(path.join(FOLDER, f), {
        recursive: true,
        force: true,
      });
    }
  }

  private setStatus(s: Status, c?: ECodeMessage) {
    this.status = s;

    if (c) {
      this.code = c;
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
      result.attempt = this.retryCount + 1;
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
