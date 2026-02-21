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
import { triggerConnectionEstablished } from '../callbacks';
import { WwebjsIncomingMessageService } from './incoming.service';
import { WwebjsHealthCheckService } from './healthCheck.service';
import { IChatTyping } from '@core/common/interfaces/IChatTyping';

const FOLDER = `/app/data/wwebjs/storage/${wwebjsEnvironment.wwebjsWorkerId}`;
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const CHANNEL = workerCentrifugoQueue(wwebjsEnvironment.wwebjsAccountId);
const CHAT_CHANNEL = chatAccountCentrifugo(wwebjsEnvironment.wwebjsAccountId);
const WORKER = wwebjsEnvironment.wwebjsWorkerId;
const ACCOUNT = wwebjsEnvironment.wwebjsAccountId;
const RETRY_DELAY = 2000;
const MAX_RETRIES = 5;
const SHOULD_PRINT_QR_IN_TERMINAL =
  process.env.APP_ENVIRONMENT === EAppEnvironment.local;
const CHROMIUM_LOCK_FILE_NAMES = [
  'SingletonLock',
  'SingletonSocket',
  'SingletonCookie',
] as const;
const CHROMIUM_PROFILE_SUBDIRECTORIES = ['', 'Default'] as const;

function readProxyConfig(): {
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

  const username = process.env.PROXY_USERNAME?.trim();
  const password = process.env.PROXY_PASSWORD?.trim();

  return {
    host,
    port,
    username: username || undefined,
    password: password || undefined,
  };
}

