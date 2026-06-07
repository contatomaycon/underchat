import {
  Browsers,
  DEFAULT_CONNECTION_CONFIG,
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
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { BalanceWorkerStatusGrpcClientService } from '@core/services/balanceWorkerStatusGrpcClient.service';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { BaileysIncomingMessageService } from './incoming.service';
import { BaileysHealthCheckService } from './healthCheck.service';
import { getPhoneNumber } from '@core/common/functions/getPhoneNumber';
import { buildWppConnectionDocumentId } from '@core/common/functions/buildWppConnectionDocumentId';
import { EProxyProtocol } from '@core/common/enums/EProxyProtocol';
import { logger } from '@core/plugins/telemetry/logger';
import { recordConnectionLifecycle } from '@core/plugins/telemetry/connectionLifecycleDebug';
import {
  getConnectionQrFirstQrTimeoutMs,
  recordConnectionAttemptTelemetry,
} from '@core/plugins/telemetry/connectionAttemptTelemetry';

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

const HEALTH_CHECK_INTERVAL_MS = 30_000;
const WA_VERSION_TTL_MS = 6 * 60 * 60 * 1000;
const AUTH_STATE_TIMEOUT_MS = readBoundedIntEnv(
  'BAILEYS_AUTH_STATE_TIMEOUT_MS',
  15_000,
  5_000,
  60_000
);
const WA_VERSION_TIMEOUT_MS = readBoundedIntEnv(
  'BAILEYS_WA_VERSION_TIMEOUT_MS',
  15_000,
  5_000,
  60_000
);
const WA_VERSION_FETCH_TIMEOUT_MS = readBoundedIntEnv(
  'BAILEYS_WA_VERSION_FETCH_TIMEOUT_MS',
  2_500,
  500,
  15_000
);
const WA_VERSION_FALLBACK_TTL_MS = readBoundedIntEnv(
  'BAILEYS_WA_VERSION_FALLBACK_TTL_MS',
  15 * 60 * 1000,
  60_000,
  60 * 60 * 1000
);
const SOCKET_CREATE_TIMEOUT_MS = readBoundedIntEnv(
  'BAILEYS_SOCKET_CREATE_TIMEOUT_MS',
  15_000,
  5_000,
  60_000
);
const QR_DATA_URL_GENERATION_TIMEOUT_MS = readBoundedIntEnv(
  'CONNECTION_QR_DATAURL_TIMEOUT_MS',
  1_500,
  250,
  10_000
);
const QR_SVG_MARGIN_MODULES = 4;
const SHOULD_PRINT_QR_IN_TERMINAL =
  process.env.APP_ENVIRONMENT === EAppEnvironment.local;
const SHOULD_LOG_CONNECTION_IP =
  process.env.APP_ENVIRONMENT === EAppEnvironment.local;
type WaVersion = [number, number, number];

const DEFAULT_WA_VERSION = [
  DEFAULT_CONNECTION_CONFIG.version[0],
  DEFAULT_CONNECTION_CONFIG.version[1],
  DEFAULT_CONNECTION_CONFIG.version[2],
] as WaVersion;

let cachedWaVersion: {
  version: WaVersion;
  fetchedAt: number;
  ttlMs: number;
  source: string;
} | null = null;

function cloneWaVersion(version: readonly number[]): WaVersion {
  return [version[0] ?? 2, version[1] ?? 3000, version[2] ?? 0];
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }

  return String(error);
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

function getWaVersionResultError(result: unknown): string | undefined {
  if (!result || typeof result !== 'object' || !('error' in result)) {
    return undefined;
  }

  return getErrorMessage((result as { error?: unknown }).error);
}

function withWaVersionFetchDeadline<T>(
  source: string,
  task: () => Promise<T>
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      fail(
        new Error(
          `${source}_version_fetch_timeout after ${WA_VERSION_FETCH_TIMEOUT_MS}ms`
        )
      );
    }, WA_VERSION_FETCH_TIMEOUT_MS);

    const finish = (): boolean => {
      if (settled) {
        return false;
      }
      settled = true;
      clearTimeout(timeout);
      return true;
    };

    const succeed = (value: T): void => {
      if (finish()) {
        resolve(value);
      }
    };

    const fail = (error: unknown): void => {
      if (finish()) {
        reject(error);
      }
    };

    try {
      task().then(succeed, fail);
    } catch (error) {
      fail(error);
    }
  });
}

function getFolder(): string {
  return `/app/data/storage/${baileysEnvironment.baileysWorkerId}`;
}

function getChannel(): string {
  return workerCentrifugoQueue(baileysEnvironment.baileysAccountId);
}

function getWorker(): string {
  return baileysEnvironment.baileysWorkerId;
}

function getAccount(): string {
  return baileysEnvironment.baileysAccountId;
}

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

