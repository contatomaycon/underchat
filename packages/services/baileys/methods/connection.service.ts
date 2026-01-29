import {
  Browsers,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  makeWASocket,
  useMultiFileAuthState,
  type WASocket,
} from '@whiskeysockets/baileys';
import Boom from '@hapi/boom';
import type WebSocket from 'ws';
import QRCode from 'qrcode';
import P from 'pino';
import fs from 'node:fs';
import path from 'node:path';
import { singleton } from 'tsyringe';
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
import { StreamProducerService } from '@core/services/streamProducer.service';
import { IBaileysConnection } from '@core/common/interfaces/IBaileysConnection';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { BaileysIncomingMessageService } from './incoming.service';
import { getPhoneNumber } from '@core/common/functions/getPhoneNumber';
import { buildWppConnectionDocumentId } from '@core/common/functions/buildWppConnectionDocumentId';

const FOLDER = `/app/data/storage/${baileysEnvironment.baileysWorkerId}`;
const CHANNEL = workerCentrifugoQueue(baileysEnvironment.baileysAccountId);
const WORKER = baileysEnvironment.baileysWorkerId;
const ACCOUNT = baileysEnvironment.baileysAccountId;

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
  private connectCallId = 0;
  private connectAttemptId = 0;
  private connectAttemptStartedAt?: number;
  private connectAttemptCallId?: number;
  private connectionUpdateCount = 0;

  private connecting = false;
  private retryCount = 0;
  private currentPromise?: Promise<IBaileysConnectionState>;
  private pendingResolve?: (s: IBaileysConnectionState) => void;
  private connectionEstablished = false;
  private keepAliveInterval?: NodeJS.Timeout;
  private readonly keepAliveIntervalMs = 600_000;
  private isKeepAliveRunning = false;
  private keepAliveTimeoutMs = 30_000;

  constructor(
    private readonly centrifugo: CentrifugoService,
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly baileysIncomingMessageService: BaileysIncomingMessageService
  ) {}

  get connected(): boolean {
    const value =
      this.connectionEstablished && this.status === Status.connected;
    console.log('[worker_baileys:connection] get connected', { value });
    return value;
  }

  getStatus(): Status {
    console.log('[worker_baileys:connection] getStatus', {
      status: this.status,
    });
    return this.status;
  }

  getSocket(): WASocket | undefined {
    console.log('[worker_baileys:connection] getSocket', {
      hasSocket: !!this.socket,
    });
    return this.socket;
  }

  private handleAlreadyConnecting(): Promise<IBaileysConnectionState> | null {
    console.log('[worker_baileys:connection] handleAlreadyConnecting', {
      connecting: this.connecting,
      hasCurrentPromise: !!this.currentPromise,
      attemptId: this.connectAttemptId,
      socketId: this.socketId,
    });
    if (!this.connecting) return null;

    if (this.currentPromise) {
      return this.currentPromise;
    }

    return Promise.resolve(this.reportConnecting());
  }

  private canRestoreSession(allowRestore: boolean): boolean {
    const result =
      allowRestore &&
      (this.status === Status.initial || this.status === Status.disconnected) &&
      this.hasSession();
    console.log('[worker_baileys:connection] canRestoreSession', {
      allowRestore,
      status: this.status,
      result,
      attemptId: this.connectAttemptId,
      socketId: this.socketId,
    });
    return result;
  }

  private handleRestoreSession(): Promise<IBaileysConnectionState> | null {
    console.log('[worker_baileys:connection] handleRestoreSession', {
      restoreInProgress: this.restoreSessionInProgress(),
      hasCurrentPromise: !!this.currentPromise,
    });
    if (!this.restoreSessionInProgress()) {
      return this.restoreWithRetries();
    }

    if (this.currentPromise) {
      return this.currentPromise;
    }

    return Promise.resolve(this.reportConnecting());
  }

  private handleExistingConnection(): Promise<IBaileysConnectionState> | null {
    console.log('[worker_baileys:connection] handleExistingConnection', {
      connected: this.connected,
      connecting: this.connecting,
      status: this.status,
      hasSocket: !!this.socket,
      attemptId: this.connectAttemptId,
      socketId: this.socketId,
    });
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

    if (this.status === Status.connecting && this.socket) {
      return Promise.resolve(this.reportConnecting());
    }

    return null;
  }

  private handleDisconnectedWithRestore(
    allowRestore: boolean
  ): Promise<IBaileysConnectionState> | null {
    console.log('[worker_baileys:connection] handleDisconnectedWithRestore', {
      allowRestore,
      status: this.status,
      hasSession: this.hasSession(),
      attemptId: this.connectAttemptId,
      socketId: this.socketId,
    });
    if (!allowRestore) return null;
    if (this.status !== Status.disconnected) return null;
    if (!this.hasSession()) return null;
    return this.restoreWithRetries();
  }

  private handleConnectingWithRestore(
    allowRestore: boolean
  ): Promise<IBaileysConnectionState> | null {
    console.log('[worker_baileys:connection] handleConnectingWithRestore', {
      allowRestore,
      status: this.status,
      hasCurrentPromise: !!this.currentPromise,
      attemptId: this.connectAttemptId,
      socketId: this.socketId,
    });
    if (!allowRestore) return null;
    if (this.status !== Status.connecting) return null;
    if (!this.currentPromise) return null;
    return this.currentPromise;
  }

  async connect(input: IBaileysConnection): Promise<IBaileysConnectionState> {
    const callId = (this.connectCallId += 1);
    console.log('[worker_baileys:connection] connect entrada', {
      input,
      callId,
      status: this.status,
      connecting: this.connecting,
      socketId: this.socketId,
      attemptId: this.connectAttemptId,
      ts: Date.now(),
    });
    const {
      initial_connection: initialConnection = false,
      allow_restore: allowRestore = true,
      type: typeConnection = EBaileysConnectionType.qrcode,
      phone_connection: phoneConnection,
    } = input;

    this.initialConnection = initialConnection;
    this.typeConnection = typeConnection;
    this.phoneConnection = phoneConnection;

    if (this.connected) {
      console.log('[worker_baileys:connection] connect já conectado');
      return this.reportConnected();
    }

    const alreadyConnecting = this.handleAlreadyConnecting();
    if (alreadyConnecting) {
      console.log(
        '[worker_baileys:connection] connect retorno handleAlreadyConnecting'
      );
      return alreadyConnecting;
    }

    if (this.canRestoreSession(allowRestore)) {
      const restoreState = this.handleRestoreSession();
      if (restoreState) {
        console.log(
          '[worker_baileys:connection] connect retorno handleRestoreSession'
        );
        return restoreState;
      }
    }

    const existingState = this.handleExistingConnection();
    if (existingState) {
      console.log(
        '[worker_baileys:connection] connect retorno handleExistingConnection'
      );
      return existingState;
    }

    const disconnectedState = this.handleDisconnectedWithRestore(allowRestore);
    if (disconnectedState) {
      console.log(
        '[worker_baileys:connection] connect retorno handleDisconnectedWithRestore'
      );
      return disconnectedState;
    }

    const connectingState = this.handleConnectingWithRestore(allowRestore);
    if (connectingState) {
      console.log(
        '[worker_baileys:connection] connect retorno handleConnectingWithRestore'
      );
      return connectingState;
    }

    console.log('[worker_baileys:connection] connect criando nova conexão', {
      callId,
      ts: Date.now(),
    });
    this.prepareFolder();
    this.connecting = true;
    this.retryCount = 0;
    this.socketId += 1;
    this.connectAttemptId += 1;
    this.connectAttemptCallId = callId;
    this.connectAttemptStartedAt = Date.now();
    this.connectionUpdateCount = 0;
    console.log('[worker_baileys:connection] connect tentativa iniciada', {
      attemptId: this.connectAttemptId,
      callId,
      socketId: this.socketId,
      ts: Date.now(),
    });

    const { socket } = await this.createSocket();
    console.log(
      '[worker_baileys:connection] connect socket criado, bind incoming',
      {
        attemptId: this.connectAttemptId,
        callId,
        socketId: this.socketId,
        msSinceAttempt: this.connectAttemptStartedAt
          ? Date.now() - this.connectAttemptStartedAt
          : undefined,
        ts: Date.now(),
      }
    );
    this.baileysIncomingMessageService.bindTo(socket);
    this.socket = socket;

    if (this.typeConnection === EBaileysConnectionType.phone) {
      await this.requestPairing(socket);
    }

    this.currentPromise = this.wait(socket, this.socketId).finally(() => {
      this.connecting = false;
      this.currentPromise = undefined;
      console.log('[worker_baileys:connection] connect wait finally');
    });

    return this.currentPromise;
  }

  async disconnect(input: IBaileysConnection): Promise<void> {
    console.log('[worker_baileys:connection] disconnect entrada', { input });
    const {
      initial_connection: initialConnection = false,
      disconnected_user: disconnectedUser = false,
    } = input;

    this.stopKeepAlive();
    this.initialConnection = initialConnection;
    this.connectionEstablished = false;

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

    await this.streamProducerService.send(
      this.kafkaServiceQueueService.workerStatus(),
      payload,
      WORKER
    );

    if (this.initialConnection) {
      console.log(
        '[worker_baileys:connection] disconnect reconectando (initial_connection)'
      );
      this.connect({
        initial_connection: true,
      });
    }
    console.log('[worker_baileys:connection] disconnect concluído');
  }

  abortConnectionAttempt(reason?: string): void {
    console.log('[worker_baileys:connection] abortConnectionAttempt', {
      reason,
      attemptId: this.connectAttemptId,
      socketId: this.socketId,
      status: this.status,
    });
    this.cancelAttempt(false);
  }

  reconnect(input: IBaileysConnection): void {
    console.log('[worker_baileys:connection] reconnect', { input });
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

  private async fetchLatestWppConnectVersion(): Promise<{
    version: [number, number, number];
    isLatest: boolean;
  }> {
    const response = await fetch('https://wppconnect.io/whatsapp-versions/', {
      method: 'GET',
    });
    if (!response.ok) {
      throw Boom.badRequest(
        `Failed to fetch wppconnect versions: ${response.statusText}`
      );
    }
    const data = await response.text();
    const regex = /(\d+)\.(\d+)\.(\d+)-alpha/g;
    const match = regex.exec(data);
    if (!match) {
      throw Boom.badRequest('No version found in wppconnect response');
    }
    const [, major, minor, patch] = match;
    return {
      version: [Number(major), Number(minor), Number(patch)],
      isLatest: true,
    };
  }

  private async fetchVersionWithFallback(): Promise<[number, number, number]> {
    const FALLBACK_VERSION: [number, number, number] = [2, 3000, 1015331287];
    const FETCH_TIMEOUT_MS = 3000;
    const MAX_ATTEMPTS = 3;

    const withTimeout = <T>(promise: Promise<T>, name: string): Promise<T> => {
      return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`${name} timeout`)),
            FETCH_TIMEOUT_MS
          )
        ),
      ]);
    };

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const t = Date.now();
      console.log(
        '[worker_baileys:init] connection.service: fetchVersion tentativa',
        { attempt, ts: t }
      );

      try {
        const result = await withTimeout(
          fetchLatestBaileysVersion(),
          'fetchLatestBaileysVersion'
        );
        console.log(
          '[worker_baileys:init] connection.service: fetchLatestBaileysVersion sucesso',
          {
            version: result.version,
            attempt,
            ms: Date.now() - t,
            ts: Date.now(),
          }
        );
        return result.version;
      } catch (err) {
        console.log(
          '[worker_baileys:init] connection.service: fetchLatestBaileysVersion falhou',
          {
            error: err instanceof Error ? err.message : String(err),
            attempt,
            ms: Date.now() - t,
          }
        );
      }

      try {
        const result = await withTimeout(
          fetchLatestWaWebVersion(),
          'fetchLatestWaWebVersion'
        );
        console.log(
          '[worker_baileys:init] connection.service: fetchLatestWaWebVersion sucesso',
          {
            version: result.version,
            attempt,
            ms: Date.now() - t,
            ts: Date.now(),
          }
        );
        return result.version;
      } catch (err) {
        console.log(
          '[worker_baileys:init] connection.service: fetchLatestWaWebVersion falhou',
          {
            error: err instanceof Error ? err.message : String(err),
            attempt,
            ms: Date.now() - t,
          }
        );
      }

      try {
        const result = await withTimeout(
          this.fetchLatestWppConnectVersion(),
          'fetchLatestWppConnectVersion'
        );
        console.log(
          '[worker_baileys:init] connection.service: fetchLatestWppConnectVersion sucesso',
          {
            version: result.version,
            attempt,
            ms: Date.now() - t,
            ts: Date.now(),
          }
        );
        return result.version;
      } catch (err) {
        console.log(
          '[worker_baileys:init] connection.service: fetchLatestWppConnectVersion falhou',
          {
            error: err instanceof Error ? err.message : String(err),
            attempt,
            ms: Date.now() - t,
          }
        );
      }

      if (attempt < MAX_ATTEMPTS) {
        console.log(
          '[worker_baileys:init] connection.service: todas as fontes falharam, aguardando próxima tentativa',
          { attempt, nextAttempt: attempt + 1 }
        );
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    console.log(
      '[worker_baileys:init] connection.service: todas tentativas esgotadas, usando fallback',
      { fallbackVersion: FALLBACK_VERSION }
    );
    return FALLBACK_VERSION;
  }

  private async createSocket() {
    const attemptId = this.connectAttemptId;
    const t0 = Date.now();
    console.log(
      '[worker_baileys:init] connection.service: createSocket iniciado',
      { ts: t0, attemptId }
    );

    let folderExists = false;
    let folderFiles = 0;
    try {
      folderExists = fs.existsSync(FOLDER);
      folderFiles = folderExists ? fs.readdirSync(FOLDER).length : 0;
    } catch (error) {
      console.log(
        '[worker_baileys:init] connection.service: erro lendo pasta de auth',
        {
          attemptId,
          err: error instanceof Error ? error.message : String(error),
        }
      );
    }
    console.log(
      '[worker_baileys:init] connection.service: auth folder status',
      { attemptId, folderExists, folderFiles, ts: Date.now() }
    );

    const t1 = Date.now();
    const { state, saveCreds } = await useMultiFileAuthState(FOLDER);
    const authMs = Date.now() - t1;
    console.log(
      '[worker_baileys:init] connection.service: useMultiFileAuthState concluído',
      { ms: authMs, ts: Date.now(), attemptId }
    );
    if (authMs > 5000) {
      console.warn(
        '[worker_baileys:init] connection.service: useMultiFileAuthState lento',
        { ms: authMs, attemptId }
      );
    }

    const t2 = Date.now();
    const version = await this.fetchVersionWithFallback();
    console.log(
      '[worker_baileys:init] connection.service: fetchVersionWithFallback concluído',
      { version, ms: Date.now() - t2, ts: Date.now(), attemptId }
    );

    const t3 = Date.now();
    const socket = makeWASocket({
      auth: state,
      version,
      browser: Browsers.windows('Chrome'),
      logger: P({ level: 'silent' }),
      printQRInTerminal: false,
      enableAutoSessionRecreation: true,
      enableRecentMessageCache: true,
      retryRequestDelayMs: 5_000,
      connectTimeoutMs: 30_000,
      keepAliveIntervalMs: 15_000,
      defaultQueryTimeoutMs: 60_000,
      maxMsgRetryCount: 10,
      syncFullHistory: false,
    });
    console.log(
      '[worker_baileys:init] connection.service: makeWASocket concluído',
      { ms: Date.now() - t3, ts: Date.now(), attemptId }
    );

    socket.ev.on('creds.update', saveCreds);

    console.log(
      '[worker_baileys:init] connection.service: createSocket concluído',
      { msTotal: Date.now() - t0, ts: Date.now(), attemptId }
    );
    return { socket, saveCreds };
  }

  private async requestPairing(socket: WASocket): Promise<void> {
    console.log('[worker_baileys:connection] requestPairing', {
      hasPhoneConnection: !!this.phoneConnection,
      registered: socket.authState.creds.registered,
    });
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
      console.log(
        '[worker_baileys:connection] requestPairing pairing code publicado'
      );
    }
  }

  private restoreSessionInProgress(): boolean {
    const result =
      this.connecting &&
      !!this.currentPromise &&
      this.hasSession() &&
      (this.status === Status.connecting || this.status === Status.initial);
    console.log('[worker_baileys:connection] restoreSessionInProgress', {
      result,
      connecting: this.connecting,
      hasCurrentPromise: !!this.currentPromise,
      status: this.status,
    });
    return result;
  }

  private reportConnecting(): IBaileysConnectionState {
    console.log('[worker_baileys:connection] reportConnecting', {
      status: this.status,
      attemptId: this.connectAttemptId,
      socketId: this.socketId,
    });
    if (this.status !== Status.connecting) {
      this.setStatus(Status.connecting, ECodeMessage.awaitConnection);
    }

    return this.state();
  }

  private wait(socket: WASocket, id: number): Promise<IBaileysConnectionState> {
    console.log('[worker_baileys:connection] wait iniciado', { socketId: id });
    return new Promise<IBaileysConnectionState>((resolve) => {
      this.pendingResolve = resolve;
      let opened = false;

      socket.ev.on('connection.update', async (u: IBaileysUpdateEvent) => {
        if (id !== this.socketId) {
          console.log(
            '[worker_baileys:connection] connection.update id ignorado',
            {
              id,
              socketId: this.socketId,
              attemptId: this.connectAttemptId,
              ts: Date.now(),
            }
          );
          return;
        }

        const { qr, connection, isNewLogin, lastDisconnect } = u;
        this.connectionUpdateCount += 1;
        const msSinceAttempt = this.connectAttemptStartedAt
          ? Date.now() - this.connectAttemptStartedAt
          : undefined;
        console.log('[worker_baileys:connection] connection.update', {
          hasQr: !!qr,
          connection,
          isNewLogin,
          hasLastDisconnect: !!lastDisconnect,
          eventCount: this.connectionUpdateCount,
          attemptId: this.connectAttemptId,
          socketId: this.socketId,
          msSinceAttempt,
          ts: Date.now(),
        });

        if (isNewLogin) {
          return this.onNewLoginAttempt();
        }

        if (
          qr &&
          this.canShowQr() &&
          this.typeConnection === EBaileysConnectionType.qrcode &&
          !this.awaitingNewLogin
        ) {
          return this.onQr(qr, resolve);
        }

        if (connection === 'open' && !opened) {
          opened = true;
          this.retryCount = 0;
          console.log('[worker_baileys:connection] connection.update open');

          return void this.onOpen(resolve);
        }

        if (connection === 'close') {
          console.log('[worker_baileys:connection] connection.update close');
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
    console.log('[worker_baileys:connection] onQr', {
      qrHash: qr.slice(-20),
      sameAsLast: qr.slice(-20) === this.qrHash,
      attemptId: this.connectAttemptId,
      socketId: this.socketId,
      msSinceAttempt: this.connectAttemptStartedAt
        ? Date.now() - this.connectAttemptStartedAt
        : undefined,
    });
    if (qr.slice(-20) === this.qrHash) {
      return;
    }

    this.qrHash = qr.slice(-20);
    this.setStatus(Status.connecting, ECodeMessage.awaitingReadQrCode);

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
    console.log('[worker_baileys:connection] onQr concluído, qrcode publicado');

    this.pendingResolve = undefined;
  }

  private async onOpen(
    resolve: (s: IBaileysConnectionState) => void
  ): Promise<void> {
    console.log('[worker_baileys:connection] onOpen', {
      attemptId: this.connectAttemptId,
      socketId: this.socketId,
      msSinceAttempt: this.connectAttemptStartedAt
        ? Date.now() - this.connectAttemptStartedAt
        : undefined,
    });
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

    await this.streamProducerService.send(
      this.kafkaServiceQueueService.workerStatus(),
      payload,
      WORKER
    );

    this.startKeepAlive();
    console.log(
      '[worker_baileys:connection] onOpen concluído, keepAlive iniciado'
    );

    resolve(this.state());

    this.pendingResolve = undefined;
  }

  private async onClose(
    last: IBaileysUpdateEvent['lastDisconnect'],
    resolve: (s: IBaileysConnectionState) => void
  ): Promise<void> {
    console.log('[worker_baileys:connection] onClose', {
      hasLast: !!last,
      error: last?.error,
      attemptId: this.connectAttemptId,
      socketId: this.socketId,
      msSinceAttempt: this.connectAttemptStartedAt
        ? Date.now() - this.connectAttemptStartedAt
        : undefined,
    });
    this.stopKeepAlive();
    this.connectionEstablished = false;
    const statusCode = this.extractStatusCode(last?.error);
    const statusMessage = this.extractStatusMessage(last?.error);
    console.log('[worker_baileys:connection] onClose extraído', {
      statusCode,
      statusMessage,
    });

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

        await this.streamProducerService.send(
          this.kafkaServiceQueueService.workerStatus(),
          payload,
          WORKER
        );

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

      await this.streamProducerService.send(
        this.kafkaServiceQueueService.workerStatus(),
        payload,
        WORKER
      );
    }

    resolve(this.state());
    this.pendingResolve = undefined;

    if (this.retryCount < this.maxRetries) {
      console.log('[worker_baileys:connection] onClose agendando retry', {
        retryCount: this.retryCount,
        maxRetries: this.maxRetries,
        retryDelay: this.retryDelay,
      });
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
    } else {
      console.log('[worker_baileys:connection] onClose sem mais retries');
    }
  }

  private onNewLoginAttempt() {
    console.log('[worker_baileys:connection] onNewLoginAttempt');
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
    const result =
      this.initialConnection && !this.connected && !this.awaitingNewLogin;
    console.log('[worker_baileys:connection] canShowQr', {
      result,
      initialConnection: this.initialConnection,
      connected: this.connected,
      awaitingNewLogin: this.awaitingNewLogin,
      attemptId: this.connectAttemptId,
      socketId: this.socketId,
    });
    return result;
  }

  hasSession(): boolean {
    const result = fs.existsSync(FOLDER) && fs.readdirSync(FOLDER).length > 0;
    console.log('[worker_baileys:connection] hasSession', {
      result,
      folder: FOLDER,
    });
    return result;
  }

  private async restoreWithRetries(): Promise<IBaileysConnectionState> {
    console.log('[worker_baileys:connection] restoreWithRetries iniciado', {
      maxRetries: this.maxRetries,
    });
    for (let i = 0; i < this.maxRetries; i++) {
      console.log('[worker_baileys:connection] restoreWithRetries tentativa', {
        attempt: i + 1,
        maxRetries: this.maxRetries,
      });
      try {
        const s = await this.connect({
          initial_connection: this.initialConnection,
          allow_restore: false,
        });

        if (s.status === Status.connected) {
          console.log('[worker_baileys:connection] restoreWithRetries sucesso');
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
    console.log(
      '[worker_baileys:connection] restoreWithRetries esgotado, badSession'
    );
    this.setStatus(Status.disconnected, ECodeMessage.badSession);
    this.clearFolder();

    await this.updateWorkerMismatchedStatus();

    return this.connect({
      initial_connection: this.initialConnection,
      allow_restore: true,
    });
  }

  private publishSub(payload: IBaileysConnectionState, force = false): void {
    console.log('[worker_baileys:connection] publishSub', {
      force,
      initialConnection: this.initialConnection,
      status: payload.status,
    });
    if (!this.initialConnection && !force) {
      return;
    }

    const data = JSON.stringify(payload);
    if (data === this.lastPayload && !force) {
      return;
    }

    this.lastPayload = data;
    void this.centrifugo.publishSub(CHANNEL, payload).catch(() => {});
  }

  private async updateWorkerMismatchedStatus(): Promise<void> {
    console.log('[worker_baileys:connection] updateWorkerMismatchedStatus');
    const payload: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: Status.disconnected,
      worker_id: WORKER,
      account_id: ACCOUNT,
      worker_status_id: EWorkerStatus.mismatched,
    };

    this.publishSub(payload);

    await this.streamProducerService.send(
      this.kafkaServiceQueueService.workerStatus(),
      payload,
      WORKER
    );
  }

  private async safeLogout(forceLogout = false): Promise<void> {
    console.log('[worker_baileys:connection] safeLogout', {
      forceLogout,
      hasSocket: !!this.socket,
      hasUser: !!this.socket?.user,
    });
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
      console.log('[worker_baileys:connection] safeLogout resolveWebSocket', {
        hasWs: !!ws,
      });
      if (!ws) {
        this.socket = undefined;
        this.setStatus(Status.disconnected, ECodeMessage.loggedOut);

        return;
      }

      const readyState = ws.readyState;
      console.log('[worker_baileys:connection] safeLogout readyState', {
        readyState,
      });
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
    console.log('[worker_baileys:connection] safeLogout concluído');
  }

  private cancelAttempt(skipWebSocketClose = false) {
    console.log('[worker_baileys:connection] cancelAttempt', {
      skipWebSocketClose,
      attemptId: this.connectAttemptId,
      socketId: this.socketId,
      status: this.status,
      msSinceAttempt: this.connectAttemptStartedAt
        ? Date.now() - this.connectAttemptStartedAt
        : undefined,
      ts: Date.now(),
    });
    this.stopKeepAlive();

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
    console.log('[worker_baileys:connection] cancelAttempt concluído');
  }

  private reportConnected(): IBaileysConnectionState {
    console.log('[worker_baileys:connection] reportConnected', {
      initialConnection: this.initialConnection,
    });
    if (this.initialConnection) {
      this.lastPayload = null;

      this.publishSub({
        status: this.status,
        code: ECodeMessage.connectionEstablished,
        worker_id: WORKER,
        account_id: ACCOUNT,
        phone: getPhoneNumber(this.socket?.user?.id),
        worker_status_id: EWorkerStatus.online,
      });
    }

    return this.state();
  }

  private prepareFolder() {
    console.log('[worker_baileys:connection] prepareFolder', {
      folder: FOLDER,
      attemptId: this.connectAttemptId,
      socketId: this.socketId,
    });
    if (!fs.existsSync(FOLDER)) {
      fs.mkdirSync(FOLDER, {
        recursive: true,
      });
    }
  }

  private clearFolder() {
    console.log('[worker_baileys:connection] clearFolder', {
      folder: FOLDER,
      attemptId: this.connectAttemptId,
      socketId: this.socketId,
    });
    for (const f of fs.readdirSync(FOLDER)) {
      fs.rmSync(path.join(FOLDER, f), {
        recursive: true,
        force: true,
      });
    }
  }

  private setStatus(s: Status, c?: ECodeMessage) {
    console.log('[worker_baileys:connection] setStatus', {
      status: s,
      code: c,
      previousStatus: this.status,
      attemptId: this.connectAttemptId,
      socketId: this.socketId,
    });
    this.status = s;

    if (c) {
      this.code = c;
    }
  }

  private state(qr?: string): IBaileysConnectionState {
    return {
      status: this.status,
      worker_id: WORKER,
      account_id: ACCOUNT,
      qrcode: qr,
      code: this.code,
    };
  }

  private resolveWebSocket(): WebSocket | undefined {
    const reference = this.socket as unknown;
    if (!reference || typeof reference !== 'object') {
      console.log(
        '[worker_baileys:connection] resolveWebSocket sem reference',
        {
          attemptId: this.connectAttemptId,
          socketId: this.socketId,
        }
      );
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

    console.log(
      '[worker_baileys:connection] resolveWebSocket não encontrou ws',
      {
        attemptId: this.connectAttemptId,
        socketId: this.socketId,
      }
    );
    return undefined;
  }

  private isWebSocketOpen(ws: WebSocket | undefined): boolean {
    if (!ws) {
      return false;
    }

    const wsAny = ws as unknown;
    if (typeof wsAny !== 'object' || wsAny === null) {
      return false;
    }

    const hasReadyState = 'readyState' in wsAny;
    const hasPrivateReadyState = '_readyState' in wsAny;

    if (hasReadyState) {
      const state = (wsAny as { readyState: number }).readyState;
      return state === 1;
    }

    if (hasPrivateReadyState) {
      const state = (wsAny as { _readyState: number })._readyState;
      return state === 1;
    }

    return false;
  }

  private extractStatusCode(error: unknown): ECodeMessage | undefined {
    if (!error || typeof error !== 'object') {
      console.log(
        '[worker_baileys:connection] extractStatusCode sem error válido'
      );
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

    console.log(
      '[worker_baileys:connection] extractStatusCode sem code encontrado'
    );
    return undefined;
  }

  private extractStatusMessage(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') {
      console.log(
        '[worker_baileys:connection] extractStatusMessage sem error válido'
      );
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

  private startKeepAlive(): void {
    console.log('[worker_baileys:connection] startKeepAlive');
    this.stopKeepAlive();

    if (!this.socket) {
      console.log('[worker_baileys:connection] startKeepAlive sem socket');
      return;
    }

    if (!this.connected) {
      console.log('[worker_baileys:connection] startKeepAlive não conectado');
      return;
    }

    this.keepAliveInterval = setInterval(() => {
      void this.checkAndMaintainActivity();
    }, this.keepAliveIntervalMs);
  }

  private stopKeepAlive(): void {
    console.log('[worker_baileys:connection] stopKeepAlive', {
      hadInterval: !!this.keepAliveInterval,
    });
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = undefined;
    }

    this.isKeepAliveRunning = false;
  }

  private async checkAndMaintainActivity(): Promise<void> {
    if (this.isKeepAliveRunning) {
      console.log(
        '[worker_baileys:connection] checkAndMaintainActivity já em execução'
      );
      return;
    }

    if (!this.connected) {
      this.stopKeepAlive();
      return;
    }

    if (!this.socket) {
      this.stopKeepAlive();
      return;
    }

    if (!this.socket.user?.id) {
      return;
    }

    const ws = this.resolveWebSocket();

    if (!this.isWebSocketOpen(ws)) {
      console.log(
        '[worker_baileys:connection] checkAndMaintainActivity ws não aberto'
      );
      this.stopKeepAlive();
      return;
    }

    this.isKeepAliveRunning = true;

    try {
      await Promise.race([
        this.socket.sendPresenceUpdate('available'),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Keep-alive timeout')),
            this.keepAliveTimeoutMs
          )
        ),
      ]);

      console.log('Keep-alive sent');
    } catch (error) {
      console.error('Keep-alive error');
      console.dir(error, { depth: null, colors: true });

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      const isConnectionError = this.isConnectionRelatedError(errorMessage);
      console.log('[worker_baileys:connection] checkAndMaintainActivity erro', {
        errorMessage,
        isConnectionError,
      });

      if (!isConnectionError) {
        return;
      }

      this.saveLogWppConnection({
        worker_id: WORKER,
        status: this.status,
        code: ECodeMessage.connectionLost,
        message: `Keep-alive falhou: ${errorMessage}`,
        date: new Date(),
      });

      this.stopKeepAlive();
      this.connectionEstablished = false;

      this.reconnect({
        initial_connection: this.initialConnection,
      });
    } finally {
      this.isKeepAliveRunning = false;
    }
  }

  private isConnectionRelatedError(errorMessage: string): boolean {
    console.log('[worker_baileys:connection] isConnectionRelatedError', {
      errorMessage,
    });
    const connectionErrorPatterns = [
      'timeout',
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNREFUSED',
      'EPIPE',
      'socket hang up',
      'Connection',
      'connection closed',
      'WebSocket',
    ];

    const lowerMessage = errorMessage.toLowerCase();

    for (const pattern of connectionErrorPatterns) {
      if (lowerMessage.includes(pattern.toLowerCase())) {
        console.log(
          '[worker_baileys:connection] isConnectionRelatedError match',
          {
            pattern,
          }
        );
        return true;
      }
    }

    console.log('[worker_baileys:connection] isConnectionRelatedError false');
    return false;
  }

  private readonly saveLogWppConnection = async (
    wppLog: EWppConnection
  ): Promise<boolean> => {
    console.log('[worker_baileys:connection] saveLogWppConnection', {
      worker_id: wppLog.worker_id,
      status: wppLog.status,
    });
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

    const success =
      updateResult === 'updated' ||
      updateResult === 'created' ||
      updateResult === 'noop';
    console.log('[worker_baileys:connection] saveLogWppConnection resultado', {
      updateResult,
      success,
    });
    return success;
  };
}