const { Client: ClientCtor, LocalAuth } = whatsappWeb;
type Client = InstanceType<typeof ClientCtor>;

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
  private initializeRetryCount = 0;
  private currentPromise: Promise<IBaileysConnectionState> | undefined;
  private pendingResolve: ((s: IBaileysConnectionState) => void) | undefined;
  private lastPayload: string | null = null;
  private qrHash: string | undefined;
  private typeConnection: EBaileysConnectionType =
    EBaileysConnectionType.qrcode;

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
      force_new: forceNew = false,
      requested_by_user: requestedByUser = false,
      from_disconnect_restart: fromDisconnectRestart = false,
    } = input;

    if (requestedByUser) {
      this.userRequestedDisconnect = false;
    }

    if (requestedByUser || forceNew || !fromDisconnectRestart) {
      this.initializeRetryCount = 0;
    }

    if (this.userRequestedDisconnect && !fromDisconnectRestart) {
      return this.state();
    }

    this.initialConnection = initialConnection;
    this.typeConnection = typeConnection;

    if (forceNew) {
      this.cancelAttempt(false);
    }

    if (this.connected) {
      return this.reportConnected();
    }

    if (this.connecting && this.currentPromise) {
      return this.currentPromise;
    }

    if (
      (this.status === Status.initial || this.status === Status.disconnected) &&
      allowRestore &&
      this.hasSession()
    ) {
      return this.startConnection();
    }

    return this.startConnection();
  }

  async disconnect(input: IBaileysConnection): Promise<void> {
    const {
      initial_connection: initialConnection = false,
      disconnected_user: disconnectedUser = false,
      preserve_session: preserveSession = false,
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

    await this.safeDestroy();
    this.cancelAttempt(false);
    if (!preserveSession) {
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

  async shutdown(): Promise<void> {
    this.pendingResolve?.(this.state());
    this.pendingResolve = undefined;
    this.currentPromise = undefined;
    this.connecting = false;
    this.connectionEstablished = false;
    this.healthCheckService.stop();
    this.incomingMessageService.unbind();

    if (this.client) {
      try {
        await this.client.destroy();
      } catch {}
      this.client = undefined;
    }

    this.clearChromiumProfileLock();
  }

  private startConnection(): Promise<IBaileysConnectionState> {
    this.prepareFolder();
    this.connecting = true;
    this.retryCount = 0;
    this.currentPromise = this.createAndWaitClient().finally(() => {
      this.connecting = false;
      this.currentPromise = undefined;
    });

    return this.currentPromise;
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
          // Chromium can leave broken symlinks here after abrupt restarts.
          fs.rmSync(path.join(targetDir, name), {
            force: true,
            recursive: true,
          });
        } catch {}
      }
    }
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
    if (this.initializeRetryCount >= MAX_RETRIES) {
      return;
    }

    this.initializeRetryCount += 1;

    setTimeout(() => {
      this.connect({
        initial_connection: this.initialConnection,
        force_new: true,
        allow_restore: true,
        type: this.typeConnection,
        requested_by_user: false,
        from_disconnect_restart: true,
      }).catch(() => {});
    }, RETRY_DELAY);
  }

  private isTransientInitializeError(message: string): boolean {
    const normalizedMessage = message.toLowerCase();

    return (
      normalizedMessage.includes('execution context was destroyed') ||
      normalizedMessage.includes('most likely because of a navigation') ||
      normalizedMessage.includes('cannot find context with specified id') ||
      normalizedMessage.includes('target closed')
    );
  }

  private reconnectAfterTransientInitializeError(): void {
    if (this.initializeRetryCount >= MAX_RETRIES) {
      return;
    }

    this.initializeRetryCount += 1;

    setTimeout(() => {
      this.connect({
        initial_connection: this.initialConnection,
        force_new: false,
        allow_restore: true,
        type: this.typeConnection,
        requested_by_user: false,
        from_disconnect_restart: true,
      }).catch(() => {});
    }, RETRY_DELAY);
  }

  private handleInitializeError(message: string): void {
    console.error('[Wwebjs] client.initialize() failed:', message);
    this.setStatus(Status.disconnected, ECodeMessage.connectionLost);
    this.pendingResolve?.(this.state());
    this.pendingResolve = undefined;

    if (this.client) {
      this.client.destroy().catch(() => {});
      this.client = undefined;
    }

    if (this.isChromiumProfileLockedError(message)) {
      this.clearChromiumProfileLock();
      this.reconnectAfterProfileUnlock();
    } else if (this.isTransientInitializeError(message)) {
      this.reconnectAfterTransientInitializeError();
    }

    this.saveLogWppConnection({
      worker_id: WORKER,
      status: Status.disconnected,
      code: ECodeMessage.connectionLost,
      message,
      date: new Date(),
    });
  }

  private createAndWaitClient(): Promise<IBaileysConnectionState> {
    return new Promise<IBaileysConnectionState>((resolve) => {
      this.pendingResolve = resolve;

      this.clearChromiumProfileLock();

      const authPath = path.join(FOLDER, `.wwebjs_auth`);
      const proxy = readProxyConfig();
      const puppeteerOpts: {
        headless: boolean;
        args: string[];
        executablePath?: string;
      } = {
        headless: true,
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
          `--proxy-server=http://${proxy.host}:${proxy.port}`
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
        emitHistoricalEvents: false,
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

      const client = new ClientCtor(clientOptions);

      this.client = client;

      client.on('qr', async (qr: string) => {
        if (this.typeConnection !== EBaileysConnectionType.qrcode) {
          return;
        }

        const hash = qr.slice(-20);
        if (hash === this.qrHash) {
          return;
        }

        this.qrHash = hash;
        this.setStatus(Status.connecting, ECodeMessage.awaitingReadQrCode);

        await this.printQrInConsole(qr);
        const img = await QRCode.toDataURL(qr);

        const payload: IBaileysConnectionState = {
          status: this.status,
          code: this.code,
          qrcode: img,
          worker_id: WORKER,
          account_id: ACCOUNT,
          worker_status_id: EWorkerStatus.disponible,
        };

        this.publishSub(payload);

        if (!this.initialConnection) {
          this.saveLogWppConnection({
            worker_id: WORKER,
            status: this.status,
            code: this.code?.toString(),
            message: 'QR Code received',
            date: new Date(),
          });
        }

        this.pendingResolve?.(this.state(img));
        this.pendingResolve = undefined;
      });

      client.on('ready', () => {
        this.qrHash = undefined;
        this.retryCount = 0;
        this.initializeRetryCount = 0;
        this.setStatus(Status.connected, ECodeMessage.connectionEstablished);
        this.connectionEstablished = true;
        this.incomingMessageService.bindTo(client);

        const phone = getPhoneNumber(this.client?.info?.wid?._serialized);

        const payload: IBaileysConnectionState = {
          status: this.status,
          worker_id: WORKER,
          account_id: ACCOUNT,
          code: this.code,
          phone,
          worker_status_id: EWorkerStatus.online,
        };

        this.publishSub(payload);
        this.healthCheckService.start(HEALTH_CHECK_INTERVAL_MS);
        triggerConnectionEstablished();
        this.pendingResolve?.(this.state());
        this.pendingResolve = undefined;
      });

      client.on('disconnected', (reason: string) => {
        this.connectionEstablished = false;
        const statusCode = this.mapDisconnectReason(reason);

        void this.healthCheckService.notifyDisconnected(reason);
        this.healthCheckService.stop();
        this.setStatus(Status.disconnected, statusCode);

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

        this.balanceWorkerStatusGrpcClientService
          .notifyWorkerStatus(payload)
          .catch(() => {});

        if (isMismatchedStatus) {
          this.updateWorkerMismatchedStatus();
        }

        if (statusCode === ECodeMessage.loggedOut) {
          if (!this.initialConnection) {
            this.clearFolder();
          }

          const logoutPayload: IBaileysConnectionState = {
            status: this.status,
            worker_id: WORKER,
            code: statusCode,
            disconnected_user: true,
            account_id: ACCOUNT,
            worker_status_id: EWorkerStatus.mismatched,
          };

          this.publishSub(logoutPayload, true);
          this.balanceWorkerStatusGrpcClientService
            .notifyWorkerStatus(logoutPayload)
            .catch(() => {});
        }

        this.pendingResolve?.(this.state());
        this.pendingResolve = undefined;

        this.incomingMessageService.unbind();
        this.client = undefined;

        if (this.retryCount < MAX_RETRIES) {
          this.retryCount++;
          const retryPayload: IBaileysConnectionState = {
            status: Status.connecting,
            worker_id: WORKER,
            account_id: ACCOUNT,
            code: ECodeMessage.awaitConnection,
            attempt: this.retryCount,
            max_attempts: MAX_RETRIES,
            seconds_until_next_attempt: Math.ceil(RETRY_DELAY / 1000),
          };
          this.publishSub(retryPayload, true);

          setTimeout(() => {
            this.connect({
              initial_connection: this.initialConnection,
            }).catch(() => {});
          }, RETRY_DELAY);
        }
      });

      client.on('auth_failure', () => {
        this.setStatus(Status.disconnected, ECodeMessage.badSession);
        this.pendingResolve?.(this.state());
        this.pendingResolve = undefined;
      });

      client.on('chat_state', (state) => {
        this.handleChatState(state);
      });

      client.initialize().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.handleInitializeError(msg);
      });
    });
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
    this.pendingResolve?.(this.state());
    this.pendingResolve = undefined;
    this.currentPromise = undefined;
    this.connecting = false;
    this.connectionEstablished = false;
    this.incomingMessageService.unbind();

    if (!skipDestroy && this.client) {
      this.client.destroy().catch(() => {});
      this.client = undefined;
    }
  }

  private async safeDestroy(): Promise<void> {
    if (!this.client) {
      return;
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
    this.setStatus(Status.disconnected, ECodeMessage.loggedOut);
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
    }

    return this.state();
  }

  private setStatus(s: Status, c?: ECodeMessage): void {
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
      result.max_attempts = MAX_RETRIES;
    }
    return result;
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
      console.error('[WwebjsConnection] Publish failed', error);
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
      { upsert: true, maxRetries: 5 }
    );

    return (
      updateResult === 'updated' ||
      updateResult === 'created' ||
      updateResult === 'noop'
    );
  };
}