async function getCachedWaWebVersion(): Promise<WaVersion> {
  if (
    cachedWaVersion &&
    Date.now() - cachedWaVersion.fetchedAt < cachedWaVersion.ttlMs
  ) {
    return cachedWaVersion.version;
  }

  const staleVersion = cachedWaVersion?.version;
  const errors: string[] = [];

  try {
    const waResult = await withWaVersionFetchDeadline('wa_web', () =>
      fetchLatestWaWebVersion()
    );
    const resultError = getWaVersionResultError(waResult);
    if (!resultError) {
      const version = cloneWaVersion(waResult.version);
      cachedWaVersion = {
        version,
        fetchedAt: Date.now(),
        ttlMs: WA_VERSION_TTL_MS,
        source: 'wa_web',
      };
      return version;
    }
    errors.push(`wa_web:${resultError}`);
  } catch (error) {
    errors.push(`wa_web:${getErrorMessage(error)}`);
  }

  try {
    const baileysResult = await withWaVersionFetchDeadline('baileys', () =>
      fetchLatestBaileysVersion()
    );
    const resultError = getWaVersionResultError(baileysResult);
    if (!resultError) {
      const version = cloneWaVersion(baileysResult.version);
      cachedWaVersion = {
        version,
        fetchedAt: Date.now(),
        ttlMs: WA_VERSION_TTL_MS,
        source: 'baileys',
      };
      return version;
    }
    errors.push(`baileys:${resultError}`);
  } catch (error) {
    errors.push(`baileys:${getErrorMessage(error)}`);
  }

  const fallbackVersion = staleVersion ?? DEFAULT_WA_VERSION;
  const fallbackSource = staleVersion ? 'stale_cache' : 'default_config';
  cachedWaVersion = {
    version: fallbackVersion,
    fetchedAt: Date.now(),
    ttlMs: WA_VERSION_FALLBACK_TTL_MS,
    source: fallbackSource,
  };
  logger.warn(
    {
      type: 'connection.baileys.wa_version.fallback',
      worker_id: getWorker(),
      account_id: getAccount(),
      source: fallbackSource,
      version: fallbackVersion.join('.'),
      fetch_timeout_ms: WA_VERSION_FETCH_TIMEOUT_MS,
      retry_after_ms: WA_VERSION_FALLBACK_TTL_MS,
      errors,
    },
    'Baileys WA version fetch failed; using fallback version'
  );
  return fallbackVersion;
}

class BaileysConnectionPhaseError extends Error {
  constructor(
    readonly reason: string,
    message: string,
    readonly originalError?: unknown
  ) {
    super(message);
    this.name = 'BaileysConnectionPhaseError';
    Object.setPrototypeOf(this, BaileysConnectionPhaseError.prototype);
  }
}

