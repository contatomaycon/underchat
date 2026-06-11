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
import { EWorkerType } from '@core/common/enums/EWorkerType';
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

const HEALTH_CHECK_INTERVAL_MS = 30_000;
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
const QR_DATA_URL_GENERATION_TIMEOUT_MS = 1_500;
const CONNECTION_ATTEMPT_GUARD_TIMEOUT_GRACE_MS = 5_000;
const DEFAULT_CLIENT_DESTROY_TIMEOUT_MS = 15_000;
const DEFAULT_PENDING_TEARDOWN_TIMEOUT_MS = 20_000;
const QR_SVG_MARGIN_MODULES = 4;
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

function readBoundedIntEnv(
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseInt(process.env[key] ?? '', 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

const WWEBJS_CLIENT_DESTROY_TIMEOUT_MS = readBoundedIntEnv(
  'WWEBJS_CLIENT_DESTROY_TIMEOUT_MS',
  DEFAULT_CLIENT_DESTROY_TIMEOUT_MS,
  1_000,
  60_000
);
const WWEBJS_PENDING_TEARDOWN_TIMEOUT_MS = readBoundedIntEnv(
  'WWEBJS_PENDING_TEARDOWN_TIMEOUT_MS',
  DEFAULT_PENDING_TEARDOWN_TIMEOUT_MS,
  1_000,
  120_000
);
const CONNECTION_QR_FIRST_QR_TIMEOUT_MS = readBoundedIntEnv(
  'CONNECTION_QR_FIRST_QR_TIMEOUT_MS',
  25_000,
  1_000,
  300_000
);

function getFolder(): string {
  return `/app/data/wwebjs/storage/${wwebjsEnvironment.wwebjsWorkerId}`;
}

function getChannel(): string {
  return workerCentrifugoQueue(wwebjsEnvironment.wwebjsAccountId);
}

function getChatChannel(): string {
  return chatAccountCentrifugo(wwebjsEnvironment.wwebjsAccountId);
}

function getWorker(): string {
  return wwebjsEnvironment.wwebjsWorkerId;
}

function getAccount(): string {
  return wwebjsEnvironment.wwebjsAccountId;
}

function escapeSvgAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderQrSvgDataUrl(qr: string): string {
  const qrModel = QRCode.create(qr, { errorCorrectionLevel: 'M' });
  const size = qrModel.modules.size;
  const dimension = size + QR_SVG_MARGIN_MODULES * 2;
  const paths: string[] = [];

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (!qrModel.modules.get(row, col)) {
        continue;
      }

      const x = col + QR_SVG_MARGIN_MODULES;
      const y = row + QR_SVG_MARGIN_MODULES;
      paths.push(`M${x} ${y}h1v1H${x}z`);
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dimension} ${dimension}" shape-rendering="crispEdges" role="img" aria-label="${escapeSvgAttribute('WhatsApp QR Code')}">` +
    `<path fill="#fff" d="M0 0h${dimension}v${dimension}H0z"/>` +
    `<path fill="#000" d="${paths.join('')}"/></svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

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

function getWwebjsUserAgent(): string | false {
  const configured = process.env.WWEBJS_USER_AGENT?.trim();
  if (configured) {
    return configured;
  }

  return false;
}

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
type WwebjsClientOptions = Omit<
  NonNullable<ConstructorParameters<typeof ClientCtor>[0]>,
  'userAgent'
> & {
  userAgent?: string | false;
};
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
  private connectionAttemptStartedAtMs = 0;

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
      void this.centrifugo.publishSub(getChannel(), payload).catch((error) => {
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

    if (typeConnection === EBaileysConnectionType.phone) {
      throw new Error('Phone connection is disabled. Use QR Code.');
    }

    if (requestedByUser) {
      this.userRequestedDisconnect = false;
    }

    if (this.userRequestedDisconnect && !fromDisconnectRestart) {
      return this.state();
    }

    this.initialConnection = initialConnection;
    this.typeConnection = typeConnection;
    this.phoneConnection = effectivePhoneConnection;
    this.connectionAttemptId = connectionAttemptId;
    this.trackQrReadSession(requestedByUser, typeConnection);

    if (this.connected) {
      return this.reportConnected();
    }

    const forcedRestartActiveConnection =
      forceNew && this.connecting && (requestedByUser || fromDisconnectRestart);

    if (forcedRestartActiveConnection) {
      this.cancelAttempt(false);
    }

    if (this.connecting && this.currentPromise) {
      return this.currentPromise;
    }

    if (forceNew && this.connecting && !forcedRestartActiveConnection) {
      return this.currentPromise ?? this.state();
    }

    if (forceNew && !this.connecting && !forcedRestartActiveConnection) {
      this.cancelAttempt(false);
    }

    const shouldBypassRestoreForQrRequest =
      typeConnection === EBaileysConnectionType.qrcode && requestedByUser;

    if (
      (this.status === Status.initial || this.status === Status.disconnected) &&
      allowRestore &&
      !shouldBypassRestoreForQrRequest &&
      this.hasSession()
    ) {
      return this.startConnection(fromDisconnectRestart);
    }

    if (
      (this.status === Status.initial || this.status === Status.disconnected) &&
      allowRestore &&
      shouldBypassRestoreForQrRequest &&
      this.hasSession()
    ) {
    }

    if (
      this.typeConnection === EBaileysConnectionType.qrcode &&
      !requestedByUser &&
      (this.qrReadSessionLocked ||
        (!this.qrReadSessionActive && !this.hasSession()))
    ) {
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
      worker_id: getWorker(),
      status: this.status,
      code: this.code?.toString(),
      message: 'WwebjsConnectionService disconnected',
      date: new Date(),
    });

    this.setStatus(Status.disconnected, ECodeMessage.connectionClosed);

    const payload: IBaileysConnectionState = {
      status: this.status,
      worker_id: getWorker(),
      account_id: getAccount(),
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
        worker_id: getWorker(),
        status: this.status ?? Status.disconnected,
        code: this.code ?? ECodeMessage.connectionLost,
        message: 'Reconnect failed',
        date: new Date(),
      });
    });
  }

  async shutdown(): Promise<void> {
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
      await this.destroyClientWithTimeout(this.client, 'shutdown');
      this.client = undefined;
    }

    this.clearChromiumProfileLock();
  }

  cancelConnectionAttempt(): void {
    this.cancelAttempt(false);
  }

  private startConnection(
    fromDisconnectRestart = false
  ): Promise<IBaileysConnectionState> {
    const attemptId = ++this.connectionAttemptSequence;

    this.prepareFolder();
    this.clearDisconnectRetryTimer();
    this.clearConnectionStateProbe();
    this.connecting = true;
    this.connectionAttemptStartedAtMs = Date.now();
    this.setStatus(Status.connecting, ECodeMessage.awaitConnection);
    this.publishConnectionStarting();
    this.activeConnectionAttemptId = attemptId;
    if (!fromDisconnectRestart) {
      this.retryCount = 0;
    }
    this.currentPromise = this.waitForPendingTeardown()
      .then(() =>
        this.withConnectionAttemptGuardTimeout(
          this.createAndWaitClient(attemptId),
          attemptId
        )
      )
      .finally(() => {
        this.connecting = false;
        this.currentPromise = undefined;
        if (this.activeConnectionAttemptId === attemptId) {
          this.activeConnectionAttemptId = undefined;
        }
      });

    return this.currentPromise;
  }

  private withConnectionAttemptGuardTimeout(
    promise: Promise<IBaileysConnectionState>,
    attemptId: number
  ): Promise<IBaileysConnectionState> {
    const deadlineMs =
      CONNECTION_QR_FIRST_QR_TIMEOUT_MS +
      CONNECTION_ATTEMPT_GUARD_TIMEOUT_GRACE_MS;
    const startedAtMs = this.connectionAttemptStartedAtMs || Date.now();
    let guardTimeout: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    return new Promise<IBaileysConnectionState>((resolve, reject) => {
      const settle = (state: IBaileysConnectionState): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (guardTimeout) {
          clearTimeout(guardTimeout);
        }
        resolve(state);
      };

      guardTimeout = setTimeout(() => {
        if (settled) {
          return;
        }

        if (
          this.activeConnectionAttemptId !== attemptId ||
          this.connectionEstablished ||
          this.status !== Status.connecting
        ) {
          settle(this.state());
          return;
        }

        const payload = this.resolveQrAttemptTimeout(
          startedAtMs,
          'connection_attempt_guard_timeout'
        );
        settle(payload);
      }, deadlineMs);

      promise.then(settle).catch((error) => {
        if (settled) {
          return;
        }
        if (guardTimeout) {
          clearTimeout(guardTimeout);
        }
        reject(error);
      });
    });
  }

  private async waitForPendingTeardown(): Promise<void> {
    try {
      await this.runWithTimeout(
        'pending_teardown_wait',
        this.teardownPromise.catch(() => undefined),
        WWEBJS_PENDING_TEARDOWN_TIMEOUT_MS
      );
    } catch {
      this.teardownPromise = Promise.resolve();
      this.clearChromiumProfileLock();
    }
  }

  private queueTeardown(
    operation: string,
    teardown: () => Promise<void>
  ): void {
    this.teardownPromise = this.teardownPromise
      .catch(() => undefined)
      .then(async () => {
        try {
          await this.runWithTimeout(
            `connection_teardown:${operation}`,
            teardown(),
            WWEBJS_CLIENT_DESTROY_TIMEOUT_MS
          );
        } catch {}
      });
  }

  private runWithTimeout<T>(
    operation: string,
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      promise.then(
        (value) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          resolve(value);
        },
        (error) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          reject(error);
        }
      );
    });
  }

  private async destroyClientWithTimeout(
    client: Client,
    operation: string
  ): Promise<void> {
    try {
      await this.runWithTimeout(
        `client_destroy:${operation}`,
        client.destroy(),
        WWEBJS_CLIENT_DESTROY_TIMEOUT_MS
      );
    } catch {}
  }

  private prepareFolder(): void {
    if (!fs.existsSync(getFolder())) {
      fs.mkdirSync(getFolder(), { recursive: true });
    }
  }

  private clearFolder(): void {
    if (!fs.existsSync(getFolder())) {
      return;
    }

    for (const f of fs.readdirSync(getFolder())) {
      try {
        fs.rmSync(path.join(getFolder(), f), { recursive: true, force: true });
      } catch {}
    }
  }

  private getSessionPath(): string {
    return path.join(getFolder(), '.wwebjs_auth', `session-${getWorker()}`);
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
      worker_id: getWorker(),
      account_id: getAccount(),
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
        worker_id: getWorker(),
        account_id: getAccount(),
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
        worker_id: getWorker(),
        account_id: getAccount(),
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
    this.publishReconnectAttempt(nextAttempt, delayMs);

    this.clearDisconnectRetryTimer();
    this.disconnectRetryTimer = setTimeout(() => {
      this.disconnectRetryTimer = undefined;
      this.connect({
        initial_connection: this.initialConnection,
        force_new: forceNew,
        allow_restore: true,
        type: this.typeConnection,
        phone_connection: this.phoneConnection,
        requested_by_user: false,
        from_disconnect_restart: true,
      }).catch(() => {
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
    client: Client
  ): Promise<void> {
    if (!this.isActiveClient(client)) {
      console.warn('[Wwebjs] Ignoring initialize error from stale client:', {
        message,
      });
      return;
    }

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
      worker_id: getWorker(),
      status: Status.disconnected,
      code: ECodeMessage.connectionLost,
      message,
      date: new Date(),
    });
  }

  private resolveQrAttemptTimeout(
    startedAtMs: number,
    reason: 'qr_event_timeout' | 'connection_attempt_guard_timeout'
  ): IBaileysConnectionState {
    const elapsedMs = Date.now() - startedAtMs;
    this.setStatus(Status.connecting, ECodeMessage.awaitingReadQrCode);
    this.clearConnectionStateProbe();

    const payload = this.state(undefined, undefined, {
      qr_pending: true,
      reason,
      time_to_first_qr_ms: elapsedMs,
      worker_status_id: EWorkerStatus.disponible,
    });
    this.publishSub(payload, true);
    void this.notifyWorkerStatusSafely(payload, reason);
    this.pendingResolve?.(payload);
    this.pendingResolve = undefined;
    this.queueTeardown(reason, async () => {
      if (!this.client) {
        return;
      }

      try {
        await this.client.destroy();
      } catch {}

      this.client = undefined;
      this.clearChromiumProfileLock();
    });
    this.incomingMessageService.unbind();

    return payload;
  }

  private createAndWaitClient(
    attemptId: number
  ): Promise<IBaileysConnectionState> {
    return new Promise<IBaileysConnectionState>((resolve) => {
      const startedAtMs = this.connectionAttemptStartedAtMs || Date.now();
      const firstQrTimeoutMs = CONNECTION_QR_FIRST_QR_TIMEOUT_MS;
      let settled = false;
      let firstQrTimeout: ReturnType<typeof setTimeout> | undefined;
      const settle = (state: IBaileysConnectionState): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (firstQrTimeout) {
          clearTimeout(firstQrTimeout);
        }
        resolve(state);
        this.pendingResolve = undefined;
      };
      this.pendingResolve = settle;

      firstQrTimeout = setTimeout(() => {
        if (
          settled ||
          this.activeConnectionAttemptId !== attemptId ||
          this.connectionEstablished ||
          this.status !== Status.connecting
        ) {
          return;
        }

        const payload = this.resolveQrAttemptTimeout(
          startedAtMs,
          'qr_event_timeout'
        );
        settle(payload);
      }, firstQrTimeoutMs);

      this.clearChromiumProfileLock();

      const authPath = path.join(getFolder(), `.wwebjs_auth`);
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

      const userAgent = getWwebjsUserAgent();
      const clientOptions: WwebjsClientOptions = {
        authStrategy: new LocalAuth({
          clientId: getWorker(),
          dataPath: authPath,
        }),
        puppeteer: puppeteerOpts,
        userAgent,
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

      const client = new ClientCtor(
        clientOptions as ConstructorParameters<typeof ClientCtor>[0]
      );

      this.client = client;
      this.incomingMessageService.bindTo(client);
      this.startConnectionStateProbe(client, attemptId, proxy);

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
          worker_id: getWorker(),
          account_id: getAccount(),
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
        const timeToFirstQrMs =
          this.connectionAttemptStartedAtMs > 0
            ? Date.now() - this.connectionAttemptStartedAtMs
            : undefined;

        await this.printQrInConsole(qr);
        let img: string;
        try {
          img = await this.withTimeout(
            QRCode.toDataURL(qr),
            QR_DATA_URL_GENERATION_TIMEOUT_MS,
            `QR data URL generation timeout after ${QR_DATA_URL_GENERATION_TIMEOUT_MS}ms`
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          try {
            img = renderQrSvgDataUrl(qr);
          } catch {
            const payload = this.state(undefined, undefined, {
              qr_pending: true,
              reason: 'qr_dataurl_generation_failed',
              error: errorMessage,
              time_to_first_qr_ms: timeToFirstQrMs,
              worker_status_id: EWorkerStatus.disponible,
            });
            this.publishSub(payload, true);
            void this.notifyWorkerStatusSafely(
              payload,
              'qr_dataurl_generation_failed'
            );
            this.pendingResolve?.(payload);
            this.pendingResolve = undefined;
            return;
          }
        }
        if (!this.isActiveClient(client)) {
          return;
        }

        const payload: IBaileysConnectionState = {
          status: this.status,
          code: this.code,
          qrcode: img,
          worker_id: getWorker(),
          account_id: getAccount(),
          attempt: this.qrGenerationCount,
          max_attempts: MAX_QR_GENERATIONS,
          worker_status_id: EWorkerStatus.disponible,
          connection_attempt_id: this.connectionAttemptId,
          qr_generated_at: qrGeneratedAt,
          time_to_first_qr_ms: timeToFirstQrMs,
        };

        this.publishSub(payload, true);
        void this.notifyWorkerStatusSafely(payload, 'qr');

        if (!this.initialConnection) {
          this.saveLogWppConnection({
            worker_id: getWorker(),
            status: this.status,
            code: this.code?.toString(),
            message: 'QR Code received',
            date: new Date(),
          });
        }

        const state = this.state(img, qrGeneratedAt, {
          time_to_first_qr_ms: timeToFirstQrMs,
        });
        this.pendingResolve?.(state);
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
          worker_id: getWorker(),
          account_id: getAccount(),
          is_new_login: true,
          worker_status_id: EWorkerStatus.disponible,
        };

        this.publishSub(payload, true);
        void this.notifyWorkerStatusSafely(payload, 'pairing_in_progress');
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
          worker_id: getWorker(),
          account_id: getAccount(),
          code: statusCode,
          worker_status_id: workerStatusId,
        };

        this.publishSub(payload, true);

        this.saveLogWppConnection({
          worker_id: getWorker(),
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
            worker_id: getWorker(),
            code: statusCode,
            disconnected_user: true,
            account_id: getAccount(),
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
        const payload: IBaileysConnectionState = {
          status: this.status,
          worker_id: getWorker(),
          account_id: getAccount(),
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
        void this.handleInitializeError(msg, client);
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

  private async ensureClientEventBridgeReady(client: Client): Promise<boolean> {
    const clientWithInternals = client as WwebjsClientInternals;
    if (!this.getClientIdentityJid(client)) {
      return false;
    }

    try {
      const hasStore = await this.hasWwebjsStoreInjected(client);
      if (!hasStore) {
        return false;
      }
    } catch {
      return false;
    }

    if (typeof clientWithInternals.attachEventListeners !== 'function') {
      return false;
    }

    try {
      await this.withTimeout(
        clientWithInternals.attachEventListeners.call(client),
        CONNECTION_EVENT_BRIDGE_ATTACH_TIMEOUT_MS,
        'Event bridge attach timeout'
      );
      return true;
    } catch {
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
      } catch {}

      if (
        !this.isActiveClient(client) ||
        this.status !== Status.connecting ||
        this.connectionEstablished
      ) {
        this.clearConnectionStateProbe();
        return;
      }

      const elapsedMs = Date.now() - startedAt;
      if (
        waState === 'CONNECTED' &&
        this.getClientIdentityJid(client) &&
        elapsedMs >= CONNECTION_STATE_READY_GRACE_MS &&
        (await this.ensureClientEventBridgeReady(client))
      ) {
        if (
          this.isActiveClient(client) &&
          this.status === Status.connecting &&
          !this.connectionEstablished
        ) {
          this.markConnected(client, attemptId, proxy, 'state_probe');
        }
        return;
      }

      if (elapsedMs >= CONNECTION_STATE_RECONCILE_TIMEOUT_MS) {
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
      worker_id: getWorker(),
      account_id: getAccount(),
      code: this.code,
      phone,
      worker_status_id: EWorkerStatus.online,
    };

    this.publishSub(payload, true);
    void this.notifyWorkerStatusSafely(payload, source);
    void this.logConnectionIpInLocal(client, proxy);
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
      account_id: getAccount(),
      worker_id: getWorker(),
    };

    void this.centrifugo
      .publishSub(getChatChannel(), typingEvent)
      .catch(() => {});
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
      worker_id: getWorker(),
      account_id: getAccount(),
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
          worker_id: getWorker(),
          status: Status.disconnected,
          code: ECodeMessage.connectionLost,
          message: 'Error during logout',
          date: new Date(),
        });
      }
    }

    try {
      await this.destroyClientWithTimeout(this.client, 'safe_destroy');
    } catch {
      this.saveLogWppConnection({
        worker_id: getWorker(),
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
        worker_id: getWorker(),
        account_id: getAccount(),
        phone: getPhoneNumber(this.client?.info?.wid?._serialized),
        worker_status_id: EWorkerStatus.online,
      };

      this.publishSub(payload);
      void this.notifyWorkerStatusSafely(payload, 'report_connected');
    }

    return this.state();
  }

  private setStatus(s: Status, c?: ECodeMessage): void {
    this.status = s;
    if (c) {
      this.code = c;
    }
  }

  private state(
    qr?: string,
    qrGeneratedAt?: string,
    extras: Partial<IBaileysConnectionState> = {}
  ): IBaileysConnectionState {
    const result: IBaileysConnectionState = {
      status: this.status,
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.wwebjs,
      qrcode: qr,
      code: this.code,
      connection_attempt_id: this.connectionAttemptId,
      ...extras,
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

  private withConnectionMetadata(
    payload: IBaileysConnectionState
  ): IBaileysConnectionState {
    const connectionAttemptId =
      payload.connection_attempt_id ?? this.connectionAttemptId;
    if (
      payload.connection_attempt_id === connectionAttemptId &&
      payload.worker_type_id === EWorkerType.wwebjs
    ) {
      return payload;
    }

    return {
      ...payload,
      worker_type_id: EWorkerType.wwebjs,
      connection_attempt_id: connectionAttemptId,
    };
  }

  private publishSub(payload: IBaileysConnectionState, force = false): void {
    const payloadWithConnectionMetadata = this.withConnectionMetadata(payload);
    if (!this.initialConnection && !force) {
      return;
    }

    const data = JSON.stringify(payloadWithConnectionMetadata);
    if (data === this.lastPayload && !force) {
      return;
    }

    this.lastPayload = data;
    const hasConnectionCredential = Boolean(
      payloadWithConnectionMetadata.qrcode ||
      payloadWithConnectionMetadata.pairing_code
    );
    const publishPromise = hasConnectionCredential
      ? this.centrifugo.publishSubImmediate(
          getChannel(),
          payloadWithConnectionMetadata
        )
      : this.centrifugo.publishSub(getChannel(), payloadWithConnectionMetadata);

    void publishPromise.catch((error) => {
      console.error('[WwebjsConnection] Publish failed', error);
    });
  }

  private async notifyWorkerStatusSafely(
    payload: IBaileysConnectionState,
    context: string
  ): Promise<void> {
    const payloadWithConnectionMetadata = this.withConnectionMetadata(payload);
    try {
      await this.balanceWorkerStatusGrpcClientService.notifyWorkerStatus(
        payloadWithConnectionMetadata
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
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
      worker_id: getWorker(),
      account_id: getAccount(),
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

    const documentId = buildWppConnectionDocumentId(
      getAccount(),
      wppLog.worker_id
    );

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