@singleton()
export class BaileysConnectionService {
  private readonly retryDelay = 60_000;
  private readonly maxRetries = 10;
  private readonly reconnectCooldownDelay = 30 * 60 * 1000;
  private readonly maxQrGenerations = 3;

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
  private connectionAttemptId?: string = undefined;
  private connectionLifecycleId?: string = undefined;
  private connectionAttemptStartedAtMs = 0;

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
      void this.centrifugo.publishSub(getChannel(), payload).catch((error) => {
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
          worker_id: getWorker(),
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
    if (this.isQrPairingInProgress()) {
      this.publishPairingInProgress('pairing_reconnect_attempt');
      return;
    }

    const retryPayload: IBaileysConnectionState = {
      status: Status.connecting,
      worker_id: getWorker(),
      account_id: getAccount(),
      code: ECodeMessage.awaitConnection,
      attempt,
      max_attempts: this.maxRetries,
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

  private publishPairingInProgress(context: string): void {
    const payload: IBaileysConnectionState = {
      status: Status.connecting,
      worker_id: getWorker(),
      account_id: getAccount(),
      is_new_login: true,
      code: ECodeMessage.pairingInProgress,
      worker_status_id: EWorkerStatus.disponible,
    };

    this.publishSub(payload, true);
    void this.notifyWorkerStatusSafely(payload, context);
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
      connection_attempt_id: connectionAttemptId,
      connection_lifecycle_id: connectionLifecycleId,
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
      connection_attempt_id: connectionAttemptId,
      connection_lifecycle_id: connectionLifecycleId,
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
    this.phoneConnection = phoneConnection;
    this.connectionAttemptId = connectionAttemptId;
    this.connectionLifecycleId = connectionLifecycleId;
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
      });
      this.cancelAttempt(false);
    }

    if (this.connecting && this.currentPromise) {
      this.logConnectionEvent('connect_short_circuit', {
        reason: 'already_connecting',
      });
      return this.currentPromise;
    }

    if (
      forceNew &&
      !forcedRestartActiveConnection &&
      (!this.connecting || fromDisconnectRestart)
    ) {
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

    const canContinueQrPairing = this.canContinueQrPairingReconnect(
      fromDisconnectRestart
    );

    if (
      this.typeConnection === EBaileysConnectionType.qrcode &&
      !requestedByUser &&
      !canContinueQrPairing &&
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
    this.setStatus(
      Status.connecting,
      canContinueQrPairing
        ? ECodeMessage.pairingInProgress
        : ECodeMessage.awaitConnection
    );
    if (canContinueQrPairing) {
      this.publishPairingInProgress('pairing_reconnect_starting');
    } else {
      this.publishConnectionStarting();
    }
    if (!fromDisconnectRestart) {
      this.retryCount = 0;
    }
    this.socketId += 1;
    this.connectionAttemptStartedAtMs = Date.now();

    let socket: WASocket;
    try {
      ({ socket } = await this.createSocket());
      this.logConnectionEvent('socket_create_ready', {
        socket_id: this.socketId,
        connection_type: this.typeConnection,
      });
    } catch (error) {
      return this.handleSocketCreateFailure(error);
    }

    this.baileysIncomingMessageService.bindTo(socket);
    this.socket = socket;

    this.currentPromise = this.wait(socket, this.socketId).finally(() => {
      this.connecting = false;
      this.currentPromise = undefined;
    });
    this.logConnectionEvent('connection_wait_registered', {
      socket_id: this.socketId,
      connection_type: this.typeConnection,
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
      worker_id: getWorker(),
      status: this.status,
      code: this.code?.toString(),
      message: 'BaileysConnectionService disconnected',
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
    const { state, saveCreds } = await this.runConnectionPhase(
      'auth_state_load',
      AUTH_STATE_TIMEOUT_MS,
      'auth_state_timeout',
      () => useMultiFileAuthState(getFolder())
    );
    const version = await this.runConnectionPhase(
      'wa_version_resolve',
      WA_VERSION_TIMEOUT_MS,
      'wa_version_timeout',
      () => getCachedWaWebVersion()
    );
    const proxyConfig = readProxyConfig();

    const proxyAgent = proxyConfig ? createProxyAgent(proxyConfig) : undefined;
    this.activeProxyUrl = proxyConfig?.url ?? null;
    this.activeProxyAgent = proxyAgent;

    const socket = await this.runConnectionPhase(
      'socket_create',
      SOCKET_CREATE_TIMEOUT_MS,
      'socket_create_timeout',
      async () =>
        makeWASocket({
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
        }),
      {
        proxy_status: proxyConfig ? 'configured' : 'disabled',
        wa_version: version.join('.'),
      }
    );

    socket.ev.on('creds.update', (creds) => {
      void saveCreds().catch((error) => {
        console.error('[BaileysConnection] Failed to save credentials', error);
      });
      this.maybeMarkPairingInProgressFromCreds(creds);
    });

    return { socket, saveCreds };
  }

  private async runConnectionPhase<T>(
    phase: string,
    timeoutMs: number,
    timeoutReason: string,
    task: () => Promise<T>,
    details: Record<string, unknown> = {}
  ): Promise<T> {
    const startedAt = Date.now();
    this.logConnectionEvent(`${phase}_start`, {
      deadline_ms: timeoutMs,
      ...details,
    });
    recordConnectionAttemptTelemetry({
      event: `worker_baileys_${phase}_start`,
      stage: `connection.baileys.service.${phase}_start`,
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type: 'baileys',
      library: 'baileys',
      connection_attempt_id: this.connectionAttemptId,
      status: this.status,
      code: this.code,
      outcome: 'started',
      deadline_ms: timeoutMs,
      ...details,
    });

    try {
      const result = await this.withDeadline(task(), timeoutMs, timeoutReason);
      this.logConnectionEvent(`${phase}_success`, {
        duration_ms: Date.now() - startedAt,
        deadline_ms: timeoutMs,
        ...details,
      });
      recordConnectionAttemptTelemetry({
        event: `worker_baileys_${phase}_success`,
        stage: `connection.baileys.service.${phase}_success`,
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type: 'baileys',
        library: 'baileys',
        connection_attempt_id: this.connectionAttemptId,
        status: this.status,
        code: this.code,
        outcome: 'success',
        duration_ms: Date.now() - startedAt,
        deadline_ms: timeoutMs,
        ...details,
      });
      return result;
    } catch (error) {
      const phaseError =
        error instanceof BaileysConnectionPhaseError
          ? error
          : new BaileysConnectionPhaseError(
              `${phase}_error`,
              this.errorMessage(error),
              error
            );
      this.logConnectionEvent(
        `${phase}_error`,
        {
          reason: phaseError.reason,
          error: phaseError.message,
          duration_ms: Date.now() - startedAt,
          deadline_ms: timeoutMs,
          ...details,
        },
        'warn'
      );
      recordConnectionAttemptTelemetry({
        event: `worker_baileys_${phase}_error`,
        stage: `connection.baileys.service.${phase}_error`,
        level: 'warn',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type: 'baileys',
        library: 'baileys',
        connection_attempt_id: this.connectionAttemptId,
        status: this.status,
        code: this.code,
        outcome: phaseError.reason.includes('timeout') ? 'timeout' : 'error',
        reason: phaseError.reason,
        error: phaseError.message,
        duration_ms: Date.now() - startedAt,
        deadline_ms: timeoutMs,
        ...details,
      });
      throw phaseError;
    }
  }

  private withDeadline<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutReason: string
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new BaileysConnectionPhaseError(
            timeoutReason,
            `${timeoutReason} after ${timeoutMs}ms`
          )
        );
      }, timeoutMs);

      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private handleSocketCreateFailure(error: unknown): IBaileysConnectionState {
    const phaseError =
      error instanceof BaileysConnectionPhaseError ? error : undefined;
    const reason = phaseError?.reason ?? 'socket_create_error';
    const elapsedMs =
      this.connectionAttemptStartedAtMs > 0
        ? Date.now() - this.connectionAttemptStartedAtMs
        : undefined;

    this.setStatus(Status.connecting, ECodeMessage.awaitingReadQrCode);
    this.connecting = false;
    this.currentPromise = undefined;
    this.baileysIncomingMessageService.unbind();
    this.socket = undefined;

    this.logConnectionEvent(
      'socket_create_failed_pending',
      {
        reason,
        error: this.errorMessage(error),
        time_to_first_qr_ms: elapsedMs,
        connection_type: this.typeConnection,
        has_session: this.hasSession(),
      },
      'warn'
    );
    recordConnectionAttemptTelemetry({
      event: 'worker_baileys_socket_create_failed_pending',
      stage: 'connection.baileys.service.socket_create_failed_pending',
      metric_event: 'qr_outcome',
      level: 'warn',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type: 'baileys',
      library: 'baileys',
      connection_attempt_id: this.connectionAttemptId,
      status: this.status,
      code: this.code,
      outcome: reason.includes('timeout') ? 'timeout' : 'pending',
      reason,
      time_to_first_qr_ms: elapsedMs,
    });

    const payload = this.state(undefined, undefined, {
      qr_pending: true,
      reason,
      time_to_first_qr_ms: elapsedMs,
      worker_status_id: EWorkerStatus.disponible,
    });
    this.publishSub(payload, true);
    void this.notifyWorkerStatusSafely(payload, reason);
    return payload;
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
      const startedAtMs = this.connectionAttemptStartedAtMs || Date.now();
      const firstQrTimeoutMs = getConnectionQrFirstQrTimeoutMs();
      let settled = false;
      let opened = false;
      let firstQrTimeout: NodeJS.Timeout | undefined;
      this.logConnectionEvent('wait_connection_update_start', {
        socket_id: id,
        deadline_ms: firstQrTimeoutMs,
        connection_type: this.typeConnection,
      });
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
          id !== this.socketId ||
          this.status !== Status.connecting
        ) {
          return;
        }

        const elapsedMs = Date.now() - startedAtMs;
        this.setStatus(Status.connecting, ECodeMessage.awaitingReadQrCode);
        this.logConnectionEvent(
          'first_qr_timeout',
          {
            reason: 'first_qr_timeout',
            deadline_ms: firstQrTimeoutMs,
            time_to_first_qr_ms: elapsedMs,
            connection_type: this.typeConnection,
            has_session: this.hasSession(),
            has_active_socket: Boolean(this.socket),
          },
          'warn'
        );
        recordConnectionAttemptTelemetry({
          event: 'worker_baileys_first_qr_timeout',
          stage: 'connection.baileys.service.first_qr_timeout',
          metric_event: 'qr_outcome',
          level: 'warn',
          worker_id: getWorker(),
          account_id: getAccount(),
          worker_type: 'baileys',
          library: 'baileys',
          connection_attempt_id: this.connectionAttemptId,
          status: this.status,
          code: this.code,
          outcome: 'timeout',
          reason: 'first_qr_timeout',
          deadline_ms: firstQrTimeoutMs,
          time_to_first_qr_ms: elapsedMs,
        });

        const payload = this.state(undefined, undefined, {
          qr_pending: true,
          reason: 'first_qr_timeout',
          time_to_first_qr_ms: elapsedMs,
          worker_status_id: EWorkerStatus.disponible,
        });
        this.publishSub(payload, true);
        void this.notifyWorkerStatusSafely(payload, 'first_qr_timeout');

        try {
          socket.ev.removeAllListeners('connection.update');
          const ws = this.resolveWebSocket();
          if (ws?.readyState === 1) {
            ws.close(1000, 'first_qr_timeout');
          } else if (ws && (ws.readyState === 0 || ws.readyState === 2)) {
            ws.terminate?.();
          }
        } catch {}

        this.baileysIncomingMessageService.unbind();
        this.socket = undefined;
        settle(payload);
      }, firstQrTimeoutMs);

      socket.ev.on('connection.update', async (u: IBaileysUpdateEvent) => {
        if (id !== this.socketId) {
          return;
        }

        const { qr, connection, isNewLogin, lastDisconnect } = u;
        const lastDisconnectError =
          lastDisconnect &&
          typeof lastDisconnect === 'object' &&
          'error' in lastDisconnect
            ? (lastDisconnect as { error?: unknown }).error
            : undefined;
        this.logConnectionEvent('connection_update_received', {
          socket_id: id,
          connection_state: connection,
          has_qr: Boolean(qr),
          is_new_login: Boolean(isNewLogin),
          last_disconnect_code: this.extractStatusCode(lastDisconnectError),
          last_disconnect_message:
            this.extractStatusMessage(lastDisconnectError) ??
            (lastDisconnectError
              ? this.errorMessage(lastDisconnectError)
              : undefined),
          time_since_attempt_start_ms: Date.now() - startedAtMs,
        });

        if (
          qr &&
          this.canShowQr() &&
          this.typeConnection === EBaileysConnectionType.qrcode
        ) {
          this.awaitingNewLogin = false;
          return this.onQr(qr, settle, id);
        }

        if (isNewLogin) {
          return this.onNewLoginAttempt();
        }

        if (this.shouldMarkQrPairingInProgress(connection)) {
          return this.onNewLoginAttempt();
        }

        if (connection === 'open' && !opened) {
          opened = true;
          this.retryCount = 0;

          return void this.onOpen(settle, id);
        }

        if (connection === 'close') {
          return this.onClose(lastDisconnect, settle, id);
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
      this.logConnectionEvent(
        'qr_ignored',
        {
          reason: 'stale_socket',
          socket_id: id,
          active_socket_id: this.socketId,
          connection_type: this.typeConnection,
        },
        'warn'
      );
      return;
    }

    if (qr.slice(-20) === this.qrHash) {
      this.logConnectionEvent('qr_ignored', {
        reason: 'duplicate_qr_hash',
        socket_id: id,
        attempt: this.qrGenerationCount,
        connection_type: this.typeConnection,
      });
      return;
    }

    if (this.qrGenerationCount >= this.maxQrGenerations) {
      this.logConnectionEvent(
        'qr_generation_limit_reached',
        {
          socket_id: id,
          attempt: this.qrGenerationCount + 1,
          max_attempts: this.maxQrGenerations,
          connection_type: this.typeConnection,
        },
        'warn'
      );
      await this.handleQrGenerationLimitReached();
      return;
    }

    this.qrHash = qr.slice(-20);
    this.qrGenerationCount += 1;
    this.setStatus(Status.connecting, ECodeMessage.awaitingReadQrCode);
    const qrGeneratedAt = new Date().toISOString();
    const timeToFirstQrMs =
      this.connectionAttemptStartedAtMs > 0
        ? Date.now() - this.connectionAttemptStartedAtMs
        : undefined;
    this.logConnectionEvent('qr_generated', {
      attempt: this.qrGenerationCount,
      max_attempts: this.maxQrGenerations,
      connection_type: this.typeConnection,
      time_to_first_qr_ms: timeToFirstQrMs,
    });
    recordConnectionAttemptTelemetry({
      event: 'worker_baileys_qr_generated',
      stage: 'connection.baileys.service.qr_generated',
      metric_event: 'qr_outcome',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type: 'baileys',
      library: 'baileys',
      connection_attempt_id: this.connectionAttemptId,
      status: this.status,
      code: this.code,
      outcome: 'qr_generated',
      attempt: this.qrGenerationCount,
      max_attempts: this.maxQrGenerations,
      time_to_first_qr_ms: timeToFirstQrMs,
      has_qr: true,
    });

    await this.printQrInConsole(qr);
    const qrDataUrlStartedAt = Date.now();
    this.logConnectionEvent('qr_dataurl_generate_start', {
      attempt: this.qrGenerationCount,
      max_attempts: this.maxQrGenerations,
      time_to_first_qr_ms: timeToFirstQrMs,
    });
    let img: string;
    let qrImageRenderer = 'png';
    let qrImageFallback = false;
    try {
      img = await this.withDeadline(
        QRCode.toDataURL(qr),
        QR_DATA_URL_GENERATION_TIMEOUT_MS,
        'qr_dataurl_generation_timeout'
      );
      this.logConnectionEvent('qr_dataurl_generate_success', {
        attempt: this.qrGenerationCount,
        max_attempts: this.maxQrGenerations,
        duration_ms: Date.now() - qrDataUrlStartedAt,
        time_to_first_qr_ms: timeToFirstQrMs,
        renderer: qrImageRenderer,
        fallback_used: qrImageFallback,
      });
    } catch (error) {
      const errorMessage = this.errorMessage(error);
      this.logConnectionEvent(
        'qr_dataurl_generate_primary_error',
        {
          reason: 'qr_png_dataurl_generation_failed',
          error: errorMessage,
          duration_ms: Date.now() - qrDataUrlStartedAt,
          timeout_ms: QR_DATA_URL_GENERATION_TIMEOUT_MS,
          time_to_first_qr_ms: timeToFirstQrMs,
        },
        'warn'
      );
      const fallbackStartedAt = Date.now();
      try {
        img = renderQrSvgDataUrl(qr);
        qrImageRenderer = 'svg';
        qrImageFallback = true;
        this.logConnectionEvent('qr_dataurl_generate_success', {
          reason: 'qr_svg_fallback_used',
          attempt: this.qrGenerationCount,
          max_attempts: this.maxQrGenerations,
          duration_ms: Date.now() - qrDataUrlStartedAt,
          fallback_duration_ms: Date.now() - fallbackStartedAt,
          timeout_ms: QR_DATA_URL_GENERATION_TIMEOUT_MS,
          time_to_first_qr_ms: timeToFirstQrMs,
          renderer: qrImageRenderer,
          fallback_used: qrImageFallback,
        });
      } catch (fallbackError) {
        const fallbackErrorMessage = this.errorMessage(fallbackError);
        this.logConnectionEvent(
          'qr_dataurl_generate_error',
          {
            reason: 'qr_dataurl_generation_failed',
            error: errorMessage,
            fallback_error: fallbackErrorMessage,
            duration_ms: Date.now() - qrDataUrlStartedAt,
            fallback_duration_ms: Date.now() - fallbackStartedAt,
            timeout_ms: QR_DATA_URL_GENERATION_TIMEOUT_MS,
            time_to_first_qr_ms: timeToFirstQrMs,
          },
          'error'
        );
        recordConnectionAttemptTelemetry({
          event: 'worker_baileys_qr_dataurl_generation_error',
          stage: 'connection.baileys.service.qr_dataurl_generate_error',
          metric_event: 'qr_outcome',
          level: 'error',
          worker_id: getWorker(),
          account_id: getAccount(),
          worker_type: 'baileys',
          library: 'baileys',
          connection_attempt_id: this.connectionAttemptId,
          status: this.status,
          code: this.code,
          outcome: 'error',
          reason: 'qr_dataurl_generation_failed',
          error: errorMessage,
          fallback_error: fallbackErrorMessage,
          time_to_first_qr_ms: timeToFirstQrMs,
        });
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
        resolve(payload);
        this.pendingResolve = undefined;
        return;
      }
    }
    if (id !== this.socketId) {
      this.logConnectionEvent(
        'qr_dataurl_ignored',
        {
          reason: 'stale_socket_after_dataurl',
          socket_id: id,
          active_socket_id: this.socketId,
          attempt: this.qrGenerationCount,
          max_attempts: this.maxQrGenerations,
        },
        'warn'
      );
      return;
    }

    const payload: IBaileysConnectionState = {
      status: this.status,
      code: this.code,
      qrcode: img,
      worker_id: getWorker(),
      account_id: getAccount(),
      attempt: this.qrGenerationCount,
      max_attempts: this.maxQrGenerations,
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: this.connectionAttemptId,
      connection_lifecycle_id: this.connectionLifecycleId,
      qr_generated_at: qrGeneratedAt,
      time_to_first_qr_ms: timeToFirstQrMs,
    };
    this.logConnectionEvent('qr_payload_ready', {
      attempt: this.qrGenerationCount,
      max_attempts: this.maxQrGenerations,
      worker_status_id: payload.worker_status_id,
      has_qr: true,
      time_to_first_qr_ms: timeToFirstQrMs,
      renderer: qrImageRenderer,
      fallback_used: qrImageFallback,
    });
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
    resolve(state);
    this.logConnectionEvent('qr_resolved_to_requester', {
      attempt: this.qrGenerationCount,
      max_attempts: this.maxQrGenerations,
      has_qr: true,
      time_to_first_qr_ms: timeToFirstQrMs,
    });

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
      worker_id: getWorker(),
      account_id: getAccount(),
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

    const shouldKeepPairingState =
      statusCode === ECodeMessage.restartRequired &&
      this.isQrPairingInProgress();

    if (statusCode !== ECodeMessage.restartRequired) {
      await this.healthCheckService.notifyDisconnected(
        statusMessage ?? 'Connection closed'
      );
    }
    this.healthCheckService.stop();
    this.clearReconnectRetryTimer();

    if (statusCode === ECodeMessage.restartRequired) {
      this.setStatus(
        Status.connecting,
        shouldKeepPairingState
          ? ECodeMessage.pairingInProgress
          : ECodeMessage.awaitConnection
      );
      if (shouldKeepPairingState) {
        this.publishPairingInProgress('pairing_restart_required');
      }
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
        worker_id: getWorker(),
        account_id: getAccount(),
        code: disconnectionCode,
        worker_status_id: workerStatusId,
      };

      const payloadStr = JSON.stringify(payload);
      if (payloadStr !== this.lastStatusPayload) {
        this.publishSub(payload, true);
        this.lastStatusPayload = payloadStr;

        this.saveLogWppConnection({
          worker_id: getWorker(),
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
        worker_id: getWorker(),
        code: disconnectionCode,
        disconnected_user: true,
        account_id: getAccount(),
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
    if (this.code === ECodeMessage.pairingInProgress) {
      this.publishPairingInProgress('pairing_in_progress_republish');
      return;
    }

    this.awaitingNewLogin = true;
    this.connectionEstablished = false;
    this.qrReadSessionActive = false;
    this.qrReadSessionLocked = true;
    this.qrHash = undefined;
    this.setStatus(Status.connecting, ECodeMessage.pairingInProgress);

    this.publishPairingInProgress('pairing_in_progress');
  }

  private isQrPairingInProgress(): boolean {
    return (
      this.typeConnection === EBaileysConnectionType.qrcode &&
      (this.code === ECodeMessage.pairingInProgress ||
        this.awaitingNewLogin ||
        (this.qrReadSessionLocked && this.hasSession()))
    );
  }

  private canContinueQrPairingReconnect(
    fromDisconnectRestart: boolean
  ): boolean {
    return (
      fromDisconnectRestart &&
      !this.userRequestedDisconnect &&
      this.hasSession() &&
      this.isQrPairingInProgress()
    );
  }

  private maybeMarkPairingInProgressFromCreds(
    creds: Partial<{ registered: boolean; me: unknown }>
  ): void {
    if (creds.registered !== true && !creds.me) {
      return;
    }

    if (this.shouldMarkQrPairingInProgress()) {
      this.onNewLoginAttempt();
    }
  }

  private shouldMarkQrPairingInProgress(
    connection?: IBaileysUpdateEvent['connection']
  ): boolean {
    if (connection && connection !== 'connecting') {
      return false;
    }

    return (
      this.typeConnection === EBaileysConnectionType.qrcode &&
      this.status === Status.connecting &&
      this.code === ECodeMessage.awaitingReadQrCode &&
      Boolean(this.qrHash) &&
      this.qrReadSessionActive &&
      !this.qrReadSessionLocked
    );
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
    this.setStatus(Status.disconnected, ECodeMessage.connectionClosed);

    const payload: IBaileysConnectionState = {
      status: this.status,
      code: this.code,
      worker_id: getWorker(),
      account_id: getAccount(),
      attempt: this.maxQrGenerations + 1,
      max_attempts: this.maxQrGenerations,
      worker_status_id: EWorkerStatus.disponible,
    };

    this.publishSub(payload, true);
    void this.notifyWorkerStatusSafely(payload, 'qr_limit_reached');
    this.cancelAttempt(false);
  }

  hasSession(): boolean {
    return fs.existsSync(getFolder()) && fs.readdirSync(getFolder()).length > 0;
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
        worker_id: getWorker(),
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
    const payloadWithLifecycle = this.withConnectionLifecycle(payload);
    if (!this.initialConnection && !force) {
      recordConnectionLifecycle({
        stage: 'connection.baileys.centrifugo.publish_skipped',
        decision: 'publish_sub_initial_connection_gate',
        outcome: 'skipped',
        reason: 'initial_connection_false',
        source_provider: 'baileys',
        worker_type: 'baileys',
        worker_id: getWorker(),
        channel_id: getWorker(),
        account_id: getAccount(),
        status: payloadWithLifecycle.status,
        code: payloadWithLifecycle.code,
        connection_attempt_id: payloadWithLifecycle.connection_attempt_id,
        connection_lifecycle_id: payloadWithLifecycle.connection_lifecycle_id,
      });
      return;
    }

    const data = JSON.stringify(payloadWithLifecycle);
    if (data === this.lastPayload && !force) {
      recordConnectionLifecycle({
        stage: 'connection.baileys.centrifugo.publish_skipped',
        decision: 'publish_sub_dedupe',
        outcome: 'skipped',
        reason: 'payload_duplicated',
        source_provider: 'baileys',
        worker_type: 'baileys',
        worker_id: getWorker(),
        channel_id: getWorker(),
        account_id: getAccount(),
        status: payloadWithLifecycle.status,
        code: payloadWithLifecycle.code,
        connection_attempt_id: payloadWithLifecycle.connection_attempt_id,
        connection_lifecycle_id: payloadWithLifecycle.connection_lifecycle_id,
      });
      return;
    }

    this.lastPayload = data;
    const startedAt = Date.now();
    const hasConnectionCredential = Boolean(
      payloadWithLifecycle.qrcode || payloadWithLifecycle.pairing_code
    );
    const publishMode = hasConnectionCredential ? 'immediate' : 'standard';
    recordConnectionLifecycle({
      stage: 'connection.baileys.centrifugo.publish_start',
      decision: 'publish_sub',
      outcome: 'started',
      source_provider: 'baileys',
      worker_type: 'baileys',
      worker_id: getWorker(),
      channel_id: getWorker(),
      account_id: getAccount(),
      status: payloadWithLifecycle.status,
      code: payloadWithLifecycle.code,
      worker_status_id: payloadWithLifecycle.worker_status_id,
      connection_attempt_id: payloadWithLifecycle.connection_attempt_id,
      connection_lifecycle_id: payloadWithLifecycle.connection_lifecycle_id,
      has_qr: Boolean(payloadWithLifecycle.qrcode),
      has_pairing_code: Boolean(payloadWithLifecycle.pairing_code),
      publish_mode: publishMode,
      force,
    });
    const publishPromise = hasConnectionCredential
      ? this.centrifugo.publishSubImmediate(getChannel(), payloadWithLifecycle)
      : this.centrifugo.publishSub(getChannel(), payloadWithLifecycle);

    void publishPromise
      .then(() => {
        recordConnectionLifecycle({
          stage: 'connection.baileys.centrifugo.publish_success',
          decision: 'publish_sub',
          outcome: 'success',
          source_provider: 'baileys',
          worker_type: 'baileys',
          worker_id: getWorker(),
          channel_id: getWorker(),
          account_id: getAccount(),
          status: payloadWithLifecycle.status,
          code: payloadWithLifecycle.code,
          worker_status_id: payloadWithLifecycle.worker_status_id,
          connection_attempt_id: payloadWithLifecycle.connection_attempt_id,
          connection_lifecycle_id: payloadWithLifecycle.connection_lifecycle_id,
          has_qr: Boolean(payloadWithLifecycle.qrcode),
          has_pairing_code: Boolean(payloadWithLifecycle.pairing_code),
          publish_mode: publishMode,
          duration_ms: Date.now() - startedAt,
        });
      })
      .catch((error) => {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        recordConnectionLifecycle({
          stage: 'connection.baileys.centrifugo.publish_error',
          decision: 'publish_sub',
          outcome: 'error',
          reason: 'centrifugo_publish_failed',
          level: 'error',
          source_provider: 'baileys',
          worker_type: 'baileys',
          worker_id: getWorker(),
          channel_id: getWorker(),
          account_id: getAccount(),
          status: payloadWithLifecycle.status,
          code: payloadWithLifecycle.code,
          worker_status_id: payloadWithLifecycle.worker_status_id,
          connection_attempt_id: payloadWithLifecycle.connection_attempt_id,
          connection_lifecycle_id: payloadWithLifecycle.connection_lifecycle_id,
          has_qr: Boolean(payloadWithLifecycle.qrcode),
          has_pairing_code: Boolean(payloadWithLifecycle.pairing_code),
          publish_mode: publishMode,
          duration_ms: Date.now() - startedAt,
          error: errorMessage,
        });
        console.error('[BaileysConnection] publishSub - Failed', error);
      });
  }

  private async notifyWorkerStatusSafely(
    payload: IBaileysConnectionState,
    context: string
  ): Promise<void> {
    const payloadWithLifecycle = this.withConnectionLifecycle(payload);
    const startedAt = Date.now();
    recordConnectionLifecycle({
      stage: 'connection.baileys.balance.notify_start',
      decision: 'notify_worker_status',
      outcome: 'started',
      source_provider: 'baileys',
      worker_type: 'baileys',
      worker_id: getWorker(),
      channel_id: getWorker(),
      account_id: getAccount(),
      status: payloadWithLifecycle.status,
      code: payloadWithLifecycle.code,
      worker_status_id: payloadWithLifecycle.worker_status_id,
      reason: context,
      connection_attempt_id: payloadWithLifecycle.connection_attempt_id,
      connection_lifecycle_id: payloadWithLifecycle.connection_lifecycle_id,
      has_qr: Boolean(payloadWithLifecycle.qrcode),
      has_pairing_code: Boolean(payloadWithLifecycle.pairing_code),
    });
    try {
      await this.balanceWorkerStatusGrpcClientService.notifyWorkerStatus(
        payloadWithLifecycle
      );
      recordConnectionLifecycle({
        stage: 'connection.baileys.balance.notify_success',
        decision: 'notify_worker_status',
        outcome: 'success',
        source_provider: 'baileys',
        worker_type: 'baileys',
        worker_id: getWorker(),
        channel_id: getWorker(),
        account_id: getAccount(),
        status: payloadWithLifecycle.status,
        code: payloadWithLifecycle.code,
        worker_status_id: payloadWithLifecycle.worker_status_id,
        reason: context,
        connection_attempt_id: payloadWithLifecycle.connection_attempt_id,
        connection_lifecycle_id: payloadWithLifecycle.connection_lifecycle_id,
        duration_ms: Date.now() - startedAt,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      recordConnectionLifecycle({
        stage: 'connection.baileys.balance.notify_error',
        decision: 'notify_worker_status',
        outcome: 'error',
        reason: context,
        level: 'error',
        source_provider: 'baileys',
        worker_type: 'baileys',
        worker_id: getWorker(),
        channel_id: getWorker(),
        account_id: getAccount(),
        status: payloadWithLifecycle.status,
        code: payloadWithLifecycle.code,
        worker_status_id: payloadWithLifecycle.worker_status_id,
        connection_attempt_id: payloadWithLifecycle.connection_attempt_id,
        connection_lifecycle_id: payloadWithLifecycle.connection_lifecycle_id,
        duration_ms: Date.now() - startedAt,
        error: errorMessage,
      });
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
      worker_id: getWorker(),
      account_id: getAccount(),
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
          worker_id: getWorker(),
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
        worker_id: getWorker(),
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
        worker_id: getWorker(),
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
          worker_id: getWorker(),
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
        worker_id: getWorker(),
        account_id: getAccount(),
        phone: getPhoneNumber(this.socket?.user?.id),
        worker_status_id: EWorkerStatus.online,
      };

      this.publishSub(payload);
      void this.notifyWorkerStatusSafely(payload, 'report_connected');
    }

    return this.state();
  }

  private prepareFolder() {
    if (!fs.existsSync(getFolder())) {
      fs.mkdirSync(getFolder(), {
        recursive: true,
      });
    }
  }

  private clearFolder() {
    if (!fs.existsSync(getFolder())) {
      return;
    }

    for (const f of fs.readdirSync(getFolder())) {
      fs.rmSync(path.join(getFolder(), f), {
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

  private state(
    qr?: string,
    qrGeneratedAt?: string,
    extras: Partial<IBaileysConnectionState> = {}
  ): IBaileysConnectionState {
    const result: IBaileysConnectionState = {
      status: this.status,
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.baileys,
      qrcode: qr,
      code: this.code,
      connection_attempt_id: this.connectionAttemptId,
      connection_lifecycle_id: this.connectionLifecycleId,
      ...extras,
    };
    if (qr && qrGeneratedAt) {
      result.qr_generated_at = qrGeneratedAt;
    }
    if (this.status === Status.connecting) {
      result.attempt = this.retryCount > 0 ? this.retryCount : 1;
      result.max_attempts = this.maxRetries;
    }
    return result;
  }

  private withConnectionLifecycle(
    payload: IBaileysConnectionState
  ): IBaileysConnectionState {
    const connectionAttemptId =
      payload.connection_attempt_id ?? this.connectionAttemptId;
    const connectionLifecycleId =
      payload.connection_lifecycle_id ?? this.connectionLifecycleId;

    if (
      payload.connection_attempt_id === connectionAttemptId &&
      payload.connection_lifecycle_id === connectionLifecycleId &&
      payload.worker_type_id === EWorkerType.baileys
    ) {
      return payload;
    }

    return {
      ...payload,
      worker_type_id: EWorkerType.baileys,
      connection_attempt_id: connectionAttemptId,
      connection_lifecycle_id: connectionLifecycleId,
    };
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

  private errorMessage(error: unknown): string {
    if (error instanceof BaileysConnectionPhaseError) {
      return error.message;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
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
      worker_id: getWorker(),
      account_id: getAccount(),
      connection_attempt_id: this.connectionAttemptId,
      connection_lifecycle_id: this.connectionLifecycleId,
      connection_type: this.typeConnection,
      status: this.status,
      code: this.code,
      ...details,
    };

    recordConnectionLifecycle({
      stage: `connection.baileys.service.${event}`,
      decision: event,
      outcome: level === 'error' ? 'error' : 'logged',
      level,
      source_provider: 'baileys',
      worker_type: 'baileys',
      worker_id: getWorker(),
      channel_id: getWorker(),
      account_id: getAccount(),
      connection_attempt_id: this.connectionAttemptId,
      connection_lifecycle_id: this.connectionLifecycleId,
      connection_type: this.typeConnection,
      status: this.status,
      code: this.code,
      ...details,
    });

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
    const startedAt = Date.now();
    recordConnectionLifecycle({
      stage: 'connection.baileys.elastic.wpp_connection_start',
      decision: 'save_wpp_connection',
      outcome: 'started',
      source_provider: 'baileys',
      worker_type: 'baileys',
      worker_id: getWorker(),
      channel_id: getWorker(),
      account_id: getAccount(),
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
        stage: 'connection.baileys.elastic.wpp_connection_skipped',
        decision: 'save_wpp_connection',
        outcome: 'skipped',
        reason: !wppLog ? 'missing_wpp_log' : 'index_creation_failed',
        level: 'warn',
        source_provider: 'baileys',
        worker_type: 'baileys',
        worker_id: getWorker(),
        channel_id: getWorker(),
        account_id: getAccount(),
        elastic_index: EElasticIndex.wpp_connection,
        duration_ms: Date.now() - startedAt,
      });
      return false;
    }

    const documentId = buildWppConnectionDocumentId(
      getAccount(),
      wppLog.worker_id
    );

    try {
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

      recordConnectionLifecycle({
        stage: success
          ? 'connection.baileys.elastic.wpp_connection_success'
          : 'connection.baileys.elastic.wpp_connection_unexpected_result',
        decision: 'save_wpp_connection',
        outcome: success ? 'success' : 'error',
        level: success ? 'info' : 'warn',
        reason: updateResult,
        source_provider: 'baileys',
        worker_type: 'baileys',
        worker_id: getWorker(),
        channel_id: getWorker(),
        account_id: getAccount(),
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
        stage: 'connection.baileys.elastic.wpp_connection_error',
        decision: 'save_wpp_connection',
        outcome: 'error',
        reason: 'elastic_update_failed',
        level: 'error',
        source_provider: 'baileys',
        worker_type: 'baileys',
        worker_id: getWorker(),
        channel_id: getWorker(),
        account_id: getAccount(),
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
