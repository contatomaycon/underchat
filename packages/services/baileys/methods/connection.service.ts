import {
  Browsers,
  DEFAULT_CONNECTION_CONFIG,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  importWhatsAppWebSessionToMultiFileAuthState,
  makeWASocket,
  type WhatsAppWebSessionPackage,
  useMultiFileAuthState,
  type WASocket,
} from '@whiskeysockets/baileys';
import * as BaileysModule from '@whiskeysockets/baileys';
import type WebSocket from 'ws';
import QRCode from 'qrcode';
import P from 'pino';
import Redis from 'ioredis';
import fs from 'node:fs';
import path from 'node:path';
import { request as httpsRequest, type Agent as HttpsAgent } from 'node:https';
import { createHash, randomUUID } from 'node:crypto';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { singleton, inject } from 'tsyringe';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { baileysEnvironment } from '@core/config/environments';
import { EBaileysConnectionStatus as Status } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { IBaileysUpdateEvent } from '@core/common/interfaces/IBaileysUpdateEvent';
import {
  ISecureConnectionImportRequest,
  ISecureConnectionSessionPackage,
} from '@core/common/interfaces/ISecureConnectionSession';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EWppConnection } from '@core/common/enums/EWppConnection';
import { wppConnectionMappings } from '@core/mappings/wppConnection.mappings';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { IBaileysConnection } from '@core/common/interfaces/IBaileysConnection';
import type { IWhatsappRuntimeFenceConnectionAuthorization } from '@core/common/interfaces/IWhatsappRuntimeFenceConnectionAuthorization';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { EAppEnvironment } from '@core/common/enums/EAppEnvironment';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { BalanceWorkerStatusGrpcClientService } from '@core/services/balanceWorkerStatusGrpcClient.service';
import { BaileysIncomingMessageService } from './incoming.service';
import { BaileysHealthCheckService } from './healthCheck.service';
import { getPhoneNumber } from '@core/common/functions/getPhoneNumber';
import { buildWppConnectionDocumentId } from '@core/common/functions/buildWppConnectionDocumentId';
import { EProxyProtocol } from '@core/common/enums/EProxyProtocol';
import {
  ConnectionLifecycleDebugContext,
  ConnectionLifecycleDebugService,
} from '@core/services/connectionLifecycleDebug.service';
import { logLocalConnectionStatus } from '@core/common/functions/localConnectionStatusLog';
import { logConnectionFlowConsole } from '@core/common/functions/connectionFlowConsoleLog';
import { emitWorkerProviderRuntimeState } from '@core/common/functions/workerProviderRuntimeState';
import { setWorkerKafkaDispatchAuthorized } from '@core/common/functions/workerKafkaDispatchAuthorization';
import {
  ProviderInvocationInFlightError,
  ProviderInvocationSingleFlight,
} from '@core/common/functions/providerInvocationSingleFlight';
import {
  invokeProviderAuxiliaryWithTimeout,
  ProviderAuxiliaryInvocationTimeoutError,
  resolveProviderAuxiliaryTimeoutMs,
} from '@core/common/functions/providerAuxiliaryInvocation';
import {
  BaileysCanonicalCodecError,
  type BaileysProviderHandoffCheckpoint,
  type BaileysPostQuantumServerRollbackProof,
  type BaileysAuthStateImportRecordInput,
  BaileysPostgresAuthStateStore,
  BaileysSessionFenceError,
  type BaileysStagedSessionRevision,
} from '../stores/postgresAuthState.store';
import {
  workerErrorDiagnostics,
  workerErrorFailureReason,
} from '@core/common/functions/workerErrorDiagnostics';
import { classifyBaileysProviderOperationFailure } from '../util/providerOperationFailure';
import { baileysCredentialPersistenceDiagnostics } from '../util/credentialPersistenceFailure';
import {
  IPrepareProviderHandoffRequestProto,
  IPrepareProviderHandoffResponseProto,
} from '@core/common/interfaces/IProviderHandoffPrepareProto';
import { IWhatsappConnectionStatus } from '@core/common/interfaces/IWhatsappConnectionStatus';
import { EWhatsappConnectionStatus } from '@core/common/enums/EWhatsappConnectionStatus';
import {
  isNewerWhatsappConnectionStatus,
  isWhatsappConnectionOnline,
  normalizeWhatsappConnectionStatus,
  normalizeWhatsappConnectionStatusSourceId,
} from '@core/common/functions/whatsappConnectionStatus';
import {
  NativeConnectionStatusPersistenceQueue,
  type NativeConnectionStatusPersistenceFailure,
} from '@core/services/nativeConnectionStatusPersistenceQueue.service';
import type { WorkerRuntimeConnectionStatusLeaseProof } from '@core/services/workerRuntimeDatabase.service';
import type {
  IPrepareSessionStorageMigrationRequestProto,
  IPrepareSessionStorageMigrationResponseProto,
} from '@core/common/interfaces/ISessionStorageMigrationPrepareProto';
import { snapshotLegacySessionVolume } from '@core/services/sessionStorageMigrationSnapshot.service';
import {
  BaileysLegacyVolumeMigrationError,
  readBaileysLegacyVolumeAuthFiles,
} from '@core/services/baileys/baileysLegacyVolumeMigration.service';

interface BaileysNativeConnectionStatusSource {
  getConnectionStatus(): unknown;
  ev: {
    on(
      event: 'connection_status',
      listener: (snapshot: unknown) => void
    ): unknown;
  };
}

interface BaileysNativeConnectionStatusPersistencePayload {
  state: IBaileysConnectionState;
  leaseProof?: WorkerRuntimeConnectionStatusLeaseProof;
}

interface BaileysCredentialPersistenceBarrier {
  socket: WASocket;
  sequence: number;
  acknowledgedSequence: number;
  tail: Promise<void>;
  lastError?: unknown;
}

export interface BaileysConnectionStatusHealthEvidence {
  connectionStatus?: IWhatsappConnectionStatus;
  connectionStatusSourceId?: string;
  sourceCurrent: boolean;
  leaseRequired: boolean;
  leaseProofValid: boolean;
  sessionStorage: 'legacy_volume' | 'postgres';
  sessionRevisionId?: string;
  sessionStorageMigrationId?: string;
}

export type BaileysSessionLeaseLostListener = (
  error: BaileysSessionFenceError
) => void | Promise<void>;

function hashBaileysNetworkLogValue(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return `sha256:${createHash('sha256').update(value.trim()).digest('hex')}`;
}

function describeBaileysProxyForLog(
  proxyUrl: string | null | undefined
): Record<string, unknown> {
  if (!proxyUrl) return { enabled: false };
  try {
    const parsed = new URL(proxyUrl);
    return {
      enabled: true,
      protocol: parsed.protocol.replace(':', ''),
      host_hash: hashBaileysNetworkLogValue(parsed.hostname),
      port: parsed.port || null,
      has_auth: Boolean(parsed.username || parsed.password),
    };
  } catch {
    return { enabled: true, parse_error: true };
  }
}

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
const PROVIDER_HANDOFF_SOCKET_CLOSE_TIMEOUT_MS = readBoundedIntEnv(
  'BAILEYS_PROVIDER_HANDOFF_SOCKET_CLOSE_TIMEOUT_MS',
  10_000,
  1_000,
  30_000
);
const PROVIDER_HANDOFF_RECONNECT_RETRY_MS = readBoundedIntEnv(
  'BAILEYS_PROVIDER_HANDOFF_RECONNECT_RETRY_MS',
  2_000,
  250,
  15_000
);
const SECURE_IMPORT_RECOVERY_TIMEOUT_MS = readBoundedIntEnv(
  'BAILEYS_SECURE_IMPORT_RECOVERY_TIMEOUT_MS',
  45_000,
  5_000,
  90_000
);
const SECURE_IMPORT_RECOVERY_POLL_MS = readBoundedIntEnv(
  'BAILEYS_SECURE_IMPORT_RECOVERY_POLL_MS',
  100,
  25,
  1_000
);
const QR_DATA_URL_GENERATION_TIMEOUT_MS = readBoundedIntEnv(
  'CONNECTION_QR_DATAURL_TIMEOUT_MS',
  1_500,
  250,
  10_000
);
const CONNECTION_QR_FIRST_QR_TIMEOUT_MS = readBoundedIntEnv(
  'CONNECTION_QR_FIRST_QR_TIMEOUT_MS',
  25_000,
  1_000,
  300_000
);
const CONNECTION_QR_RENEWAL_TIMEOUT_MS = readBoundedIntEnv(
  'CONNECTION_QR_RENEWAL_TIMEOUT_MS',
  25_000,
  5_000,
  300_000
);
const CONNECTION_QR_SETUP_RETRY_MS = readBoundedIntEnv(
  'CONNECTION_QR_SETUP_RETRY_MS',
  1_500,
  250,
  10_000
);
const CONNECTION_QR_TERMINAL_PUBLISH_TIMEOUT_MS = readBoundedIntEnv(
  'CONNECTION_QR_TERMINAL_PUBLISH_TIMEOUT_MS',
  5_000,
  500,
  15_000
);
const KAFKA_READINESS_RETRY_MS = readBoundedIntEnv(
  'BAILEYS_KAFKA_READINESS_RETRY_MS',
  5_000,
  250,
  60_000
);
const TRANSIENT_DISCONNECT_STATUS_DEBOUNCE_MS = readBoundedIntEnv(
  'BAILEYS_TRANSIENT_DISCONNECT_STATUS_DEBOUNCE_MS',
  5_000,
  250,
  60_000
);
const QR_SVG_MARGIN_MODULES = 4;
const SHOULD_LOG_CONNECTION_IP =
  process.env.APP_ENVIRONMENT === EAppEnvironment.local;
const SHOULD_LOG_LOCAL_DETAILS =
  process.env.APP_ENVIRONMENT === EAppEnvironment.local;
const BAILEYS_BROWSER_NAME =
  process.env.BAILEYS_BROWSER_NAME?.trim() || 'Chrome';
const LEGACY_SESSION_STORAGE = 'legacy_volume';
const requiresClassicalPostQuantumHandoff = (
  targetProvider: string
): targetProvider is 'wwebjs' | 'whatsmeow' =>
  targetProvider === 'wwebjs' || targetProvider === 'whatsmeow';
const POSTGRES_SESSION_STORAGE = 'postgres';

function getSessionStorage():
  typeof LEGACY_SESSION_STORAGE | typeof POSTGRES_SESSION_STORAGE {
  const value = process.env.WORKER_SESSION_STORAGE?.trim();
  if (!value) {
    return LEGACY_SESSION_STORAGE;
  }
  if (value === LEGACY_SESSION_STORAGE || value === POSTGRES_SESSION_STORAGE) {
    return value;
  }
  throw new Error('WORKER_SESSION_STORAGE is invalid');
}

function usesPostgresSessionStorage(): boolean {
  return getSessionStorage() === POSTGRES_SESSION_STORAGE;
}

function normalizeSecureImportRecords(
  sessionPackage: WhatsAppWebSessionPackage
): BaileysAuthStateImportRecordInput[] {
  const normalizer = (
    BaileysModule as unknown as {
      normalizeWhatsAppWebSessionPackageToBaileysAuthRecords?: (
        input: WhatsAppWebSessionPackage
      ) => BaileysAuthStateImportRecordInput[];
    }
  ).normalizeWhatsAppWebSessionPackageToBaileysAuthRecords;
  if (!normalizer) {
    throw new Error('baileys_import_record_normalizer_unavailable');
  }
  return normalizer(sessionPackage);
}
type WaVersion = [number, number, number];
type BaileysBrowser = [string, string, string];
type PasskeyCapableSocket = WASocket & {
  sendPasskeyResponse?: (passkeyResponse: unknown) => Promise<void>;
  confirmPasskey?: () => Promise<void>;
};
type ProviderHandoffCapableSocket = Omit<
  WASocket,
  'deletePqPreKeys' | 'recoverPqAfterClassicalHandoffAbort'
> & {
  deletePqPreKeys?: () => Promise<BaileysPostQuantumServerRollbackProof>;
  recoverPqAfterClassicalHandoffAbort?: (options?: {
    allowPersistedRecovery?: boolean;
  }) => Promise<void>;
};
type PendingBaileysProviderHandoffCompletion = {
  key: string;
  input: IPrepareProviderHandoffRequestProto;
  store: BaileysPostgresAuthStateStore;
  socket?: ProviderHandoffCapableSocket;
  checkpoint: BaileysProviderHandoffCheckpoint;
  providerDisconnected: boolean;
};
type BaileysPasskeyUpdate = NonNullable<IBaileysUpdateEvent['passkey']>;
type WorkerStatusNotificationResult =
  | { outcome: 'accepted' }
  | { outcome: 'deferred'; reason: 'command_ingress_positioning' }
  | {
      outcome: 'failed';
      classification: 'recoverable' | 'terminal';
      reason: string;
      grpcCode?: number;
    };
type BaileysReadyConfirmationSource = 'open' | 'verify';
type BaileysReadinessResult = Awaited<
  ReturnType<BaileysHealthCheckService['verifyCurrentSession']>
>;
type BaileysConnectionMetadataInput = Pick<
  IBaileysConnectionState,
  | 'connection_attempt_id'
  | 'authorized_connection_epoch'
  | 'debug_trace_id'
  | 'runtime_generation'
>;

interface BaileysReadyConfirmationContext {
  socket: WASocket;
  socketId: number;
  epoch: number;
  source: BaileysReadyConfirmationSource;
  connectionAttemptId?: string;
  runtimeGeneration?: number;
  debugTraceId?: string;
}

interface BaileysReadyConfirmationFlight {
  socket: WASocket;
  socketId: number;
  epoch: number;
  promise: Promise<IBaileysConnectionState>;
}

const TERMINAL_WORKER_STATUS_ERROR_REASONS = [
  'runtime_generation_stale',
  'runtime_generation_mismatch',
  'runtime_generation_missing',
  'runtime_container_mismatch',
  'runtime_worker_type_mismatch',
  'worker_state_changed_or_lifecycle_started',
  'lifecycle_operation_pending',
  'stale_runtime',
  'worker_runtime_status_rejected:stale',
  'worker_runtime_status_rejected:invalid',
] as const;
const RECOVERABLE_WORKER_STATUS_ERROR_REASONS = [
  'kafka_consumers_not_ready',
  'online_without_session_ready',
  'runtime_health_probe_failed',
  'worker_snapshot_unavailable',
] as const;
const RECOVERABLE_NETWORK_ERROR_REASONS = [
  'econnrefused',
  'econnreset',
  'enotfound',
  'etimedout',
  'ehostunreach',
  'socket hang up',
  'no connection established',
  'name resolution',
  'failed to connect',
  'connection closed',
  'network',
  'transport',
  'timeout',
  'deadline',
] as const;

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

function resolveBaileysBrowser(): BaileysBrowser {
  return Browsers.macOS(BAILEYS_BROWSER_NAME) as BaileysBrowser;
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

function isKafkaConsumerReadinessPending(error: unknown): boolean {
  const message = getErrorMessage(error);
  return (
    message.startsWith('kafka_consumers_not_ready:') ||
    message === 'baileys_provider_became_unavailable_during_consumer_startup' ||
    (message.startsWith('baileys_kafka_consumer_start_failed:') &&
      message.endsWith(':code=provider_unavailable'))
  );
}

function getGrpcErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === 'number' && Number.isInteger(code) ? code : undefined;
}

function getWorkerStatusErrorSearchText(error: unknown): string {
  const message = getErrorMessage(error);
  if (!error || typeof error !== 'object' || !('details' in error)) {
    return message.toLowerCase();
  }

  const details = (error as { details?: unknown }).details;
  return `${message} ${typeof details === 'string' ? details : ''}`.toLowerCase();
}

function classifyWorkerStatusNotificationFailure(
  error: unknown
): Extract<WorkerStatusNotificationResult, { outcome: 'failed' }> {
  const searchText = getWorkerStatusErrorSearchText(error);
  const grpcCode = getGrpcErrorCode(error);
  const terminalReason = TERMINAL_WORKER_STATUS_ERROR_REASONS.find((fragment) =>
    searchText.includes(fragment)
  );

  if (terminalReason) {
    return {
      outcome: 'failed',
      classification: 'terminal',
      reason: terminalReason,
      grpcCode,
    };
  }

  const recoverableReason = RECOVERABLE_WORKER_STATUS_ERROR_REASONS.find(
    (fragment) => searchText.includes(fragment)
  );
  if (recoverableReason) {
    return {
      outcome: 'failed',
      classification: 'recoverable',
      reason: recoverableReason,
      grpcCode,
    };
  }

  if (
    grpcCode === GrpcStatus.INVALID_ARGUMENT ||
    grpcCode === GrpcStatus.NOT_FOUND ||
    grpcCode === GrpcStatus.PERMISSION_DENIED ||
    grpcCode === GrpcStatus.FAILED_PRECONDITION ||
    grpcCode === GrpcStatus.UNIMPLEMENTED ||
    grpcCode === GrpcStatus.UNAUTHENTICATED
  ) {
    return {
      outcome: 'failed',
      classification: 'terminal',
      reason: `worker_status_grpc_rejected:${grpcCode}`,
      grpcCode,
    };
  }

  const networkReason = RECOVERABLE_NETWORK_ERROR_REASONS.find((fragment) =>
    searchText.includes(fragment)
  );
  if (
    grpcCode === GrpcStatus.UNAVAILABLE ||
    grpcCode === GrpcStatus.DEADLINE_EXCEEDED ||
    grpcCode === GrpcStatus.RESOURCE_EXHAUSTED ||
    networkReason
  ) {
    return {
      outcome: 'failed',
      classification: 'recoverable',
      reason:
        grpcCode !== undefined
          ? `worker_status_grpc_unavailable:${grpcCode}`
          : `worker_status_transport:${networkReason?.replaceAll(' ', '_')}`,
      grpcCode,
    };
  }

  // An unclassified client/transport exception is retried. Only explicit
  // lifecycle/fence rejections are allowed to revoke a healthy runtime.
  return {
    outcome: 'failed',
    classification: 'recoverable',
    reason: workerErrorFailureReason(
      'worker_status_notification_failed',
      error
    ),
    grpcCode,
  };
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
  private readonly maxQrGenerations = 5;

  private socket?: WASocket;
  private postgresAuthStore?: BaileysPostgresAuthStateStore;
  private legacyVolumeMigrationBootstrapped = false;
  private postgresRestorableSessionRetained = false;
  private postgresLeaseRecoveryRequired = false;
  private postgresLeaseRecoveryGeneration = 0;
  private postgresLeaseRecoveryResumeGeneration: number | undefined;
  private readonly postgresSessionLeaseLostListeners =
    new Set<BaileysSessionLeaseLostListener>();
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
  private runtimeFenceConnectionAuthorization?: IWhatsappRuntimeFenceConnectionAuthorization;
  private runtimeFenceConnectionAuthorizationTransition: Promise<void> =
    Promise.resolve();
  private connectionSetupTransition: Promise<void> = Promise.resolve();
  private runtimeGeneration?: number = baileysEnvironment.runtimeGeneration;
  private debugTraceId?: string = undefined;
  private connectionAttemptStartedAtMs = 0;

  private connecting = false;
  private retryCount = 0;
  private qrGenerationCount = 0;
  private qrReadSessionActive = false;
  private qrReadSessionLocked = false;
  private qrLifecycleReconnectAuthorized = false;
  private currentPromise?: Promise<IBaileysConnectionState>;
  private pendingResolve?: (s: IBaileysConnectionState) => void;
  private connectionEstablished = false;
  private centralOnlineAcknowledged = false;
  private userRequestedDisconnect = false;
  private disconnectFlight: Promise<void> | undefined;
  private disconnectFlightRemovesSession = false;
  private explicitSessionRemovalInFlight = false;
  private explicitSessionRemovalFlight: Promise<void> | undefined;
  private explicitSessionRemovalSocketId: number | undefined;
  private sessionClearFlight: Promise<void> | undefined;
  private deviceRemovedConfirmationPending = false;
  private activeProxyUrl: string | null = null;
  private activeProxyAgent?: HttpsAgent;
  private reconnectRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectRetryFlight: Promise<void> | undefined;
  private qrRenewalTimer: ReturnType<typeof setTimeout> | undefined;
  private transientDisconnectStatusTimer:
    ReturnType<typeof setTimeout> | undefined;
  private transientDisconnectStatusGeneration = 0;
  private kafkaReadinessRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private kafkaReadinessRetryFlight: Promise<void> | undefined;
  private kafkaReadinessRetryGeneration = 0;
  private readyConfirmationEpoch = 0;
  private readyConfirmationFlight: BaileysReadyConfirmationFlight | undefined;
  private kafkaReadinessGateFlight:
    | {
        socket: WASocket | undefined;
        socketId: number;
        epoch: number;
        promise: Promise<void>;
      }
    | undefined;
  private outboundSendFailureScope: WASocket | undefined;
  private consecutiveOutboundSendFailures = 0;
  private outboundSendRecoveryFlight: Promise<void> | undefined;
  private outboundSendRecoveryScope: WASocket | undefined;
  private outboundSendRecoveryRetryTimer:
    ReturnType<typeof setTimeout> | undefined;
  private outboundSendRecoveryAttempts = 0;
  private outboundSendRecoveryExhaustedScope: WASocket | undefined;
  private readonly outboundSendRecoveryRetryDelaysMs = [250, 1000] as const;
  private readonly providerLifecycleInvocationFence =
    new ProviderInvocationSingleFlight();
  private readonly PROVIDER_LIFECYCLE_TIMEOUT_MS =
    resolveProviderAuxiliaryTimeoutMs();
  private providerHandoffKey: string | undefined;
  private providerHandoffFlight:
    Promise<IPrepareProviderHandoffResponseProto> | undefined;
  private providerHandoffResult:
    IPrepareProviderHandoffResponseProto | undefined;
  private sessionStorageMigrationId: string | undefined;
  private sessionStorageMigrationPhone: string | undefined;
  private sessionStorageMigrationResult:
    IPrepareSessionStorageMigrationResponseProto | undefined;
  private pendingProviderHandoffCompletion:
    PendingBaileysProviderHandoffCompletion | undefined;
  private nativeConnectionStatus?: IWhatsappConnectionStatus;
  private nativeConnectionStatusSource?: object;
  private nativeConnectionStatusSourceId?: string;
  private credentialPersistenceBarrier?: BaileysCredentialPersistenceBarrier;
  private readonly nativeConnectionStatusListeners = new Set<
    (snapshot: IWhatsappConnectionStatus) => void
  >();
  private readonly nativeConnectionStatusPersistenceQueue: NativeConnectionStatusPersistenceQueue<BaileysNativeConnectionStatusPersistencePayload>;

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
    private readonly healthCheckService: BaileysHealthCheckService,
    @inject('Redis') private readonly redis: Redis,
    @inject(ConnectionLifecycleDebugService)
    private readonly connectionLifecycleDebugService: ConnectionLifecycleDebugService = {
      log: async () => undefined,
    } as unknown as ConnectionLifecycleDebugService
  ) {
    this.nativeConnectionStatusPersistenceQueue =
      new NativeConnectionStatusPersistenceQueue({
        publish: async (item) => {
          await this.balanceWorkerStatusGrpcClientService.publishWorkerRuntimeEvent(
            item.payload.state,
            {
              eventId: item.eventId,
              connectionStatusLeaseProof: item.payload.leaseProof,
            }
          );
        },
        onFailure: (failure) =>
          this.logNativeConnectionStatusPersistenceFailure(failure),
      });
    setWorkerKafkaDispatchAuthorized(false);
    this.baileysIncomingMessageService.configureAuxiliaryProviderFailureRecovery?.(
      (socket, error, options) => {
        const recoveryStarted = this.reportOutboundSendFailure(
          socket,
          error,
          options
        );
        if (options.timedOut && recoveryStarted !== true) {
          this.ensureOutboundSendRecovery(socket);
        }
      }
    );
    this.configureHealthCheck();
  }

  private logDebug(
    event: string,
    context: ConnectionLifecycleDebugContext
  ): void {
    logConnectionFlowConsole(event, context);
    void this.connectionLifecycleDebugService.log(event, context);
    logLocalConnectionStatus(event, context);
  }

  private configureHealthCheck(): void {
    this.healthCheckService.configure({
      getSocket: () => this.socket,
      getStatus: () => this.status,
      getCode: () => this.code,
      reconnect: (input) => this.reconnect(input),
      isConnected: () => this.connected,
      prepareSession: () => this.prepareSessionBootstrap(),
      hasSession: () => this.hasSession(),
      isIncomingBound: (socket) =>
        this.baileysIncomingMessageService.isBoundTo(socket),
      getRuntimeFenceIdentity: () =>
        this.baileysIncomingMessageService.getActiveRuntimeFenceIdentity(),
      onStatusMismatch: (detectedStatus, workerStatus) => {
        this.handleHealthCheckMismatch(detectedStatus, workerStatus);
      },
      onProviderProbeTimeout: (socket, error) => {
        const recoveryStarted = this.reportOutboundSendFailure(socket, error, {
          timedOut: true,
        });
        if (recoveryStarted !== true) {
          this.ensureOutboundSendRecovery(socket);
        }
      },
    });
  }

  private async prepareSessionBootstrap(): Promise<boolean> {
    try {
      await this.resolveRuntimeFenceConnectionAuthorization({
        initial_connection: true,
        requested_by_user: false,
        from_disconnect_restart: true,
        runtime_generation: baileysEnvironment.runtimeGeneration,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('worker_runtime_fence_rejected')
      ) {
        // A same-generation disconnect tombstone deliberately rejects the
        // bootstrap epoch. Keep the worker/health/QR control plane alive, but
        // do not inspect or open the auth store until a pending QR grant is
        // supplied by the manager.
        return false;
      }
      throw error;
    }
    await this.refreshPersistedSessionState();
    return true;
  }

  private handleHealthCheckMismatch(
    detectedStatus: Status,
    workerStatus: EWorkerStatus
  ): void {
    if (
      this.connectionEstablished &&
      (detectedStatus !== Status.connected ||
        workerStatus !== EWorkerStatus.online)
    ) {
      const socketReference = this.socket as unknown as {
        ws?: { isOpen?: boolean };
      };
      const wsClientIsOpen = socketReference.ws?.isOpen === true;
      const wsReadyState = this.resolveWebSocket()?.readyState;

      if (
        detectedStatus === Status.disconnected &&
        workerStatus === EWorkerStatus.offline &&
        (wsClientIsOpen || wsReadyState === 1)
      ) {
        console.warn(
          '[BaileysConnection] Health check mismatch ignored: socket still OPEN'
        );
        this.scheduleKafkaReadinessRetry(this.socket, this.socketId);
        return;
      }

      this.invalidateReadyConfirmation();
      this.setCentralOnlineAcknowledged(false);
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

  hasCentralOnlineAcknowledgement(): boolean {
    return this.centralOnlineAcknowledged;
  }

  getStatus(): Status {
    return this.status;
  }

  getConnectionStatus(): IWhatsappConnectionStatus | undefined {
    const source = this.socket as unknown as
      BaileysNativeConnectionStatusSource | undefined;
    if (source && typeof source.getConnectionStatus === 'function') {
      this.acceptNativeConnectionStatus(
        source,
        source.getConnectionStatus(),
        false
      );
    }
    return this.nativeConnectionStatus
      ? { ...this.nativeConnectionStatus }
      : undefined;
  }

  onConnectionStatus(
    listener: (snapshot: IWhatsappConnectionStatus) => void
  ): () => void {
    this.nativeConnectionStatusListeners.add(listener);
    const current = this.getConnectionStatus();
    if (current) listener(current);
    return () => this.nativeConnectionStatusListeners.delete(listener);
  }

  onSessionLeaseLost(listener: BaileysSessionLeaseLostListener): () => void {
    this.postgresSessionLeaseLostListeners.add(listener);
    return () => this.postgresSessionLeaseLostListeners.delete(listener);
  }

  beginSessionLeaseRecoveryResume(): number | undefined {
    if (!this.postgresLeaseRecoveryRequired) {
      return undefined;
    }
    this.postgresLeaseRecoveryResumeGeneration =
      this.postgresLeaseRecoveryGeneration;
    return this.postgresLeaseRecoveryGeneration;
  }

  markSessionLeaseRecoveryCompleted(generation?: number): boolean {
    if (generation === undefined) {
      return !this.postgresLeaseRecoveryRequired;
    }
    if (
      !this.postgresLeaseRecoveryRequired ||
      generation !== this.postgresLeaseRecoveryGeneration ||
      this.postgresLeaseRecoveryResumeGeneration !== generation ||
      !this.postgresAuthStore?.getConnectionStatusLeaseProof()
    ) {
      return false;
    }
    this.postgresLeaseRecoveryRequired = false;
    this.postgresLeaseRecoveryResumeGeneration = undefined;
    return true;
  }

  abortSessionLeaseRecoveryResume(generation?: number): void {
    if (this.postgresLeaseRecoveryResumeGeneration === generation) {
      this.postgresLeaseRecoveryResumeGeneration = undefined;
    }
  }

  getConnectionStatusSourceId(): string | undefined {
    return this.nativeConnectionStatusSourceId;
  }

  getConnectionStatusHealthEvidence(): BaileysConnectionStatusHealthEvidence {
    const source = this.socket as unknown as
      BaileysNativeConnectionStatusSource | undefined;
    const connectionStatusSourceId = normalizeWhatsappConnectionStatusSourceId(
      this.nativeConnectionStatusSourceId
    );
    const sourceCurrent = Boolean(
      source &&
      this.nativeConnectionStatusSource === (source as unknown as object) &&
      connectionStatusSourceId &&
      typeof source.getConnectionStatus === 'function'
    );
    const connectionStatus = sourceCurrent
      ? normalizeWhatsappConnectionStatus(
          source?.getConnectionStatus(),
          'baileys'
        )
      : undefined;
    if (source && connectionStatus) {
      this.acceptNativeConnectionStatus(source, connectionStatus, false);
    }
    const leaseRequired = usesPostgresSessionStorage();
    const leaseProofValid =
      !leaseRequired ||
      Boolean(this.postgresAuthStore?.getConnectionStatusLeaseProof());

    if (
      !sourceCurrent ||
      !isWhatsappConnectionOnline(connectionStatus) ||
      !leaseProofValid
    ) {
      this.setCentralOnlineAcknowledged(false);
    }

    return {
      connectionStatus,
      connectionStatusSourceId,
      sourceCurrent,
      leaseRequired,
      leaseProofValid,
      sessionStorage: getSessionStorage(),
      sessionRevisionId: this.postgresAuthStore?.getRevisionIdCached(),
      sessionStorageMigrationId:
        process.env.SESSION_STORAGE_MIGRATION_ID?.trim() || undefined,
    };
  }

  getCode(): ECodeMessage {
    return this.code;
  }

  getSocket(): WASocket | undefined {
    return this.socket;
  }

  canRecoverRestorableSession(): boolean {
    if (
      !this.initialConnection ||
      this.userRequestedDisconnect ||
      !this.hasSession()
    ) {
      return false;
    }

    return !this.isTerminalSessionDisconnectCode(this.code);
  }

  ensureRestorableSessionRecovery(source: string): boolean {
    if (
      !this.canRecoverRestorableSession() ||
      this.postgresLeaseRecoveryRequired ||
      this.reconnectRetryTimer
    ) {
      return false;
    }

    const socket = this.socket;
    if (socket) {
      const ws = this.resolveWebSocket();
      const socketReference = socket as unknown as {
        ws?: {
          isOpen?: boolean;
          isConnecting?: boolean;
          isClosing?: boolean;
          isClosed?: boolean;
        };
      };
      if (
        socketReference.ws?.isOpen === true ||
        socketReference.ws?.isConnecting === true ||
        ws?.readyState === 0 ||
        ws?.readyState === 1
      ) {
        return false;
      }

      const isDefinitelyClosingOrClosed =
        socketReference.ws?.isClosing === true ||
        socketReference.ws?.isClosed === true ||
        ws?.readyState === 2 ||
        ws?.readyState === 3;
      if (!isDefinitelyClosingOrClosed) {
        return false;
      }

      this.cancelAttempt(false);
    } else if (this.connecting || this.currentPromise) {
      /*
       * Socket creation runs before `currentPromise` is installed. Do not
       * start a second creation flight merely because the socket reference is
       * not available yet.
       */
      return false;
    }

    this.invalidateReadyConfirmation();
    this.connectionEstablished = false;
    this.setCentralOnlineAcknowledged(false);
    this.setStatus(Status.disconnected, ECodeMessage.connectionLost);
    this.logDebug('baileys.provider.local_recovery_scheduled', {
      trace_id: this.debugTraceId,
      layer: 'baileys',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.baileys,
      connection_attempt_id: this.connectionAttemptId,
      runtime_generation: this.runtimeGeneration,
      status: this.status,
      code: this.code,
      reason: source,
      has_session: true,
    });
    this.scheduleNextReconnectAttempt();
    return this.reconnectRetryTimer !== undefined;
  }

  reportOutboundSendSuccess(socket: WASocket): void {
    if (this.socket !== socket) {
      return;
    }
    if (this.outboundSendRecoveryScope !== socket) {
      this.resetOutboundSendRecoveryState(socket);
    }
    this.outboundSendFailureScope = socket;
    this.consecutiveOutboundSendFailures = 0;
  }

  reportOutboundSendFailure(
    socket: WASocket,
    error: unknown,
    options: { timedOut?: boolean } = {}
  ): boolean {
    if (this.socket !== socket || this.userRequestedDisconnect) {
      return false;
    }
    if (this.outboundSendFailureScope !== socket) {
      this.outboundSendFailureScope = socket;
      this.consecutiveOutboundSendFailures = 0;
    }

    const failure = classifyBaileysProviderOperationFailure(error);
    const socketRecoveryEligible =
      failure.kind === 'transport' || failure.kind === 'protocol';
    if (options.timedOut !== true && !socketRecoveryEligible) {
      // Only consecutive, objectively classified transport/protocol failures
      // may recover the socket. Session-terminal events are handled by the
      // authoritative connection.update lifecycle instead.
      this.consecutiveOutboundSendFailures = 0;
      console.warn('[BaileysConnection] outbound_non_transport_failure', {
        failure_kind: failure.kind,
        failure_reason: failure.reason,
        provider_status_code: failure.statusCode,
        socket_recovery_eligible: false,
        ...workerErrorDiagnostics(error),
      });
      return false;
    }

    this.consecutiveOutboundSendFailures += 1;
    console.warn('[BaileysConnection] outbound_send_failure', {
      consecutive_failures: this.consecutiveOutboundSendFailures,
      timed_out: options.timedOut === true,
      failure_kind: failure.kind,
      failure_reason: failure.reason,
      provider_status_code: failure.statusCode,
      socket_recovery_eligible: true,
      ...workerErrorDiagnostics(error),
    });

    if (
      options.timedOut === true ||
      this.consecutiveOutboundSendFailures >= 3
    ) {
      this.startOutboundSendRecovery();
      return true;
    }

    return false;
  }

  ensureOutboundSendRecovery(socket: WASocket): void {
    if (this.socket !== socket || this.userRequestedDisconnect) {
      return;
    }
    this.startOutboundSendRecovery(socket);
  }

  private startOutboundSendRecovery(socket = this.socket): void {
    if (
      !socket ||
      this.outboundSendRecoveryExhaustedScope === socket ||
      this.outboundSendRecoveryFlight ||
      this.outboundSendRecoveryRetryTimer ||
      this.userRequestedDisconnect ||
      (this.socket !== undefined && this.socket !== socket)
    ) {
      return;
    }

    if (this.outboundSendRecoveryScope !== socket) {
      this.resetOutboundSendRecoveryState(socket);
    }
    const attempt = this.outboundSendRecoveryAttempts + 1;
    this.outboundSendRecoveryAttempts = attempt;
    let recoveryError: unknown;
    let recovery: Promise<void>;
    recovery = this.recoverFromOutboundSendFailure(socket)
      .catch((error) => {
        recoveryError = error;
        console.error('[BaileysConnection] outbound_send_recovery_failed', {
          attempt,
          max_attempts: this.outboundSendRecoveryRetryDelaysMs.length + 1,
          error: this.errorMessage(error),
        });
      })
      .finally(() => {
        if (this.outboundSendRecoveryFlight === recovery) {
          this.outboundSendRecoveryFlight = undefined;
        }
        if (
          recoveryError !== undefined &&
          this.outboundSendRecoveryScope === socket &&
          !this.userRequestedDisconnect &&
          (this.socket === undefined || this.socket === socket)
        ) {
          this.scheduleOutboundSendRecoveryRetry(socket, attempt);
        }
      });
    this.outboundSendRecoveryFlight = recovery;
  }

  private scheduleOutboundSendRecoveryRetry(
    socket: WASocket,
    completedAttempt: number
  ): void {
    const delayMs =
      this.outboundSendRecoveryRetryDelaysMs[completedAttempt - 1];
    if (delayMs === undefined) {
      this.outboundSendRecoveryExhaustedScope = socket;
      this.forceOutboundSendRecoveryFallback(socket);
      return;
    }
    if (
      this.outboundSendRecoveryRetryTimer ||
      this.outboundSendRecoveryScope !== socket
    ) {
      return;
    }

    this.outboundSendRecoveryRetryTimer = setTimeout(() => {
      this.outboundSendRecoveryRetryTimer = undefined;
      if (
        this.outboundSendRecoveryScope === socket &&
        !this.userRequestedDisconnect &&
        (this.socket === undefined || this.socket === socket)
      ) {
        this.startOutboundSendRecovery(socket);
      }
    }, delayMs);
    this.outboundSendRecoveryRetryTimer.unref?.();
  }

  private forceOutboundSendRecoveryFallback(socket: WASocket): void {
    if (
      this.outboundSendRecoveryScope !== socket ||
      this.userRequestedDisconnect ||
      (this.socket !== undefined && this.socket !== socket)
    ) {
      return;
    }

    console.error('[BaileysConnection] outbound_send_recovery_exhausted', {
      attempts: this.outboundSendRecoveryAttempts,
      action: 'force_runtime_reconnect',
    });
    this.initialConnection = true;
    try {
      this.cancelAttempt(false);
    } catch (error) {
      console.error(
        '[BaileysConnection] outbound_send_recovery_force_close_failed',
        {
          error: this.errorMessage(error),
        }
      );
    }
    this.setStatus(Status.disconnected, ECodeMessage.connectionLost);
    this.scheduleNextReconnectAttempt();
  }

  private resetOutboundSendRecoveryState(socket: WASocket): void {
    if (this.outboundSendRecoveryRetryTimer) {
      clearTimeout(this.outboundSendRecoveryRetryTimer);
      this.outboundSendRecoveryRetryTimer = undefined;
    }
    this.outboundSendRecoveryScope = socket;
    this.outboundSendRecoveryAttempts = 0;
    this.outboundSendRecoveryExhaustedScope = undefined;
  }

  private async recoverFromOutboundSendFailure(
    socket = this.socket
  ): Promise<void> {
    if (
      !socket ||
      this.userRequestedDisconnect ||
      (this.socket !== undefined && this.socket !== socket)
    ) {
      return;
    }

    this.baileysIncomingMessageService.markConnectionUnavailable(socket);
    this.invalidateReadyConfirmation();
    this.connectionEstablished = false;
    this.setCentralOnlineAcknowledged(false);
    this.setStatus(Status.connecting, ECodeMessage.connectionLost);
    const payload: IBaileysConnectionState = {
      status: Status.connecting,
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.baileys,
      code: ECodeMessage.connectionLost,
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: this.connectionAttemptId,
      runtime_generation: this.runtimeGeneration,
      debug_trace_id: this.debugTraceId,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: Boolean(socket.user?.id),
      provider_state: 'outbound_send_failed',
      degraded_reason: 'outbound_send_failed',
    };

    await this.healthCheckService
      .notifyDisconnected('outbound_send_failed', {
        workerStatus: EWorkerStatus.disponible,
        detectedStatus: Status.connecting,
        providerState: 'outbound_send_failed',
        publishStatus: false,
      })
      .catch(() => undefined);
    this.publishSub(payload, true);
    void this.notifyWorkerStatusSafely(payload, 'outbound_send_failed');

    await this.disconnect({
      initial_connection: true,
      disconnected_user: false,
      preserve_session: true,
      connection_attempt_id: this.connectionAttemptId,
      runtime_generation: this.runtimeGeneration,
      debug_trace_id: this.debugTraceId,
    });
  }

  private async invokeProviderLifecycleOperation<T>(
    socket: WASocket,
    operation: string,
    invoke: () => Promise<T>,
    recoverOnTimeout: boolean
  ): Promise<T> {
    const lease = this.providerLifecycleInvocationFence.acquire(socket);
    if (!lease) {
      const stalled = this.providerLifecycleInvocationFence.isStalled(socket);
      if (recoverOnTimeout && stalled) {
        this.ensureOutboundSendRecovery(socket);
      }
      throw new ProviderInvocationInFlightError(
        stalled ? 'stalled' : 'capacity'
      );
    }

    const providerCall = lease.start(invoke);
    try {
      return await invokeProviderAuxiliaryWithTimeout({
        provider: 'baileys',
        operation: `connection_${operation}`,
        timeoutMs: this.PROVIDER_LIFECYCLE_TIMEOUT_MS,
        invoke: () => providerCall,
      });
    } catch (error) {
      if (error instanceof ProviderAuxiliaryInvocationTimeoutError) {
        lease.markStalled();
        if (recoverOnTimeout) {
          this.ensureOutboundSendRecovery(socket);
        }
      }
      throw error;
    }
  }

  async sendPasskeyResponse(input: {
    worker_id?: string;
    account_id?: string;
    connection_attempt_id?: string;
    passkey_response: string;
    debug_trace_id?: string;
  }): Promise<IBaileysConnectionState> {
    this.debugTraceId = input.debug_trace_id ?? this.debugTraceId;
    this.logDebug('baileys.provider.passkey_response.received', {
      trace_id: this.debugTraceId,
      layer: 'baileys',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.baileys,
      connection_attempt_id: input.connection_attempt_id,
      active_connection_attempt_id: this.connectionAttemptId,
      status: this.status,
      code: this.code,
      has_socket: Boolean(this.socket),
      socket_supports_passkey_response: Boolean(
        (this.socket as PasskeyCapableSocket | undefined)?.sendPasskeyResponse
      ),
      has_passkey_response: input.passkey_response.length > 0,
      passkey_response_len: input.passkey_response.length,
    });
    this.assertPasskeyRequestContext(input);

    const socket = this.socket as PasskeyCapableSocket | undefined;
    const sendPasskeyResponse = socket?.sendPasskeyResponse?.bind(socket);
    if (!socket || !sendPasskeyResponse) {
      throw new Error('Baileys socket does not support passkey response');
    }

    await this.invokeProviderLifecycleOperation(
      socket,
      'passkey_response',
      () => sendPasskeyResponse(input.passkey_response),
      true
    );
    this.logDebug('baileys.provider.passkey_response.sent_to_socket', {
      trace_id: this.debugTraceId,
      layer: 'baileys',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.baileys,
      connection_attempt_id: input.connection_attempt_id,
      active_connection_attempt_id: this.connectionAttemptId,
      status: this.status,
      code: this.code,
    });
    this.setStatus(Status.connecting, ECodeMessage.pairingInProgress);

    const payload = this.state(undefined, undefined, {
      worker_status_id: EWorkerStatus.disponible,
      reason: 'passkey_response_sent',
    });
    this.publishSub(payload, true);
    void this.notifyWorkerStatusSafely(payload, 'passkey_response_sent');
    return payload;
  }

  async confirmPasskey(input: {
    worker_id?: string;
    account_id?: string;
    connection_attempt_id?: string;
    debug_trace_id?: string;
  }): Promise<IBaileysConnectionState> {
    this.debugTraceId = input.debug_trace_id ?? this.debugTraceId;
    this.logDebug('baileys.provider.passkey_confirmation.received', {
      trace_id: this.debugTraceId,
      layer: 'baileys',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.baileys,
      connection_attempt_id: input.connection_attempt_id,
      active_connection_attempt_id: this.connectionAttemptId,
      status: this.status,
      code: this.code,
      has_socket: Boolean(this.socket),
      socket_supports_passkey_confirmation: Boolean(
        (this.socket as PasskeyCapableSocket | undefined)?.confirmPasskey
      ),
    });
    this.assertPasskeyRequestContext(input);

    const socket = this.socket as PasskeyCapableSocket | undefined;
    const confirmPasskey = socket?.confirmPasskey?.bind(socket);
    if (!socket || !confirmPasskey) {
      throw new Error('Baileys socket does not support passkey confirmation');
    }

    await this.invokeProviderLifecycleOperation(
      socket,
      'passkey_confirmation',
      () => confirmPasskey(),
      true
    );
    this.logDebug('baileys.provider.passkey_confirmation.sent_to_socket', {
      trace_id: this.debugTraceId,
      layer: 'baileys',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.baileys,
      connection_attempt_id: input.connection_attempt_id,
      active_connection_attempt_id: this.connectionAttemptId,
      status: this.status,
      code: this.code,
    });
    this.setStatus(Status.connecting, ECodeMessage.pairingInProgress);

    const payload = this.state(undefined, undefined, {
      worker_status_id: EWorkerStatus.disponible,
      reason: 'passkey_confirmation_sent',
    });
    this.publishSub(payload, true);
    void this.notifyWorkerStatusSafely(payload, 'passkey_confirmation_sent');
    return payload;
  }

  async importSecureSession(
    input: ISecureConnectionImportRequest
  ): Promise<IBaileysConnectionState> {
    let stagedPostgresRevision: BaileysStagedSessionRevision | undefined;
    this.debugTraceId = input.debug_trace_id ?? this.debugTraceId;
    this.connectionAttemptId =
      input.connection_attempt_id ?? this.connectionAttemptId;
    this.runtimeGeneration = input.runtime_generation ?? this.runtimeGeneration;

    this.logDebug('baileys.provider.secure_session_import.received', {
      trace_id: input.debug_trace_id,
      layer: 'baileys',
      worker_id: input.worker_id || getWorker(),
      account_id: input.account_id || getAccount(),
      worker_type_id: EWorkerType.baileys,
      connection_attempt_id: input.connection_attempt_id,
      runtime_generation: input.runtime_generation,
      format_version: input.format_version,
      target_provider: input.target_provider,
      has_payload_ref: Boolean(input.payload_ref),
      has_payload_json: Boolean(input.payload_json),
    });

    try {
      this.assertSecureSessionImportContext(input);
      const sessionPackage = await this.resolveSecureSessionPackage(input);
      const payloadSummary =
        this.summarizeBaileysSecureSessionPayload(sessionPackage);

      this.logDebug('baileys.provider.secure_session_import.payload_resolved', {
        trace_id: input.debug_trace_id,
        layer: 'baileys',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.baileys,
        connection_attempt_id: input.connection_attempt_id,
        runtime_generation: input.runtime_generation,
        format_version: sessionPackage.format_version,
        target_provider: sessionPackage.target_provider,
        ...payloadSummary,
      });

      if (input.authorized_connection_epoch) {
        // A removed session leaves a durable tombstone for the old
        // connection epoch. Consume the manager's one-shot replacement grant
        // before getPostgresAuthStore() can open or write a fresh revision.
        await this.resolveRuntimeFenceConnectionAuthorization({
          initial_connection: true,
          requested_by_user: true,
          type: EBaileysConnectionType.qrcode,
          connection_attempt_id: input.connection_attempt_id,
          authorized_connection_epoch: input.authorized_connection_epoch,
          debug_trace_id: input.debug_trace_id,
          runtime_generation: input.runtime_generation,
        });
      }

      this.healthCheckService.stop();
      this.clearReconnectRetryTimer();
      await this.safeLogout(false).catch(() => undefined);
      this.cancelAttempt(false);
      if (input.authorized_connection_epoch && usesPostgresSessionStorage()) {
        await this.resetPostgresAuthStoreForAuthorizedImport();
      }
      this.prepareFolder();

      let importedFileCount = 0;
      let backupCreated = false;
      if (usesPostgresSessionStorage()) {
        const records = normalizeSecureImportRecords(
          sessionPackage as WhatsAppWebSessionPackage
        );
        importedFileCount = records.length;
        const store = this.getPostgresAuthStore();
        stagedPostgresRevision = await store.stageImport(
          records,
          sessionPackage.format_version
        );
      } else {
        const result = await importWhatsAppWebSessionToMultiFileAuthState({
          folder: getFolder(),
          sessionPackage: sessionPackage as WhatsAppWebSessionPackage,
          overwrite: true,
          cleanupBackupOnSuccess: false,
        });
        importedFileCount = result.importedFiles.length;
        backupCreated = Boolean(result.backupFolder);
      }

      this.logDebug('baileys.provider.secure_session_import.files_imported', {
        trace_id: input.debug_trace_id,
        layer: 'baileys',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.baileys,
        connection_attempt_id: input.connection_attempt_id,
        runtime_generation: input.runtime_generation,
        imported_file_count: importedFileCount,
        backup_created: backupCreated,
        session_storage: getSessionStorage(),
        format_version: sessionPackage.format_version,
        account_hint_present: Boolean(sessionPackage.account_hint),
      });

      let connectedState = await this.connect({
        initial_connection: true,
        allow_restore: true,
        force_new: true,
        requested_by_user: true,
        type: EBaileysConnectionType.qrcode,
        connection_attempt_id: input.connection_attempt_id,
        authorized_connection_epoch: input.authorized_connection_epoch,
        debug_trace_id: input.debug_trace_id,
        runtime_generation: input.runtime_generation,
      });
      if (
        stagedPostgresRevision &&
        !this.isPostgresImportConnectionReady(connectedState)
      ) {
        connectedState = await this.awaitPostgresImportCandidateOutcome(
          stagedPostgresRevision,
          connectedState
        );
      }
      if (
        stagedPostgresRevision &&
        !this.isPostgresImportConnectionReady(connectedState) &&
        !this.isPostgresImportCandidatePromoted(stagedPostgresRevision)
      ) {
        const readinessFailure = [
          connectedState.error,
          connectedState.degraded_reason,
          connectedState.provider_state,
          connectedState.reason,
        ].find(
          (value): value is string =>
            typeof value === 'string' && value.trim().length > 0
        );
        throw new Error(
          readinessFailure ?? 'baileys_postgres_import_candidate_not_ready'
        );
      }
      return connectedState;
    } catch (error) {
      if (
        stagedPostgresRevision &&
        this.postgresAuthStore?.hasPendingHandoff() === true
      ) {
        await this.safeLogout(false).catch(() => undefined);
        this.cancelAttempt(false);
        try {
          await this.postgresAuthStore.rollbackImport(
            stagedPostgresRevision,
            this.normalizeSecureSessionImportErrorMessage(error)
          );
        } catch {
          return this.failSecureSessionImport(
            input,
            new Error('baileys_postgres_import_rollback_failed')
          );
        }
      }
      return this.failSecureSessionImport(input, error);
    }
  }

  private isPostgresImportConnectionReady(
    state: IBaileysConnectionState
  ): boolean {
    return state.status === Status.connected && state.session_ready !== false;
  }

  private isPostgresImportCandidatePromoted(
    candidate: BaileysStagedSessionRevision
  ): boolean {
    const revision = this.postgresAuthStore?.getRevisionInfoCached();
    return (
      revision?.revisionId === String(candidate.revisionId) &&
      revision.status === 'active'
    );
  }

  /**
   * A browser-session takeover may receive one or more recoverable 428 closes
   * while WhatsApp retires the browser transport. onClose already owns the
   * bounded provider reconnect policy; the secure-import request must join
   * that lifecycle instead of rolling its still-valid candidate back after
   * the first socket closes.
   */
  private async awaitPostgresImportCandidateOutcome(
    candidate: BaileysStagedSessionRevision,
    initialState: IBaileysConnectionState
  ): Promise<IBaileysConnectionState> {
    const startedAt = Date.now();
    const deadlineAt = startedAt + SECURE_IMPORT_RECOVERY_TIMEOUT_MS;
    let latestState = initialState;

    this.logDebug('baileys.provider.secure_session_import.recovery_wait', {
      trace_id: this.debugTraceId,
      layer: 'baileys',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.baileys,
      connection_attempt_id: this.connectionAttemptId,
      runtime_generation: this.runtimeGeneration,
      candidate_revision_id: candidate.revisionId,
      initial_status: initialState.status,
      initial_code: initialState.code,
      timeout_ms: SECURE_IMPORT_RECOVERY_TIMEOUT_MS,
    });

    while (Date.now() <= deadlineAt) {
      if (this.isPostgresImportConnectionReady(latestState)) {
        return latestState;
      }

      if (
        this.status === Status.connected &&
        this.connectionEstablished &&
        this.centralOnlineAcknowledged
      ) {
        latestState = await this.reportConnected();
        if (this.isPostgresImportConnectionReady(latestState)) {
          this.logDebug(
            'baileys.provider.secure_session_import.recovery_ready',
            {
              trace_id: this.debugTraceId,
              layer: 'baileys',
              worker_id: getWorker(),
              account_id: getAccount(),
              worker_type_id: EWorkerType.baileys,
              connection_attempt_id: this.connectionAttemptId,
              runtime_generation: this.runtimeGeneration,
              candidate_revision_id: candidate.revisionId,
              elapsed_ms: Date.now() - startedAt,
              retry_count: this.retryCount,
            }
          );
          return latestState;
        }
      }

      if (this.isPostgresImportCandidatePromoted(candidate)) {
        // Promotion is irreversible at this layer. The manager's existing
        // strong runtime-health window owns Kafka/central-ACK convergence.
        return latestState;
      }

      const candidatePending =
        this.postgresAuthStore?.hasPendingHandoff() === true;
      const terminal =
        this.userRequestedDisconnect ||
        this.isTerminalSessionDisconnectCode(this.code);
      const recoveryScheduled = Boolean(
        this.connecting ||
        this.currentPromise ||
        this.reconnectRetryTimer ||
        this.reconnectRetryFlight ||
        this.readyConfirmationFlight ||
        this.kafkaReadinessRetryTimer ||
        this.kafkaReadinessRetryFlight
      );

      if (!candidatePending || terminal || !recoveryScheduled) {
        return latestState;
      }

      const connectionFlight =
        this.readyConfirmationFlight?.promise ?? this.currentPromise;
      if (connectionFlight) {
        const poll = new Promise<void>((resolve) => {
          setTimeout(() => resolve(), SECURE_IMPORT_RECOVERY_POLL_MS);
        });
        const observed = await Promise.race([
          connectionFlight
            .then((state) => state)
            .catch((error) =>
              this.state(undefined, undefined, {
                error: getErrorMessage(error),
              })
            ),
          poll,
        ]);
        if (observed) {
          latestState = observed;
        }
      } else {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, SECURE_IMPORT_RECOVERY_POLL_MS);
        });
      }
    }

    this.logDebug('baileys.provider.secure_session_import.recovery_timeout', {
      trace_id: this.debugTraceId,
      layer: 'baileys',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.baileys,
      connection_attempt_id: this.connectionAttemptId,
      runtime_generation: this.runtimeGeneration,
      candidate_revision_id: candidate.revisionId,
      elapsed_ms: Date.now() - startedAt,
      retry_count: this.retryCount,
      status: this.status,
      code: this.code,
    });
    throw new Error('baileys_postgres_import_recovery_timeout');
  }

  private assertSecureSessionImportContext(
    input: ISecureConnectionImportRequest
  ): void {
    if (input.worker_id && input.worker_id !== getWorker()) {
      throw new Error('secure_session_worker_mismatch');
    }

    if (input.account_id && input.account_id !== getAccount()) {
      throw new Error('secure_session_account_mismatch');
    }

    if (input.source !== 'whatsapp_web') {
      throw new Error('secure_session_source_unsupported');
    }

    if (
      input.target_provider !== 'auto' &&
      input.target_provider !== 'baileys'
    ) {
      throw new Error('secure_session_target_provider_mismatch');
    }
  }

  private async resolveSecureSessionPackage(
    input: ISecureConnectionImportRequest
  ): Promise<ISecureConnectionSessionPackage> {
    const rawPayload = input.payload_json?.trim()
      ? input.payload_json
      : input.payload_ref
        ? await this.redis.get(input.payload_ref)
        : undefined;

    if (!rawPayload) {
      throw new Error('secure_session_payload_not_found');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawPayload);
    } catch {
      throw new Error('secure_session_payload_invalid_json');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('secure_session_payload_invalid');
    }

    const sessionPackage = parsed as ISecureConnectionSessionPackage;
    if (
      sessionPackage.source !== 'whatsapp_web' ||
      !sessionPackage.format_version
    ) {
      throw new Error('secure_session_package_invalid');
    }

    if (!sessionPackage.target_provider) {
      sessionPackage.target_provider = input.target_provider;
    }

    if (
      sessionPackage.target_provider !== 'auto' &&
      sessionPackage.target_provider !== 'baileys'
    ) {
      throw new Error('secure_session_target_provider_mismatch');
    }

    return sessionPackage;
  }

  private summarizeBaileysSecureSessionPayload(
    sessionPackage: ISecureConnectionSessionPackage
  ): Record<string, unknown> {
    const payload =
      sessionPackage.payload &&
      typeof sessionPackage.payload === 'object' &&
      !Array.isArray(sessionPackage.payload)
        ? (sessionPackage.payload as Record<string, unknown>)
        : {};
    const baileysPayload =
      payload.baileys_multi_file_auth_state &&
      typeof payload.baileys_multi_file_auth_state === 'object' &&
      !Array.isArray(payload.baileys_multi_file_auth_state)
        ? (payload.baileys_multi_file_auth_state as Record<string, unknown>)
        : undefined;
    const files =
      baileysPayload?.files &&
      typeof baileysPayload.files === 'object' &&
      !Array.isArray(baileysPayload.files)
        ? (baileysPayload.files as Record<string, unknown>)
        : payload.files &&
            typeof payload.files === 'object' &&
            !Array.isArray(payload.files)
          ? (payload.files as Record<string, unknown>)
          : undefined;

    return {
      has_baileys_multi_file_auth_state: Boolean(baileysPayload),
      auth_file_count: files ? Object.keys(files).length : 0,
      has_creds_json: Boolean(files?.['creds.json']),
      has_whatsapp_web_creds: Boolean(payload.whatsapp_web_creds),
      has_wwebjs_local_auth: Boolean(payload.wwebjs_local_auth),
      has_whatsmeow_sqlstore: Boolean(payload.whatsmeow_sqlstore),
    };
  }

  private failSecureSessionImport(
    input: ISecureConnectionImportRequest,
    error: unknown
  ): IBaileysConnectionState {
    const errorMessage = this.normalizeSecureSessionImportErrorMessage(
      error
    ).slice(0, 240);
    this.setStatus(Status.disconnected, ECodeMessage.badSession);
    this.connectionEstablished = false;
    this.connecting = false;

    const payload = this.state(undefined, undefined, {
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: input.connection_attempt_id,
      runtime_generation: input.runtime_generation,
      debug_trace_id: input.debug_trace_id,
      reason: 'secure_session_import_failed',
      error: errorMessage,
      session_ready: false,
      authenticated: false,
      can_send: false,
      can_receive_runtime: false,
    });

    this.logDebug('baileys.provider.secure_session_import.failed', {
      trace_id: input.debug_trace_id,
      layer: 'baileys',
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      worker_type_id: payload.worker_type_id,
      connection_attempt_id: input.connection_attempt_id,
      runtime_generation: input.runtime_generation,
      format_version: input.format_version,
      target_provider: input.target_provider,
      reason: errorMessage,
    });

    this.publishSub(payload, true);
    void this.notifyWorkerStatusSafely(payload, 'secure_session_import_failed');
    return payload;
  }

  private normalizeSecureSessionImportErrorMessage(error: unknown): string {
    const rawMessage = getErrorMessage(error);
    if (
      rawMessage === 'baileys_import_payload_unsupported' ||
      rawMessage === 'baileys_import_payload_missing' ||
      rawMessage === 'baileys_import_missing_creds_file'
    ) {
      return 'Baileys secure import requires payload.whatsapp_web_creds or payload.baileys_multi_file_auth_state.files with creds.json.';
    }

    if (
      rawMessage === 'baileys_import_missing_required_creds' ||
      rawMessage === 'baileys_import_missing_required_whatsapp_web_creds'
    ) {
      return 'Baileys secure import received credentials, but required key material is missing or invalid.';
    }

    return rawMessage;
  }

  clearUserRequestedDisconnect(): void {
    if (this.providerHandoffKey) {
      return;
    }
    this.userRequestedDisconnect = false;
  }

  private assertPasskeyRequestContext(input: {
    worker_id?: string;
    account_id?: string;
    connection_attempt_id?: string;
  }): void {
    if (input.worker_id && input.worker_id !== getWorker()) {
      throw new Error('Invalid worker for passkey request');
    }

    if (input.account_id && input.account_id !== getAccount()) {
      throw new Error('Invalid account for passkey request');
    }

    if (
      input.connection_attempt_id &&
      this.connectionAttemptId &&
      input.connection_attempt_id !== this.connectionAttemptId
    ) {
      throw new Error('Invalid connection attempt for passkey request');
    }
  }

  republishLastState(
    expectedConnectionAttemptId?: string
  ): IBaileysConnectionState | undefined {
    if (!this.lastPayload || !this.initialConnection) {
      return undefined;
    }

    try {
      const payload = JSON.parse(this.lastPayload) as IBaileysConnectionState;
      if (
        expectedConnectionAttemptId &&
        payload.connection_attempt_id !== expectedConnectionAttemptId
      ) {
        return undefined;
      }
      this.publishTelemetry(payload);
      return payload;
    } catch (error) {
      console.error('[BaileysConnection] Failed to parse lastPayload', {
        ...workerErrorDiagnostics(error),
      });
      return undefined;
    }
  }

  private clearReconnectRetryTimer(): void {
    if (!this.reconnectRetryTimer) {
      return;
    }

    clearTimeout(this.reconnectRetryTimer);
    this.reconnectRetryTimer = undefined;
  }

  private clearQrRenewalTimer(): void {
    if (!this.qrRenewalTimer) {
      return;
    }

    clearTimeout(this.qrRenewalTimer);
    this.qrRenewalTimer = undefined;
  }

  private scheduleQrRenewal(socketId: number, qrHash: string): void {
    this.clearQrRenewalTimer();
    this.qrRenewalTimer = setTimeout(() => {
      this.qrRenewalTimer = undefined;
      if (
        socketId !== this.socketId ||
        qrHash !== this.qrHash ||
        !this.isActiveQrReadSession()
      ) {
        return;
      }

      if (this.qrGenerationCount >= this.maxQrGenerations) {
        void this.handleQrGenerationLimitReached();
        return;
      }

      this.qrLifecycleReconnectAuthorized = true;
      this.retryCount = 0;
      this.logDebug('baileys.provider.qr_renewal_requested', {
        trace_id: this.debugTraceId,
        layer: 'baileys',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.baileys,
        connection_attempt_id: this.connectionAttemptId,
        attempt: this.qrGenerationCount,
        max_attempts: this.maxQrGenerations,
        renewal_timeout_ms: CONNECTION_QR_RENEWAL_TIMEOUT_MS,
      });
      this.setStatus(Status.connecting, ECodeMessage.awaitingReadQrCode);
      this.restartQrConnectionForRenewal();
    }, CONNECTION_QR_RENEWAL_TIMEOUT_MS);
    this.qrRenewalTimer.unref?.();
  }

  private restartQrConnectionForRenewal(): void {
    // A newly allocated Baileys socket can legitimately emit a QR whose
    // stable suffix matches the previous socket. Dedupe is only valid inside
    // one socket generation; carrying the hash across the forced renewal
    // makes the fresh QR invisible and leaves the UI waiting until the
    // transport eventually times out.
    this.qrHash = undefined;
    this.cancelAttempt(false);
    this.qrLifecycleReconnectAuthorized = true;
    void this.connect({
      initial_connection: this.initialConnection,
      from_disconnect_restart: true,
      force_new: true,
      requested_by_user: false,
      type: this.typeConnection,
      phone_connection: this.phoneConnection,
      connection_attempt_id: this.connectionAttemptId,
      debug_trace_id: this.debugTraceId,
      runtime_generation: this.runtimeGeneration,
    }).catch((error) => {
      this.logDebug('baileys.provider.qr_renewal_failed', {
        trace_id: this.debugTraceId,
        layer: 'baileys',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.baileys,
        connection_attempt_id: this.connectionAttemptId,
        runtime_generation: this.runtimeGeneration,
        reason: this.errorMessage(error),
      });
      this.scheduleNextReconnectAttempt(true);
    });
  }

  private cancelTransientDisconnectStatus(): void {
    this.transientDisconnectStatusGeneration += 1;
    if (!this.transientDisconnectStatusTimer) {
      return;
    }

    clearTimeout(this.transientDisconnectStatusTimer);
    this.transientDisconnectStatusTimer = undefined;
  }

  private scheduleTransientDisconnectStatus(
    payload: IBaileysConnectionState,
    context: string
  ): void {
    this.cancelTransientDisconnectStatus();
    const generation = this.transientDisconnectStatusGeneration;
    this.transientDisconnectStatusTimer = setTimeout(() => {
      this.transientDisconnectStatusTimer = undefined;
      if (
        generation !== this.transientDisconnectStatusGeneration ||
        this.connectionEstablished ||
        this.centralOnlineAcknowledged ||
        this.userRequestedDisconnect
      ) {
        return;
      }

      void this.notifyWorkerStatusSafely(payload, `${context}_after_debounce`);
    }, TRANSIENT_DISCONNECT_STATUS_DEBOUNCE_MS);
    this.transientDisconnectStatusTimer.unref?.();
  }

  private cancelKafkaReadinessRetry(): void {
    this.kafkaReadinessRetryGeneration += 1;
    if (!this.kafkaReadinessRetryTimer) {
      return;
    }

    clearTimeout(this.kafkaReadinessRetryTimer);
    this.kafkaReadinessRetryTimer = undefined;
  }

  private isCurrentSocketContext(
    socket: WASocket | undefined,
    socketId: number
  ): boolean {
    return (
      this.socket === socket &&
      this.socketId === socketId &&
      !this.userRequestedDisconnect
    );
  }

  private invalidateReadyConfirmation(): void {
    this.readyConfirmationEpoch += 1;
    this.readyConfirmationFlight = undefined;
  }

  private isCurrentReadyConfirmation(
    context: BaileysReadyConfirmationContext
  ): boolean {
    return (
      context.epoch === this.readyConfirmationEpoch &&
      this.isCurrentSocketContext(context.socket, context.socketId)
    );
  }

  private applyReadyConfirmationMetadata(
    input: BaileysConnectionMetadataInput
  ): void {
    if (this.centralOnlineAcknowledged) {
      return;
    }

    this.connectionAttemptId =
      input.connection_attempt_id ?? this.connectionAttemptId;
    this.runtimeGeneration = input.runtime_generation ?? this.runtimeGeneration;
    this.debugTraceId = input.debug_trace_id ?? this.debugTraceId;
  }

  private confirmReadyAndPublish(
    source: BaileysReadyConfirmationSource,
    input: BaileysConnectionMetadataInput = {}
  ): Promise<IBaileysConnectionState> {
    const socket = this.socket;
    if (!socket) {
      return Promise.resolve(this.state());
    }

    const socketId = this.socketId;
    const epoch = this.readyConfirmationEpoch;
    const existing = this.readyConfirmationFlight;
    if (
      existing?.socket === socket &&
      existing.socketId === socketId &&
      existing.epoch === epoch
    ) {
      return existing.promise;
    }

    if (source === 'verify') {
      this.applyReadyConfirmationMetadata(input);
    }

    const context: BaileysReadyConfirmationContext = {
      socket,
      socketId,
      epoch,
      source,
      connectionAttemptId: this.connectionAttemptId,
      runtimeGeneration: this.runtimeGeneration,
      debugTraceId: this.debugTraceId,
    };
    const promise = this.runReadyConfirmation(context);
    const flight = { socket, socketId, epoch, promise };
    this.readyConfirmationFlight = flight;
    const clearFlight = (): void => {
      if (this.readyConfirmationFlight === flight) {
        this.readyConfirmationFlight = undefined;
      }
    };
    void promise.then(clearFlight, clearFlight);
    return promise;
  }

  private waitForKafkaReadinessGate(
    socket: WASocket | undefined,
    socketId: number,
    epoch: number
  ): Promise<void> {
    const existing = this.kafkaReadinessGateFlight;
    if (
      existing &&
      existing.socket === socket &&
      existing.socketId === socketId &&
      existing.epoch === epoch
    ) {
      return existing.promise;
    }

    const promise = emitWorkerProviderRuntimeState('baileys', true);
    const flight = { socket, socketId, epoch, promise };
    this.kafkaReadinessGateFlight = flight;
    const clearFlight = (): void => {
      if (this.kafkaReadinessGateFlight === flight) {
        this.kafkaReadinessGateFlight = undefined;
      }
    };
    void promise.then(clearFlight, clearFlight);
    return promise;
  }

  private scheduleKafkaReadinessRetry(
    socket: WASocket | undefined,
    socketId: number
  ): void {
    if (
      !this.isCurrentSocketContext(socket, socketId) ||
      this.kafkaReadinessRetryTimer ||
      this.kafkaReadinessRetryFlight
    ) {
      return;
    }

    const generation = this.kafkaReadinessRetryGeneration;
    this.kafkaReadinessRetryTimer = setTimeout(() => {
      this.kafkaReadinessRetryTimer = undefined;
      if (
        generation !== this.kafkaReadinessRetryGeneration ||
        !this.isCurrentSocketContext(socket, socketId)
      ) {
        return;
      }

      let retryAgain = true;
      const flight = this.verifyAndPublishConnectionStatus({
        connection_attempt_id: this.connectionAttemptId,
        runtime_generation: this.runtimeGeneration,
        debug_trace_id: this.debugTraceId,
      })
        .then((payload) => {
          retryAgain = payload.worker_status_id !== EWorkerStatus.online;
        })
        .catch((error) => {
          console.error(
            '[BaileysConnection] Kafka readiness retry failed',
            error
          );
        })
        .finally(() => {
          if (this.kafkaReadinessRetryFlight === flight) {
            this.kafkaReadinessRetryFlight = undefined;
          }
          if (
            retryAgain &&
            generation === this.kafkaReadinessRetryGeneration &&
            this.isCurrentSocketContext(socket, socketId)
          ) {
            this.scheduleKafkaReadinessRetry(socket, socketId);
          }
        });

      this.kafkaReadinessRetryFlight = flight;
    }, KAFKA_READINESS_RETRY_MS);
    this.kafkaReadinessRetryTimer.unref?.();
  }

  private scheduleReconnect(
    delayMs: number,
    allowActiveQrLifecycle = false
  ): void {
    this.clearReconnectRetryTimer();
    this.reconnectRetryTimer = setTimeout(() => {
      this.reconnectRetryTimer = undefined;
      if (!this.shouldScheduleRetryAfterClose(allowActiveQrLifecycle)) {
        return;
      }
      const flight = this.connect({
        initial_connection: this.initialConnection,
        from_disconnect_restart: true,
        force_new: true,
        requested_by_user: false,
        type: this.typeConnection,
        phone_connection: this.phoneConnection,
        connection_attempt_id: this.connectionAttemptId,
        debug_trace_id: this.debugTraceId,
        runtime_generation: this.runtimeGeneration,
      })
        .then(() => undefined)
        .catch(() => {
          this.saveLogWppConnection({
            worker_id: getWorker(),
            status: this.status ?? Status.disconnected,
            code: this.code ?? ECodeMessage.connectionLost,
            message: `Reconnect failed after ${delayMs}ms retry`,
            date: new Date(),
          });
          this.scheduleNextReconnectAttempt(allowActiveQrLifecycle);
        })
        .finally(() => {
          if (this.reconnectRetryFlight === flight) {
            this.reconnectRetryFlight = undefined;
          }
        });
      this.reconnectRetryFlight = flight;
    }, delayMs);
    this.reconnectRetryTimer.unref?.();
  }

  private scheduleReconnectCooldown(allowActiveQrLifecycle = false): void {
    this.clearReconnectRetryTimer();
    this.reconnectRetryTimer = setTimeout(() => {
      this.reconnectRetryTimer = undefined;
      this.scheduleNextReconnectAttempt(allowActiveQrLifecycle);
    }, this.reconnectCooldownDelay);
    this.reconnectRetryTimer.unref?.();
  }

  private publishReconnectAttempt(attempt: number, delayMs: number): void {
    if (this.isQrPairingInProgress()) {
      this.publishPairingInProgress('pairing_reconnect_attempt');
      return;
    }

    const isProviderHandoff =
      this.postgresAuthStore?.hasPendingHandoff() === true;
    const retryPayload: IBaileysConnectionState = {
      status: Status.connecting,
      worker_id: getWorker(),
      account_id: getAccount(),
      code: ECodeMessage.awaitConnection,
      worker_status_id: EWorkerStatus.disponible,
      attempt,
      max_attempts: this.maxRetries,
      seconds_until_next_attempt: Math.ceil(delayMs / 1000),
      connection_attempt_id: this.connectionAttemptId,
      debug_trace_id: this.debugTraceId,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      provider_state: isProviderHandoff
        ? 'handoff_reconnecting'
        : 'reconnecting',
      degraded_reason: isProviderHandoff
        ? 'handoff_reconnect_scheduled'
        : 'reconnect_scheduled',
    };
    this.publishTelemetry(retryPayload);
    this.logDebug('baileys.provider.reconnect_scheduled', {
      worker_id: getWorker(),
      account_id: getAccount(),
      connection_attempt_id: this.connectionAttemptId,
      runtime_generation: this.runtimeGeneration,
      debug_trace_id: this.debugTraceId,
      attempt,
      max_attempts: this.maxRetries,
      delay_ms: delayMs,
      provider_handoff: isProviderHandoff,
      provider_state: retryPayload.provider_state,
      degraded_reason: retryPayload.degraded_reason,
    });
    // The debounced close notification owns the central transition. Repeated
    // retry announcements are UI-only and must not reset the channel to
    // disponible while the same session is recovering.
  }

  private publishConnectionStarting(): void {
    if (
      this.typeConnection === EBaileysConnectionType.qrcode &&
      this.qrReadSessionActive &&
      !this.qrReadSessionLocked
    ) {
      return;
    }

    this.publishTelemetry({
      status: Status.connecting,
      worker_id: getWorker(),
      account_id: getAccount(),
      code: ECodeMessage.awaitConnection,
      connection_attempt_id: this.connectionAttemptId,
      debug_trace_id: this.debugTraceId,
    });
  }

  private publishPairingInProgress(context: string): void {
    const payload: IBaileysConnectionState = {
      status: Status.connecting,
      worker_id: getWorker(),
      account_id: getAccount(),
      is_new_login: true,
      code: ECodeMessage.pairingInProgress,
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: this.connectionAttemptId,
      debug_trace_id: this.debugTraceId,
    };

    this.publishSub(payload, true);
    void this.notifyWorkerStatusSafely(payload, context);
  }

  private publishLogoutInProgress(): void {
    this.setStatus(Status.connecting, ECodeMessage.logoutInProgress);
    this.publishTelemetry({
      status: Status.connecting,
      worker_id: getWorker(),
      account_id: getAccount(),
      code: ECodeMessage.logoutInProgress,
      disconnected_user: true,
      connection_attempt_id: this.connectionAttemptId,
      debug_trace_id: this.debugTraceId,
    });
  }

  private scheduleNextReconnectAttempt(
    allowActiveQrLifecycle = this.qrLifecycleReconnectAuthorized
  ): boolean {
    if (!this.shouldScheduleRetryAfterClose(allowActiveQrLifecycle)) {
      return false;
    }
    if (this.reconnectRetryTimer) {
      return true;
    }

    if (this.retryCount >= this.maxRetries) {
      this.retryCount = 0;
      this.publishReconnectAttempt(
        this.maxRetries,
        this.reconnectCooldownDelay
      );
      this.scheduleReconnectCooldown(allowActiveQrLifecycle);
      return true;
    }

    const nextAttempt = this.retryCount + 1;
    const recoveringActiveQrSetup = Boolean(
      allowActiveQrLifecycle &&
      this.qrReadSessionActive &&
      !this.qrReadSessionLocked
    );
    const recoveringProviderHandoff =
      this.postgresAuthStore?.hasPendingHandoff() === true;
    const delayMs =
      nextAttempt === 1
        ? 0
        : recoveringActiveQrSetup
          ? CONNECTION_QR_SETUP_RETRY_MS
          : recoveringProviderHandoff
            ? PROVIDER_HANDOFF_RECONNECT_RETRY_MS
            : this.retryDelay;

    this.retryCount = nextAttempt;
    this.publishReconnectAttempt(nextAttempt, delayMs);
    this.scheduleReconnect(delayMs, allowActiveQrLifecycle);
    return true;
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
      return this.reportConnected();
    }

    if (this.connecting) {
      if (this.currentPromise) {
        return this.currentPromise;
      }
      return Promise.resolve(this.reportConnecting());
    }

    if (this.status === Status.connected) {
      return this.reportConnected();
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

  private async resolveRuntimeFenceConnectionAuthorization(
    input: IBaileysConnection
  ): Promise<IWhatsappRuntimeFenceConnectionAuthorization | undefined> {
    let releaseTransition!: () => void;
    const previousTransition =
      this.runtimeFenceConnectionAuthorizationTransition;
    this.runtimeFenceConnectionAuthorizationTransition = new Promise<void>(
      (resolve) => {
        releaseTransition = resolve;
      }
    );
    await previousTransition.catch(() => undefined);
    try {
      return await this.resolveRuntimeFenceConnectionAuthorizationExclusive(
        input
      );
    } finally {
      releaseTransition();
    }
  }

  private async resolveRuntimeFenceConnectionAuthorizationExclusive(
    input: IBaileysConnection
  ): Promise<IWhatsappRuntimeFenceConnectionAuthorization> {
    const runtimeGeneration = Number(
      input.runtime_generation ?? baileysEnvironment.runtimeGeneration
    );
    if (
      !Number.isSafeInteger(runtimeGeneration) ||
      runtimeGeneration <= 0 ||
      runtimeGeneration !== Number(baileysEnvironment.runtimeGeneration)
    ) {
      throw new TypeError('baileys_runtime_fence_generation_invalid');
    }

    const authorizedConnectionEpoch = input.authorized_connection_epoch?.trim();
    const connectionAttemptId = input.connection_attempt_id?.trim();
    const currentAuthorization = this.runtimeFenceConnectionAuthorization;
    if (
      !authorizedConnectionEpoch &&
      input.from_disconnect_restart === true &&
      connectionAttemptId &&
      currentAuthorization?.connection_attempt_id === connectionAttemptId
    ) {
      // A QR refresh recycles only the provider socket. The manager-owned
      // connection fence remains active for this process, generation and
      // attempt, so a second activation RPC is unnecessary and can block the
      // native QR rotation behind the already-running request.
      return { ...currentAuthorization };
    }
    if (authorizedConnectionEpoch) {
      if (
        !connectionAttemptId ||
        input.requested_by_user !== true ||
        (input.type ?? EBaileysConnectionType.qrcode) !==
          EBaileysConnectionType.qrcode
      ) {
        throw new TypeError('baileys_pairing_activation_grant_invalid');
      }
      await this.balanceWorkerStatusGrpcClientService.activateWhatsappRuntimeFence(
        {
          worker_id: getWorker(),
          account_id: getAccount(),
          source_provider: 'baileys',
          runtime_generation: runtimeGeneration,
          connection_epoch: authorizedConnectionEpoch,
          connection_attempt_id: connectionAttemptId,
        }
      );
      const authorization = {
        connection_epoch: authorizedConnectionEpoch,
        connection_attempt_id: connectionAttemptId,
      } satisfies IWhatsappRuntimeFenceConnectionAuthorization;
      this.runtimeFenceConnectionAuthorization = authorization;
      return authorization;
    }

    const owned =
      await this.balanceWorkerStatusGrpcClientService.resolveWhatsappRuntimeOwnedConnectionFence(
        {
          worker_id: getWorker(),
          account_id: getAccount(),
          source_provider: 'baileys',
          runtime_generation: runtimeGeneration,
        }
      );
    const authorization: IWhatsappRuntimeFenceConnectionAuthorization = owned
      ? {
          connection_epoch: owned.connection_epoch,
          connection_attempt_id: owned.connection_attempt_id,
        }
      : currentAuthorization
        ? { ...currentAuthorization }
        : { connection_epoch: randomUUID() };
    await this.balanceWorkerStatusGrpcClientService.activateWhatsappRuntimeFence(
      {
        worker_id: getWorker(),
        account_id: getAccount(),
        source_provider: 'baileys',
        runtime_generation: runtimeGeneration,
        connection_epoch: authorization.connection_epoch,
        connection_attempt_id: authorization.connection_attempt_id,
      }
    );
    this.runtimeFenceConnectionAuthorization = authorization;
    return authorization;
  }

  async connect(input: IBaileysConnection): Promise<IBaileysConnectionState> {
    let releaseTransition!: () => void;
    const previousTransition = this.connectionSetupTransition;
    this.connectionSetupTransition = new Promise<void>((resolve) => {
      releaseTransition = resolve;
    });
    await previousTransition.catch(() => undefined);
    try {
      return await this.connectExclusive(input);
    } finally {
      releaseTransition();
    }
  }

  private async connectExclusive(
    input: IBaileysConnection
  ): Promise<IBaileysConnectionState> {
    const activeDisconnect = this.disconnectFlight;
    if (activeDisconnect) {
      await activeDisconnect;
    }
    if (this.providerHandoffKey) {
      throw new Error('baileys_provider_handoff_runtime_fenced');
    }
    const {
      initial_connection: initialConnection = false,
      allow_restore: allowRestore = true,
      type: typeConnection = EBaileysConnectionType.qrcode,
      phone_connection: phoneConnection,
      force_new: forceNew = false,
      requested_by_user: requestedByUser = false,
      from_disconnect_restart: fromDisconnectRestart = false,
      connection_attempt_id: connectionAttemptId,
      debug_trace_id: debugTraceId,
      runtime_generation: runtimeGeneration,
    } = input;

    // A post-disconnect QR grant is consumed before the PostgreSQL auth store
    // is opened. Existing grant ownership is also recovered here so every
    // reconnect in this runtime reuses the exact manager-owned epoch.
    const runtimeFenceConnectionAuthorization =
      await this.resolveRuntimeFenceConnectionAuthorization(input);

    if (usesPostgresSessionStorage()) {
      await this.runConnectionPhase(
        'postgres_auth_state_preload',
        AUTH_STATE_TIMEOUT_MS,
        'postgres_auth_state_timeout',
        () => this.loadPostgresAuthenticationState()
      );
    }

    this.debugTraceId = debugTraceId ?? this.debugTraceId;
    this.logDebug('baileys.provider.connect_start', {
      trace_id: this.debugTraceId,
      layer: 'baileys',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.baileys,
      connection_attempt_id: connectionAttemptId,
      active_connection_attempt_id: this.connectionAttemptId,
      runtime_generation: runtimeGeneration,
      active_runtime_generation: this.runtimeGeneration,
      status: this.status,
      code: this.code,
      requested_by_user: requestedByUser,
      force_new: forceNew,
      allow_restore: allowRestore,
      from_disconnect_restart: fromDisconnectRestart,
      has_session: this.hasSession(),
      connected: this.connected,
      connecting: this.connecting,
    });

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
    this.phoneConnection = phoneConnection;
    if (
      connectionAttemptId !== undefined ||
      requestedByUser ||
      runtimeFenceConnectionAuthorization?.connection_attempt_id !== undefined
    ) {
      this.connectionAttemptId =
        runtimeFenceConnectionAuthorization?.connection_attempt_id ??
        connectionAttemptId;
    }
    if (runtimeGeneration !== undefined) {
      this.runtimeGeneration = runtimeGeneration;
    }
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

    if (
      forceNew &&
      !forcedRestartActiveConnection &&
      (!this.connecting || fromDisconnectRestart)
    ) {
      this.cancelAttempt(false);
    }

    // cancelAttempt resets the QR lifecycle. Register the manager-authorized
    // read session only after every forced socket cancellation so the new
    // attempt retains its right to recover before emitting the first QR.
    this.trackQrReadSession(requestedByUser, typeConnection);

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
    // Every explicit request owns a fresh retry budget, including the first
    // request made immediately after a remote logout. The post-logout
    // PostgreSQL/PQ cleanup can still be finishing when that first socket is
    // allocated; keeping the previous disconnect retry count would delay the
    // self-recovery by retryDelay (currently one minute).
    if (requestedByUser || !fromDisconnectRestart) {
      this.retryCount = 0;
    }
    this.cancelKafkaReadinessRetry();
    this.invalidateReadyConfirmation();
    this.socketId += 1;
    // A newly allocated socket generation can no longer be confused with a
    // delayed close callback from the explicitly removed session.
    this.explicitSessionRemovalSocketId = undefined;
    this.connectionAttemptStartedAtMs = Date.now();

    let socket: WASocket | undefined;
    try {
      ({ socket } = await this.createSocket());
      await this.recoverPendingPostQuantumRollbackBeforeBinding(socket);
      this.logDebug('baileys.provider.socket_created', {
        trace_id: this.debugTraceId,
        layer: 'baileys',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.baileys,
        connection_attempt_id: this.connectionAttemptId,
        status: this.status,
        code: this.code,
      });
    } catch (error) {
      let socketFailure = error;
      if (socket) {
        try {
          await this.closeProviderSocketForHandoff(socket);
        } catch (closeError) {
          // Do not schedule a second writer when termination of the local
          // recovery socket cannot be proven.
          this.userRequestedDisconnect = true;
          this.initialConnection = false;
          socketFailure = new Error(
            'baileys_pq_rollback_source_recovery_pending',
            { cause: new AggregateError([error, closeError]) }
          );
        }
      }
      this.logDebug('baileys.provider.socket_create_error', {
        trace_id: this.debugTraceId,
        layer: 'baileys',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.baileys,
        connection_attempt_id: this.connectionAttemptId,
        status: this.status,
        code: this.code,
        reason: this.errorMessage(socketFailure),
      });
      return this.handleSocketCreateFailure(socketFailure);
    }

    this.baileysIncomingMessageService.bindTo(
      socket,
      runtimeFenceConnectionAuthorization
    );
    this.socket = socket;
    this.bindNativeConnectionStatus(socket);

    this.currentPromise = this.wait(socket, this.socketId).finally(() => {
      this.connecting = false;
      this.currentPromise = undefined;
    });

    return this.currentPromise;
  }

  private async recoverPendingPostQuantumRollbackBeforeBinding(
    socket: WASocket
  ): Promise<void> {
    if (!usesPostgresSessionStorage() || !this.postgresAuthStore) return;
    const marker =
      await this.postgresAuthStore.getPendingPostQuantumServerRollback();
    if (!marker) return;
    // A new socket has no in-memory rollback promise. It may reopen upload
    // admission only after the database proves the server delete was
    // acknowledged and the prior socket was fenced. An intent-only marker is
    // deliberately fail-closed: it can be recovered only by the original
    // fenced socket, never by guessing on a replacement runtime.
    if (
      marker.state !== 'acknowledged' ||
      marker.uploadLifecycleFenced !== true ||
      marker.uploadLifecycleFenceVersion !== 1
    ) {
      throw new Error('baileys_pq_rollback_source_recovery_unavailable');
    }
    this.postgresAuthStore.resumeWritesAfterFailedHandoff();
    const capable = socket as unknown as ProviderHandoffCapableSocket;
    if (!capable.recoverPqAfterClassicalHandoffAbort) {
      throw new Error('baileys_pq_rollback_source_recovery_unavailable');
    }
    try {
      // Baileys 1.0.10 owns the Noise-ready gate for a fresh socket. Calling
      // the recovery before binding lets it share that gate with PQ bootstrap
      // and prevents a second upload from racing the persisted recovery.
      await capable.recoverPqAfterClassicalHandoffAbort({
        allowPersistedRecovery: true,
      });
      await this.postgresAuthStore.checkpointPostQuantumRecovery();
      await this.postgresAuthStore.completePostQuantumServerRollbackRecovery(
        marker
      );
    } catch (cause) {
      this.postgresAuthStore.pauseWritesForHandoff();
      throw new Error('baileys_pq_rollback_source_recovery_pending', {
        cause,
      });
    }
    this.logDebug('baileys.provider_handoff.pq_source_recovered_on_restart', {
      trace_id: this.debugTraceId,
      layer: 'baileys',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.baileys,
      handoff_id: marker.handoffId,
      source_revision_id: marker.sourceRevisionId,
      marker_state: marker.state,
    });
  }

  async disconnect(input: IBaileysConnection): Promise<void> {
    const shouldRemoveSession =
      input.remove_session === true || input.preserve_session === false;

    const activeDisconnect = this.disconnectFlight;
    if (activeDisconnect) {
      const activeRemovesSession = this.disconnectFlightRemovesSession;
      await activeDisconnect;
      if (!shouldRemoveSession || activeRemovesSession) {
        return;
      }

      // A stronger remove-session request that arrived behind a regular
      // disconnect must still run after the first provider operation settles.
      await this.disconnect(input);
      return;
    }

    this.disconnectFlightRemovesSession = shouldRemoveSession;
    if (shouldRemoveSession) {
      // Install the callback tombstone and stop every autonomous reconnect
      // source before the first await. The provider logout may synchronously
      // enqueue a close callback while its promise is still pending.
      this.explicitSessionRemovalInFlight = true;
      this.explicitSessionRemovalSocketId = this.socketId;
      this.healthCheckService.stop();
      this.clearReconnectRetryTimer();
      this.cancelTransientDisconnectStatus();
      this.cancelKafkaReadinessRetry();
    }

    const flight = this.disconnectOnce(input).finally(() => {
      if (this.disconnectFlight === flight) {
        this.disconnectFlight = undefined;
        this.disconnectFlightRemovesSession = false;
      }
      if (this.explicitSessionRemovalFlight === flight) {
        this.explicitSessionRemovalFlight = undefined;
        this.explicitSessionRemovalInFlight = false;
      }
    });
    this.disconnectFlight = flight;
    if (shouldRemoveSession) {
      this.explicitSessionRemovalFlight = flight;
    }
    await flight;
  }

  private async disconnectOnce(input: IBaileysConnection): Promise<void> {
    this.invalidateReadyConfirmation();
    const {
      initial_connection: initialConnection = false,
      disconnected_user: disconnectedUser = false,
      preserve_session: preserveSession = true,
      remove_session: removeSession = false,
      connection_attempt_id: connectionAttemptId,
      debug_trace_id: debugTraceId,
      runtime_generation: runtimeGeneration,
    } = input;
    this.connectionAttemptId = connectionAttemptId ?? this.connectionAttemptId;
    this.debugTraceId = debugTraceId ?? this.debugTraceId;
    this.runtimeGeneration = runtimeGeneration ?? this.runtimeGeneration;
    const shouldRemoveSession = removeSession || !preserveSession;

    this.initialConnection = initialConnection;
    this.connectionEstablished = false;
    if (disconnectedUser) {
      this.userRequestedDisconnect = true;
    }
    if (disconnectedUser || shouldRemoveSession) {
      this.publishLogoutInProgress();
    }

    this.healthCheckService.stop();
    this.clearReconnectRetryTimer();
    this.cancelTransientDisconnectStatus();
    this.cancelKafkaReadinessRetry();
    await this.healthCheckService.notifyDisconnected(
      disconnectedUser ? 'User requested disconnect' : 'Connection closed'
    );
    this.retryCount = 0;
    this.resetQrReadSession();
    this.qrReadSessionLocked = false;

    await this.safeLogout(shouldRemoveSession);
    await this.flushNativeConnectionStatusPersistence('disconnect');
    this.cancelAttempt(false);
    if (shouldRemoveSession) {
      await this.clearSessionStorage();
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
      connection_attempt_id: this.connectionAttemptId,
      authorized_connection_epoch: this.runtimeFenceConnectionAuthorization
        ?.connection_attempt_id
        ? this.runtimeFenceConnectionAuthorization.connection_epoch
        : undefined,
      runtime_generation: this.runtimeGeneration,
      debug_trace_id: this.debugTraceId,
    };

    // The service/manager disconnect finalizer owns the durable terminal
    // projection for an explicit session removal. Publishing it from the
    // provider would race the disconnect tombstone and can turn a successful
    // clear into a stale-status gRPC failure.
    if (!shouldRemoveSession) {
      this.publishSub(payload, true);

      await this.balanceWorkerStatusGrpcClientService.notifyWorkerStatus(
        this.withConnectionMetadata(payload)
      );
    }

    const shouldReconnect =
      this.initialConnection && !disconnectedUser && !shouldRemoveSession;

    if (shouldReconnect) {
      this.scheduleNextReconnectAttempt();
    }
  }

  reconnect(input: IBaileysConnection): boolean {
    if (this.providerHandoffKey) {
      return false;
    }
    this.invalidateReadyConfirmation();
    const { initial_connection: initialConnection = true } = input;
    this.initialConnection = initialConnection;
    this.connectionAttemptId =
      input.connection_attempt_id ?? this.connectionAttemptId;
    this.debugTraceId = input.debug_trace_id ?? this.debugTraceId;
    this.runtimeGeneration = input.runtime_generation ?? this.runtimeGeneration;
    this.setCentralOnlineAcknowledged(false);

    if (
      initialConnection &&
      this.hasSession() &&
      !input.authorized_connection_epoch &&
      !this.userRequestedDisconnect &&
      this.initialConnection
    ) {
      return this.scheduleNextReconnectAttempt();
    }

    if (this.userRequestedDisconnect) {
      return false;
    }

    void this.connect({
      initial_connection: initialConnection,
      requested_by_user: Boolean(input.authorized_connection_epoch),
      type: EBaileysConnectionType.qrcode,
      connection_attempt_id: this.connectionAttemptId,
      authorized_connection_epoch: input.authorized_connection_epoch,
      debug_trace_id: this.debugTraceId,
      runtime_generation: this.runtimeGeneration,
    }).catch(() => {
      this.saveLogWppConnection({
        worker_id: getWorker(),
        status: this.status ?? Status.disconnected,
        code: this.code ?? ECodeMessage.connectionLost,
        message: 'Reconnect failed',
        date: new Date(),
      });
    });
    return true;
  }

  suspend(): Promise<void> {
    return this.teardownRuntime(ECodeMessage.connectionLost, true);
  }

  shutdown(): Promise<void> {
    return this.teardownRuntime(ECodeMessage.loggedOut);
  }

  async prepareSessionStorageMigration(
    input: IPrepareSessionStorageMigrationRequestProto
  ): Promise<IPrepareSessionStorageMigrationResponseProto> {
    if (
      usesPostgresSessionStorage() ||
      process.env.WORKER_SESSION_STORAGE !== 'legacy_volume' ||
      process.env.SESSION_VOLUME_NAME !== input.source_volume_name ||
      input.worker_id !== getWorker() ||
      input.account_id !== getAccount() ||
      input.provider !== 'baileys' ||
      input.runtime_generation !== baileysEnvironment.runtimeGeneration ||
      input.runtime_capability !== process.env.WORKER_RUNTIME_CAPABILITY
    ) {
      throw new Error('baileys_session_storage_migration_context_invalid');
    }

    if (
      this.sessionStorageMigrationId &&
      this.sessionStorageMigrationId !== input.migration_id
    ) {
      throw new Error('baileys_session_storage_migration_already_owned');
    }
    if (this.sessionStorageMigrationResult) {
      return { ...this.sessionStorageMigrationResult };
    }

    const phone =
      this.sessionStorageMigrationPhone ??
      getPhoneNumber(this.socket?.user?.id) ??
      '';
    const normalizedExpected = (input.expected_phone ?? '').replace(/\D/gu, '');
    const normalizedPhone = phone.replace(/\D/gu, '');
    if (normalizedExpected && normalizedExpected !== normalizedPhone) {
      throw new Error('baileys_session_storage_migration_phone_mismatch');
    }
    if (!normalizedPhone) {
      throw new Error('baileys_session_storage_migration_identity_missing');
    }
    this.sessionStorageMigrationId = input.migration_id;
    this.sessionStorageMigrationPhone = phone;

    await this.suspend();
    const checkpoint = await snapshotLegacySessionVolume();
    const result: IPrepareSessionStorageMigrationResponseProto = {
      worker_id: input.worker_id,
      provider: 'baileys',
      migration_id: input.migration_id,
      runtime_generation: input.runtime_generation,
      prepared: true,
      consumers_drained: true,
      writes_paused: true,
      checkpoint_persisted: true,
      provider_disconnected: true,
      volume_preserved: true,
      checkpoint_checksum_sha256: checkpoint.checksumSha256,
      checkpoint_size_bytes: checkpoint.sizeBytes,
      checkpoint_record_count: checkpoint.recordCount,
      phone,
      identity_hash: createHash('sha256')
        .update(normalizedPhone, 'utf8')
        .digest('hex'),
      prepared_at: new Date().toISOString(),
      error: '',
    };
    this.sessionStorageMigrationResult = result;
    return { ...result };
  }

  private async teardownRuntime(
    disconnectCode: ECodeMessage,
    tolerateSessionStoreCloseFailure = false
  ): Promise<void> {
    this.invalidateReadyConfirmation();
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
    this.cancelKafkaReadinessRetry();
    await this.safeLogout(false, disconnectCode).catch(() => undefined);
    await this.flushNativeConnectionStatusPersistence('shutdown');
    this.baileysIncomingMessageService.unbind();
    this.cancelAttempt(false);
    const postgresAuthStore = this.postgresAuthStore;
    this.postgresAuthStore = undefined;
    try {
      await postgresAuthStore?.close();
    } catch (error) {
      if (!tolerateSessionStoreCloseFailure) {
        throw error;
      }
      console.error(
        '[BaileysConnection] PostgreSQL session store close deferred after database suspension',
        { ...workerErrorDiagnostics(error) }
      );
    }
  }

  prepareProviderHandoff(
    input: IPrepareProviderHandoffRequestProto
  ): Promise<IPrepareProviderHandoffResponseProto> {
    const key = `${input.handoff_id}:${input.lifecycle_operation_id}`;
    if (this.providerHandoffKey && this.providerHandoffKey !== key) {
      return Promise.reject(
        new Error('baileys_provider_handoff_already_in_progress')
      );
    }
    if (this.providerHandoffResult) {
      return Promise.resolve({ ...this.providerHandoffResult });
    }
    if (this.providerHandoffFlight) {
      return this.providerHandoffFlight;
    }
    this.providerHandoffKey = key;
    const flight = this.performPrepareProviderHandoff(input).finally(() => {
      if (this.providerHandoffFlight === flight) {
        this.providerHandoffFlight = undefined;
      }
    });
    this.providerHandoffFlight = flight;
    return flight;
  }

  private async completePreparedProviderHandoff(
    input: IPrepareProviderHandoffRequestProto,
    pending: PendingBaileysProviderHandoffCompletion
  ): Promise<IPrepareProviderHandoffResponseProto> {
    const key = `${input.handoff_id}:${input.lifecycle_operation_id}`;
    if (
      pending.key !== key ||
      pending.input.worker_id !== input.worker_id ||
      pending.input.account_id !== input.account_id ||
      pending.input.source_provider !== input.source_provider ||
      pending.input.target_provider !== input.target_provider ||
      pending.input.source_revision_id !== input.source_revision_id ||
      pending.input.runtime_generation !== input.runtime_generation
    ) {
      throw new Error('baileys_provider_handoff_completion_lineage_mismatch');
    }

    if (!pending.providerDisconnected) {
      if (pending.socket) {
        try {
          pending.socket.ev.removeAllListeners('connection.update');
        } catch {
          // Closure confirmation below remains authoritative.
        }
        await this.closeProviderSocketForHandoff(pending.socket);
      }
      this.cancelAttempt(true);
      if ((this.socket as unknown) === pending.socket) this.socket = undefined;
      this.connectionEstablished = false;
      this.setStatus(Status.disconnected, ECodeMessage.connectionClosed, true);
      pending.providerDisconnected = true;
    }

    const leaseReleased = await pending.store.closeForHandoff();
    if (!leaseReleased) {
      throw new Error('baileys_provider_handoff_lease_release_unconfirmed');
    }
    if (this.postgresAuthStore === pending.store) {
      this.postgresAuthStore = undefined;
    }

    const checkpoint = pending.checkpoint;
    const result: IPrepareProviderHandoffResponseProto = {
      worker_id: input.worker_id,
      provider: 'baileys',
      handoff_id: input.handoff_id,
      lifecycle_operation_id: input.lifecycle_operation_id,
      source_revision_id: String(checkpoint.revisionId),
      runtime_generation: input.runtime_generation,
      prepared: true,
      consumers_drained: true,
      writes_paused: true,
      checkpoint_persisted: true,
      provider_disconnected: true,
      lease_released: true,
      checkpoint_checksum_sha256: checkpoint.checksumSha256,
      checkpoint_size_bytes: String(checkpoint.sizeBytes),
      checkpoint_record_count: String(checkpoint.recordCount),
      prepared_at: new Date().toISOString(),
      error: '',
    };
    this.providerHandoffResult = result;
    if (this.pendingProviderHandoffCompletion === pending) {
      this.pendingProviderHandoffCompletion = undefined;
    }
    this.logDebug('baileys.provider_handoff.prepared', {
      trace_id: input.debug_trace_id,
      layer: 'baileys',
      worker_id: input.worker_id,
      account_id: input.account_id,
      worker_type_id: EWorkerType.baileys,
      runtime_generation: input.runtime_generation,
      handoff_id: input.handoff_id,
      lifecycle_operation_id: input.lifecycle_operation_id,
      source_revision_id: input.source_revision_id,
      target_provider: input.target_provider,
      checkpoint_size_bytes: checkpoint.sizeBytes,
      checkpoint_record_count: checkpoint.recordCount,
      lease_released: true,
    });
    return { ...result };
  }

  private async performPrepareProviderHandoff(
    input: IPrepareProviderHandoffRequestProto
  ): Promise<IPrepareProviderHandoffResponseProto> {
    if (
      !usesPostgresSessionStorage() ||
      input.worker_id !== getWorker() ||
      input.account_id !== getAccount() ||
      input.source_provider !== 'baileys' ||
      input.target_provider === 'baileys' ||
      !['wwebjs', 'whatsmeow'].includes(input.target_provider) ||
      input.runtime_generation !== baileysEnvironment.runtimeGeneration
    ) {
      throw new Error('baileys_provider_handoff_context_invalid');
    }
    const sourceRevisionId = Number(input.source_revision_id);
    if (!Number.isSafeInteger(sourceRevisionId) || sourceRevisionId <= 0) {
      throw new Error('baileys_provider_handoff_source_revision_invalid');
    }

    if (this.pendingProviderHandoffCompletion) {
      return this.completePreparedProviderHandoff(
        input,
        this.pendingProviderHandoffCompletion
      );
    }

    const socket = this.socket as ProviderHandoffCapableSocket | undefined;
    const store = this.postgresAuthStore ?? this.getPostgresAuthStore();
    if (!this.postgresAuthStore) {
      this.postgresAuthStore = store;
    }
    await store.openForHandoff();
    const handoffInput = {
      accountId: input.account_id,
      handoffId: input.handoff_id,
      lifecycleOperationId: input.lifecycle_operation_id,
      sourceRevisionId,
      targetProvider: input.target_provider as 'wwebjs' | 'whatsmeow',
      debugTraceId: input.debug_trace_id,
    };

    // The database authorization is the first observable handoff action. The
    // manager payload alone can never trigger a server-side key mutation.
    await store.authorizeHandoff(handoffInput);
    let pqRollbackIntentPersisted = false;
    let pqRollbackPersisted = false;
    let pqRollbackAcknowledged = false;
    if (requiresClassicalPostQuantumHandoff(handoffInput.targetProvider)) {
      await store.beginPostQuantumServerRollback(handoffInput);
      pqRollbackIntentPersisted = true;
    }

    const restartSourceWithFreshSocket = async (
      resumeStoreWrites: boolean
    ): Promise<void> => {
      try {
        socket?.ev.removeAllListeners('connection.update');
      } catch {
        // Socket closure below is the authoritative fail-closed boundary.
      }
      await this.closeProviderSocketForHandoff(socket);
      if (resumeStoreWrites) {
        store.resumeWritesAfterFailedHandoff();
      }
      this.cancelAttempt(true);
      if ((this.socket as unknown) === socket) this.socket = undefined;
      this.connectionEstablished = false;
      this.userRequestedDisconnect = false;
      this.initialConnection = true;
      this.setStatus(Status.disconnected, ECodeMessage.connectionLost, true);
      if (
        this.providerHandoffKey ===
        `${input.handoff_id}:${input.lifecycle_operation_id}`
      ) {
        this.providerHandoffKey = undefined;
        this.providerHandoffResult = undefined;
      }
      this.scheduleNextReconnectAttempt();
    };

    const recoverPostQuantumSource = async (): Promise<void> => {
      if (!socket?.recoverPqAfterClassicalHandoffAbort) {
        throw new Error('baileys_pq_rollback_source_recovery_unavailable');
      }
      store.resumeWritesAfterFailedHandoff();
      await socket.recoverPqAfterClassicalHandoffAbort();
      // Recovery is not exposed to application traffic until the regenerated
      // bundle and canonical state have a fenced durable checkpoint.
      await store.checkpointPostQuantumRecovery();
      const marker = await store.getPendingPostQuantumServerRollback();
      if (!marker) {
        throw new Error('baileys_pq_rollback_source_recovery_marker_missing');
      }
      await store.completePostQuantumServerRollbackRecovery(marker);
      // ProviderInvocationSingleFlight fencing is permanent for this socket.
      // Never rebind it after an aborted handoff; terminate it and let the
      // normal reconnect path create a new runtime object after recovery.
      await restartSourceWithFreshSocket(false);
    };

    const failClosedAfterPostQuantumRecoveryError = async (
      sourceError: unknown,
      recoveryError: unknown
    ): Promise<never> => {
      store.pauseWritesForHandoff();
      let terminationError: unknown;
      try {
        await this.closeProviderSocketForHandoff(socket);
      } catch (caughtError) {
        terminationError = caughtError;
      }
      throw new AggregateError(
        [sourceError, recoveryError, terminationError].filter(Boolean),
        'baileys_pq_rollback_source_recovery_failed'
      );
    };

    // Stop application commands/events after the durable intent, while the
    // internal WhatsApp transport remains available solely for the delete RPC.
    try {
      this.debugTraceId = input.debug_trace_id ?? this.debugTraceId;
      this.runtimeGeneration = input.runtime_generation;
      this.userRequestedDisconnect = true;
      this.initialConnection = false;
      this.invalidateReadyConfirmation();
      this.setCentralOnlineAcknowledged(false);
      setWorkerKafkaDispatchAuthorized(false);
      this.healthCheckService.stop();
      this.clearReconnectRetryTimer();
      this.cancelTransientDisconnectStatus();
      this.cancelKafkaReadinessRetry();
      this.baileysIncomingMessageService.unbind();
      const pendingKafkaGate = this.kafkaReadinessGateFlight?.promise;
      if (pendingKafkaGate) {
        await pendingKafkaGate.catch(() => undefined);
      }
      await emitWorkerProviderRuntimeState('baileys', false);
      if (socket) {
        await this.providerLifecycleInvocationFence.fenceAndWaitForIdle(
          socket,
          this.PROVIDER_LIFECYCLE_TIMEOUT_MS
        );
      }
    } catch (error) {
      try {
        // Once an intent exists, even a pre-RPC failure is recovered on a
        // fresh socket. This avoids reactivating a possibly fenced SDK object
        // and keeps an intent marker available for conservative PQ upload.
        await restartSourceWithFreshSocket(true);
      } catch (restartError) {
        throw new AggregateError(
          [error, restartError],
          'baileys_provider_handoff_fail_closed_restart_failed'
        );
      }
      throw error;
    }

    if (requiresClassicalPostQuantumHandoff(handoffInput.targetProvider)) {
      try {
        if (!socket?.deletePqPreKeys) {
          throw new Error('baileys_pq_rollback_socket_capability_unavailable');
        }
        const rollbackProof: BaileysPostQuantumServerRollbackProof =
          await socket.deletePqPreKeys();
        pqRollbackAcknowledged = true;
        await store.persistPostQuantumServerRollback(
          handoffInput,
          rollbackProof
        );
        pqRollbackPersisted = true;
      } catch (error) {
        const acknowledgementUnknown =
          (error as { acknowledgementUnknown?: unknown })
            ?.acknowledgementUnknown === true;
        if (acknowledgementUnknown) {
          try {
            // The delete request may still settle after the caller timed out.
            // Never issue recovery on that same socket; terminate it and let
            // the durable intent drive recovery on a fresh runtime.
            await restartSourceWithFreshSocket(true);
          } catch (restartError) {
            throw new AggregateError(
              [error, restartError],
              'baileys_pq_rollback_ack_unknown_restart_failed'
            );
          }
          throw error;
        }
        const recoveryRequired =
          pqRollbackIntentPersisted ||
          pqRollbackAcknowledged ||
          (error as { serverAcknowledged?: unknown })?.serverAcknowledged ===
            true ||
          (error as { acknowledgementUnknown?: unknown })
            ?.acknowledgementUnknown === true;
        if (recoveryRequired) {
          try {
            await recoverPostQuantumSource();
          } catch (recoveryError) {
            await failClosedAfterPostQuantumRecoveryError(error, recoveryError);
          }
        }
        throw error;
      }
    }
    store.pauseWritesForHandoff();

    this.logDebug('baileys.provider_handoff.drain_started', {
      trace_id: input.debug_trace_id,
      layer: 'baileys',
      worker_id: input.worker_id,
      account_id: input.account_id,
      worker_type_id: EWorkerType.baileys,
      runtime_generation: input.runtime_generation,
      handoff_id: input.handoff_id,
      lifecycle_operation_id: input.lifecycle_operation_id,
      source_revision_id: input.source_revision_id,
      target_provider: input.target_provider,
    });

    let checkpoint: BaileysProviderHandoffCheckpoint;
    try {
      checkpoint = await store.prepareHandoff(handoffInput);
    } catch (error) {
      if (pqRollbackPersisted && socket?.recoverPqAfterClassicalHandoffAbort) {
        try {
          await recoverPostQuantumSource();
        } catch (recoveryError) {
          await failClosedAfterPostQuantumRecoveryError(error, recoveryError);
        }
      } else {
        try {
          // This branch is reachable only before the server-acknowledged PQ
          // rollback is persisted. The source socket is permanently fenced
          // after the drain boundary, so replace it before resuming writes.
          await restartSourceWithFreshSocket(true);
        } catch (restartError) {
          throw new AggregateError(
            [error, restartError],
            'baileys_provider_handoff_abort_restart_failed'
          );
        }
      }
      throw error;
    }

    const pending: PendingBaileysProviderHandoffCompletion = {
      key: `${input.handoff_id}:${input.lifecycle_operation_id}`,
      input: { ...input },
      store,
      socket,
      checkpoint,
      providerDisconnected: false,
    };
    this.pendingProviderHandoffCompletion = pending;
    return this.completePreparedProviderHandoff(input, pending);
  }

  private async closeProviderSocketForHandoff(
    socket: WASocket | ProviderHandoffCapableSocket | undefined = this.socket
  ): Promise<void> {
    if (!socket) return;
    const ws = this.resolveWebSocket(socket);
    if (!ws) {
      throw new Error('baileys_provider_handoff_socket_unavailable');
    }
    if (ws.readyState === 3) {
      return;
    }
    try {
      if (ws.readyState === 1) {
        ws.close(1000, 'provider_handoff');
      } else {
        ws.terminate?.();
      }
    } catch {
      ws.terminate?.();
    }

    const waitUntilClosed = async (timeoutMs: number): Promise<boolean> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (ws.readyState === 3) return true;
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
      }
      return ws.readyState === 3;
    };
    if (await waitUntilClosed(PROVIDER_HANDOFF_SOCKET_CLOSE_TIMEOUT_MS)) {
      return;
    }
    ws.terminate?.();
    if (!(await waitUntilClosed(2_000))) {
      throw new Error('baileys_provider_handoff_socket_close_unconfirmed');
    }
  }

  private logSocketConfig(
    version: WaVersion,
    browser: BaileysBrowser,
    proxyEnabled: boolean
  ): void {
    const postgresSession = usesPostgresSessionStorage();
    const folder = postgresSession ? undefined : getFolder();
    let authFileCount = 0;
    try {
      authFileCount =
        folder && fs.existsSync(folder) ? fs.readdirSync(folder).length : 0;
    } catch {}

    this.logDebug('baileys.provider.socket_config', {
      trace_id: this.debugTraceId,
      layer: 'baileys',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.baileys,
      connection_attempt_id: this.connectionAttemptId,
      status: this.status,
      code: this.code,
      version: version.join('.'),
      browser_os: browser[0],
      browser_name: browser[1],
      browser_version: browser[2],
      proxy_enabled: proxyEnabled,
      node_version: process.version,
      session_storage: getSessionStorage(),
      auth_folder_exists: folder ? fs.existsSync(folder) : false,
      auth_file_count: authFileCount,
      postgres_session_present: postgresSession ? this.hasSession() : undefined,
      qr_read_session_active: this.qrReadSessionActive,
      qr_read_session_locked: this.qrReadSessionLocked,
    });
  }

  private async createSocket() {
    const { state, saveCreds } = await this.runConnectionPhase(
      'auth_state_load',
      AUTH_STATE_TIMEOUT_MS,
      'auth_state_timeout',
      () =>
        usesPostgresSessionStorage()
          ? this.loadPostgresAuthenticationState()
          : useMultiFileAuthState(getFolder())
    );
    const version = await this.runConnectionPhase(
      'wa_version_resolve',
      WA_VERSION_TIMEOUT_MS,
      'wa_version_timeout',
      () => getCachedWaWebVersion()
    );
    const proxyConfig = readProxyConfig();
    const browser = resolveBaileysBrowser();

    const proxyAgent = proxyConfig ? createProxyAgent(proxyConfig) : undefined;
    this.activeProxyUrl = proxyConfig?.url ?? null;
    this.activeProxyAgent = proxyAgent;
    this.logSocketConfig(version, browser, Boolean(proxyConfig));

    const socket = await this.runConnectionPhase(
      'socket_create',
      SOCKET_CREATE_TIMEOUT_MS,
      'socket_create_timeout',
      async () =>
        makeWASocket({
          auth: state,
          version,
          browser,
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
        })
    );

    const credentialBarrier: BaileysCredentialPersistenceBarrier = {
      socket,
      sequence: 0,
      acknowledgedSequence: 0,
      tail: Promise.resolve(),
    };
    this.credentialPersistenceBarrier = credentialBarrier;

    socket.ev.on('creds.update', (creds) => {
      const sequence = ++credentialBarrier.sequence;
      const startedAtMs = Date.now();
      const persist = credentialBarrier.tail
        .catch(() => undefined)
        .then(() => saveCreds());
      credentialBarrier.tail = persist.then(
        () => {
          credentialBarrier.acknowledgedSequence = sequence;
          credentialBarrier.lastError = undefined;
          this.logDebug('baileys.provider.credentials_persisted', {
            trace_id: this.debugTraceId,
            layer: 'baileys',
            worker_id: getWorker(),
            account_id: getAccount(),
            worker_type_id: EWorkerType.baileys,
            connection_attempt_id: this.connectionAttemptId,
            runtime_generation: this.runtimeGeneration,
            sequence,
            duration_ms: Date.now() - startedAtMs,
          });
        },
        (error) => {
          credentialBarrier.lastError = error;
          throw error;
        }
      );
      void credentialBarrier.tail.catch((error) => {
        const diagnostics = baileysCredentialPersistenceDiagnostics(error);
        console.error('[BaileysConnection] Failed to persist credentials', {
          session_storage: getSessionStorage(),
          sequence,
          ...diagnostics,
        });
      });
      this.maybeMarkPairingInProgressFromCreds(creds);
    });

    return { socket, saveCreds };
  }

  private async runConnectionPhase<T>(
    phase: string,
    timeoutMs: number,
    timeoutReason: string,
    task: () => Promise<T>
  ): Promise<T> {
    try {
      return await this.withDeadline(task(), timeoutMs, timeoutReason);
    } catch (error) {
      const phaseError =
        error instanceof BaileysConnectionPhaseError
          ? error
          : new BaileysConnectionPhaseError(
              `${phase}_error`,
              this.errorMessage(error),
              error
            );
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
    this.invalidateReadyConfirmation();
    const phaseError =
      error instanceof BaileysConnectionPhaseError ? error : undefined;
    const reason = phaseError?.reason ?? 'socket_create_error';
    const handoffCodecError =
      phaseError?.originalError instanceof BaileysCanonicalCodecError
        ? phaseError.originalError
        : error instanceof BaileysCanonicalCodecError
          ? error
          : undefined;
    const postQuantumRecoveryUnavailable =
      error instanceof Error &&
      error.message === 'baileys_pq_rollback_source_recovery_unavailable';
    const postQuantumRecoveryPending =
      error instanceof Error &&
      [
        'baileys_pq_rollback_source_recovery_pending',
        'baileys_pq_rollback_source_recovery_failed',
      ].includes(error.message);
    const terminalFailure = Boolean(
      handoffCodecError || postQuantumRecoveryUnavailable
    );
    const elapsedMs =
      this.connectionAttemptStartedAtMs > 0
        ? Date.now() - this.connectionAttemptStartedAtMs
        : undefined;

    this.setStatus(
      terminalFailure ? Status.disconnected : Status.connecting,
      terminalFailure
        ? ECodeMessage.badSession
        : postQuantumRecoveryPending
          ? ECodeMessage.awaitConnection
          : ECodeMessage.awaitingReadQrCode
    );
    this.connecting = false;
    this.currentPromise = undefined;
    this.baileysIncomingMessageService.unbind();
    this.socket = undefined;

    const payload = this.state(undefined, undefined, {
      qr_pending:
        handoffCodecError || postQuantumRecoveryUnavailable ? false : true,
      reason: handoffCodecError?.code ?? reason,
      time_to_first_qr_ms: elapsedMs,
      worker_status_id: terminalFailure
        ? EWorkerStatus.error
        : EWorkerStatus.disponible,
      session_ready: false,
      authenticated: false,
      can_send: false,
      can_receive_runtime: false,
    });
    this.publishSub(payload, true);
    void this.notifyWorkerStatusSafely(
      payload,
      handoffCodecError?.code ?? reason
    );
    if (terminalFailure) {
      const postgresAuthStore = this.postgresAuthStore;
      this.postgresAuthStore = undefined;
      void postgresAuthStore?.close();
    } else {
      this.scheduleNextReconnectAttempt();
    }
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
      const firstQrTimeoutMs = CONNECTION_QR_FIRST_QR_TIMEOUT_MS;
      let settled = false;
      let opened = false;
      let firstQrTimeout: ReturnType<typeof setTimeout> | undefined;
      const cancelFirstQrTimeout = (): void => {
        if (!firstQrTimeout) {
          return;
        }
        clearTimeout(firstQrTimeout);
        firstQrTimeout = undefined;
      };
      const settle = (state: IBaileysConnectionState): void => {
        if (settled) {
          return;
        }
        settled = true;
        cancelFirstQrTimeout();
        resolve(state);
        this.pendingResolve = undefined;
      };
      this.pendingResolve = settle;

      if (this.canShowQr()) {
        firstQrTimeout = setTimeout(() => {
          firstQrTimeout = undefined;
          if (
            settled ||
            opened ||
            id !== this.socketId ||
            this.status !== Status.connecting ||
            !this.canShowQr()
          ) {
            return;
          }

          this.invalidateReadyConfirmation();
          const elapsedMs = Date.now() - startedAtMs;
          this.setStatus(Status.connecting, ECodeMessage.awaitingReadQrCode);

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
          if (this.socket === socket) {
            this.socket = undefined;
          }
          const allowActiveQrLifecycle = this.canContinueQrReadSession();
          this.qrLifecycleReconnectAuthorized = allowActiveQrLifecycle;
          settle(payload);
          this.scheduleNextReconnectAttempt(allowActiveQrLifecycle);
        }, firstQrTimeoutMs);
        firstQrTimeout.unref?.();
      }

      socket.ev.on('connection.update', async (u: IBaileysUpdateEvent) => {
        if (id !== this.socketId) {
          return;
        }

        const { qr, connection, isNewLogin, lastDisconnect, passkey } = u;
        this.logConnectionUpdate(u, {
          opened,
          startedAtMs,
        });

        if (passkey) {
          cancelFirstQrTimeout();
          return this.onPasskey(passkey, settle, id);
        }

        if (qr && this.postgresAuthStore?.hasPendingHandoff()) {
          cancelFirstQrTimeout();
          return this.rejectQrDuringPostgresHandoff(settle);
        }

        if (
          qr &&
          this.canShowQr() &&
          this.typeConnection === EBaileysConnectionType.qrcode
        ) {
          cancelFirstQrTimeout();
          this.awaitingNewLogin = false;
          return this.onQr(qr, settle, id);
        }

        if (isNewLogin) {
          cancelFirstQrTimeout();
          return this.onNewLoginAttempt();
        }

        if (this.shouldMarkQrPairingInProgress(connection)) {
          cancelFirstQrTimeout();
          return this.onNewLoginAttempt();
        }

        if (connection === 'open' && !opened) {
          opened = true;
          cancelFirstQrTimeout();
          this.retryCount = 0;

          return void this.onOpen(settle, id);
        }

        if (connection === 'close') {
          cancelFirstQrTimeout();
          return this.onClose(lastDisconnect, settle, id);
        }

        this.awaitingNewLogin = false;
      });
    });
  }

  private logConnectionUpdate(
    update: IBaileysUpdateEvent,
    context: { opened: boolean; startedAtMs: number }
  ): void {
    const error = update.lastDisconnect?.error;
    const ws = this.resolveWebSocket();
    const elapsedMs = Date.now() - context.startedAtMs;
    const errorLike = error as
      | {
          name?: unknown;
          stack?: unknown;
          output?: {
            statusCode?: unknown;
            payload?: unknown;
          };
          data?: unknown;
        }
      | undefined;

    this.logDebug('baileys.provider.connection_update', {
      trace_id: this.debugTraceId,
      layer: 'baileys',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.baileys,
      connection_attempt_id: this.connectionAttemptId,
      status: this.status,
      code: this.code,
      connection: update.connection,
      is_new_login: update.isNewLogin,
      has_qr: Boolean(update.qr),
      qr_length: update.qr?.length ?? 0,
      has_passkey_public_key: Boolean(update.passkey?.publicKey),
      has_passkey_confirmation_code: Boolean(update.passkey?.confirmationCode),
      passkey_skip_handoff_ux: update.passkey?.skipHandoffUX === true,
      passkey_continuation: update.passkey?.continuation === true,
      passkey_error: update.passkey?.error,
      elapsed_ms: elapsedMs,
      opened: context.opened,
      disconnect_code: this.extractStatusCode(error),
      disconnect_message: this.extractStatusMessage(error),
      disconnect_error_name:
        typeof errorLike?.name === 'string' ? errorLike.name : undefined,
      disconnect_output_status_code: errorLike?.output?.statusCode,
      disconnect_output_payload: errorLike?.output?.payload,
      disconnect_data: errorLike?.data,
      disconnect_stack:
        SHOULD_LOG_LOCAL_DETAILS && typeof errorLike?.stack === 'string'
          ? errorLike.stack
          : undefined,
      ws_ready_state: ws?.readyState,
      ws_is_open: (ws as unknown as { isOpen?: boolean } | undefined)?.isOpen,
      qr_read_session_active: this.qrReadSessionActive,
      qr_read_session_locked: this.qrReadSessionLocked,
      qr_generation_count: this.qrGenerationCount,
      has_session: this.hasSession(),
    });
  }

  private async onPasskey(
    passkey: BaileysPasskeyUpdate,
    resolve: (s: IBaileysConnectionState) => void,
    id: number
  ): Promise<void> {
    if (id !== this.socketId) {
      return;
    }

    if (passkey.error) {
      const payload = this.state(undefined, undefined, {
        worker_status_id: EWorkerStatus.disponible,
        reason: passkey.error,
      });
      this.publishSub(payload, true);
      void this.notifyWorkerStatusSafely(payload, 'passkey_error');
      resolve(payload);
      this.pendingResolve = undefined;
      return;
    }

    if (passkey.publicKey) {
      const passkeyPublicKey = this.serializePasskeyPublicKey(
        passkey.publicKey
      );
      this.setStatus(Status.connecting, ECodeMessage.awaitingPasskey);
      const payload = this.state(undefined, undefined, {
        worker_status_id: EWorkerStatus.disponible,
        passkey_public_key: passkeyPublicKey,
        passkey_pending: true,
      });
      this.logDebug('baileys.provider.passkey_request', {
        trace_id: this.debugTraceId,
        layer: 'baileys',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.baileys,
        connection_attempt_id: this.connectionAttemptId,
        status: this.status,
        code: this.code,
        has_passkey_public_key: true,
        passkey_public_key_len: passkeyPublicKey.length,
      });
      this.publishSub(payload, true);
      void this.notifyWorkerStatusSafely(payload, 'passkey_request');
      resolve(payload);
      this.pendingResolve = undefined;
      return;
    }

    if (passkey.confirmationCode) {
      if (passkey.skipHandoffUX === true) {
        const payload = await this.confirmPasskey({
          worker_id: getWorker(),
          account_id: getAccount(),
          connection_attempt_id: this.connectionAttemptId,
          debug_trace_id: this.debugTraceId,
        });
        resolve(payload);
        this.pendingResolve = undefined;
        return;
      }

      this.setStatus(
        Status.connecting,
        ECodeMessage.awaitingPasskeyConfirmation
      );
      const payload = this.state(undefined, undefined, {
        worker_status_id: EWorkerStatus.disponible,
        passkey_confirmation_code: passkey.confirmationCode,
        passkey_skip_handoff_ux: false,
        passkey_pending: false,
      });
      this.logDebug('baileys.provider.passkey_confirmation', {
        trace_id: this.debugTraceId,
        layer: 'baileys',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.baileys,
        connection_attempt_id: this.connectionAttemptId,
        status: this.status,
        code: this.code,
        has_passkey_confirmation_code: true,
        passkey_skip_handoff_ux: false,
      });
      this.publishSub(payload, true);
      void this.notifyWorkerStatusSafely(payload, 'passkey_confirmation');
      resolve(payload);
      this.pendingResolve = undefined;
    }
  }

  private serializePasskeyPublicKey(publicKey: unknown): string {
    if (typeof publicKey === 'string') {
      return publicKey;
    }

    return JSON.stringify(publicKey);
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
    const qrGeneratedAt = new Date().toISOString();
    const timeToFirstQrMs =
      this.connectionAttemptStartedAtMs > 0
        ? Date.now() - this.connectionAttemptStartedAtMs
        : undefined;

    this.logDebug('baileys.provider.qr_event', {
      trace_id: this.debugTraceId,
      layer: 'baileys',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.baileys,
      connection_attempt_id: this.connectionAttemptId,
      status: this.status,
      code: this.code,
      has_qrcode: true,
      attempt: this.qrGenerationCount,
      max_attempts: this.maxQrGenerations,
      time_to_first_qr_ms: timeToFirstQrMs,
    });

    let img: string;
    try {
      img = await this.withDeadline(
        QRCode.toDataURL(qr),
        QR_DATA_URL_GENERATION_TIMEOUT_MS,
        'qr_dataurl_generation_timeout'
      );
      this.logDebug('baileys.provider.qr_dataurl_generated', {
        trace_id: this.debugTraceId,
        layer: 'baileys',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.baileys,
        connection_attempt_id: this.connectionAttemptId,
        status: this.status,
        code: this.code,
        has_qrcode: true,
        duration_ms: Date.now() - Date.parse(qrGeneratedAt),
        time_to_first_qr_ms: timeToFirstQrMs,
      });
    } catch (error) {
      const errorMessage = this.errorMessage(error);
      try {
        img = renderQrSvgDataUrl(qr);
      } catch {
        const payload = this.state(undefined, undefined, {
          qr_pending: true,
          reason: 'qr_dataurl_generation_failed',
          error: errorMessage,
          time_to_first_qr_ms: timeToFirstQrMs,
          worker_status_id: EWorkerStatus.disponible,
          debug_trace_id: this.debugTraceId,
        });
        this.logDebug('baileys.provider.qr_dataurl_failed', {
          trace_id: this.debugTraceId,
          layer: 'baileys',
          worker_id: getWorker(),
          account_id: getAccount(),
          worker_type_id: EWorkerType.baileys,
          connection_attempt_id: this.connectionAttemptId,
          status: this.status,
          code: this.code,
          reason: errorMessage,
          time_to_first_qr_ms: timeToFirstQrMs,
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
      debug_trace_id: this.debugTraceId,
      qr_generated_at: qrGeneratedAt,
      time_to_first_qr_ms: timeToFirstQrMs,
    };
    this.publishSub(payload, true);
    void this.notifyWorkerStatusSafely(payload, 'qr');
    this.retryCount = 0;
    this.scheduleQrRenewal(id, this.qrHash);

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

    this.pendingResolve = undefined;
  }

  private async onOpen(
    resolve: (s: IBaileysConnectionState) => void,
    id: number
  ): Promise<void> {
    if (id !== this.socketId || !this.socket) {
      return;
    }
    const socket = this.socket;
    this.deviceRemovedConfirmationPending = false;

    // The complete provider/Kafka/fence/central-ACK transition is single-flight.
    // A status probe or retry for this socket joins the exact same confirmation.
    this.cancelTransientDisconnectStatus();
    this.resetQrReadSession();
    this.qrReadSessionLocked = false;
    this.qrHash = undefined;
    this.clearReconnectRetryTimer();

    try {
      await this.runConnectionPhase(
        'credentials_persistence',
        AUTH_STATE_TIMEOUT_MS,
        'credentials_persistence_timeout',
        () => this.awaitCredentialPersistenceBarrier(socket, id)
      );
      if (id !== this.socketId || !this.socket) {
        return;
      }
    } catch (error) {
      if (id !== this.socketId || !this.socket) {
        return;
      }
      const diagnostics = baileysCredentialPersistenceDiagnostics(error);
      this.logDebug('baileys.provider.credentials_persistence_barrier_failed', {
        trace_id: this.debugTraceId,
        layer: 'baileys',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.baileys,
        connection_attempt_id: this.connectionAttemptId,
        runtime_generation: this.runtimeGeneration,
        reason: workerErrorFailureReason(
          'baileys_credentials_persistence_failed',
          error
        ),
        ...diagnostics,
      });
      this.setStatus(Status.connecting, ECodeMessage.awaitConnection);
      const payload = this.state(undefined, undefined, {
        worker_status_id: EWorkerStatus.disponible,
        session_ready: false,
        authenticated: false,
        can_send: false,
        can_receive_runtime: false,
        provider_state: 'connecting',
        degraded_reason: 'credentials_persistence_failed',
      });
      this.publishSub(payload, true);
      void this.notifyWorkerStatusSafely(
        payload,
        'credentials_persistence_failed'
      );
      resolve(payload);
      if (this.pendingResolve === resolve) {
        this.pendingResolve = undefined;
      }
      this.scheduleKafkaReadinessRetry(this.socket, id);
      return;
    }

    const payload = await this.confirmReadyAndPublish('open');
    resolve(payload);
    if (this.pendingResolve === resolve) {
      this.pendingResolve = undefined;
    }
  }

  private async awaitCredentialPersistenceBarrier(
    socket: WASocket,
    socketId: number
  ): Promise<void> {
    const barrier = this.credentialPersistenceBarrier;
    if (!barrier || barrier.socket !== socket) {
      return;
    }

    while (this.isCurrentSocketContext(socket, socketId)) {
      const targetSequence = barrier.sequence;
      await barrier.tail;
      if (barrier.lastError) {
        throw barrier.lastError;
      }
      if (
        barrier.sequence === targetSequence &&
        barrier.acknowledgedSequence >= targetSequence
      ) {
        this.logDebug(
          'baileys.provider.credentials_persistence_barrier_ready',
          {
            trace_id: this.debugTraceId,
            layer: 'baileys',
            worker_id: getWorker(),
            account_id: getAccount(),
            worker_type_id: EWorkerType.baileys,
            connection_attempt_id: this.connectionAttemptId,
            runtime_generation: this.runtimeGeneration,
            sequence: targetSequence,
          }
        );
        return;
      }
    }
  }
  private async logConnectionIpInLocal(): Promise<void> {
    if (!SHOULD_LOG_CONNECTION_IP) {
      return;
    }

    const publicIp = await this.resolvePublicIp(this.activeProxyAgent);
    const ws = this.resolveWebSocket();
    const rawSocket = (
      ws as unknown as {
        _socket?: { remoteAddress?: string; remotePort?: number };
      }
    )._socket;

    console.log('[Baileys][LOCAL][IP] Resultado de rede', {
      proxy: describeBaileysProxyForLog(this.activeProxyUrl),
      public_ip_hash: hashBaileysNetworkLogValue(publicIp),
      ws_remote_address_hash: hashBaileysNetworkLogValue(
        rawSocket?.remoteAddress
      ),
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
          proxy: describeBaileysProxyForLog(this.activeProxyUrl),
          ...workerErrorDiagnostics(error),
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

    const statusCode = this.extractStatusCode(last?.error);
    const statusMessage = this.extractStatusMessage(last?.error);
    if (
      this.explicitSessionRemovalInFlight ||
      this.explicitSessionRemovalSocketId === id
    ) {
      this.logDebug('baileys.provider.close_owned_by_session_removal', {
        trace_id: this.debugTraceId,
        layer: 'baileys',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.baileys,
        connection_attempt_id: this.connectionAttemptId,
        runtime_generation: this.runtimeGeneration,
        disconnect_code: statusCode,
        disconnect_message: statusMessage,
      });
      resolve(this.state());
      this.pendingResolve = undefined;
      return;
    }
    const isDeviceRemovedDisconnect = this.isUnconfirmedDeviceRemovedDisconnect(
      last?.error
    );
    const shouldConfirmDeviceRemoval =
      isDeviceRemovedDisconnect && !this.deviceRemovedConfirmationPending;
    if (shouldConfirmDeviceRemoval) {
      this.deviceRemovedConfirmationPending = true;
    }

    this.invalidateReadyConfirmation();
    this.clearQrRenewalTimer();
    this.baileysIncomingMessageService.markConnectionUnavailable(this.socket);
    void emitWorkerProviderRuntimeState('baileys', false).catch((error) => {
      console.error(
        '[BaileysConnection] Failed to stop Kafka consumers after provider close',
        error
      );
    });
    this.connectionEstablished = false;
    this.setCentralOnlineAcknowledged(false);
    const shouldKeepPairingState =
      statusCode === ECodeMessage.restartRequired &&
      this.isQrPairingInProgress();
    const shouldContinueQrReadSession = this.canContinueQrReadSession();
    const shouldContinueQrLifecycle =
      shouldKeepPairingState || shouldContinueQrReadSession;
    if (statusCode === ECodeMessage.restartRequired) {
      this.qrLifecycleReconnectAuthorized = shouldContinueQrLifecycle;
    }

    this.healthCheckService.stop();
    this.clearReconnectRetryTimer();
    this.cancelKafkaReadinessRetry();

    if (statusCode === ECodeMessage.restartRequired) {
      this.setStatus(
        Status.connecting,
        shouldKeepPairingState
          ? ECodeMessage.pairingInProgress
          : shouldContinueQrReadSession
            ? ECodeMessage.awaitingReadQrCode
            : ECodeMessage.awaitConnection
      );
      if (shouldKeepPairingState) {
        this.publishPairingInProgress('pairing_restart_required');
      }
      resolve(this.state());
      this.pendingResolve = undefined;

      this.scheduleNextReconnectAttempt(shouldContinueQrLifecycle);

      return;
    }

    const isMismatchedStatus =
      !shouldConfirmDeviceRemoval &&
      (statusCode === ECodeMessage.loggedOut ||
        statusCode === ECodeMessage.multideviceMismatch ||
        statusCode === ECodeMessage.badSession ||
        statusCode === ECodeMessage.connectionReplaced);
    const allowActiveQrLifecycle =
      !isMismatchedStatus && shouldContinueQrReadSession;
    if (isMismatchedStatus) {
      this.qrLifecycleReconnectAuthorized = false;
    } else {
      this.qrLifecycleReconnectAuthorized = allowActiveQrLifecycle;
    }

    const disconnectionCode =
      statusCode ?? this.code ?? ECodeMessage.connectionLost;
    const shouldRetryAfterClose = this.shouldScheduleRetryAfterClose(
      allowActiveQrLifecycle
    );
    this.logDebug('baileys.provider.close_received', {
      trace_id: this.debugTraceId,
      layer: 'baileys',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.baileys,
      connection_attempt_id: this.connectionAttemptId,
      status: this.status,
      code: this.code,
      disconnect_code: statusCode,
      disconnect_message: statusMessage,
      disconnection_code: disconnectionCode,
      is_mismatched_status: isMismatchedStatus,
      device_removed_disconnect: isDeviceRemovedDisconnect,
      device_removed_confirmation_attempt: shouldConfirmDeviceRemoval,
      should_retry_after_close: shouldRetryAfterClose,
      has_session: this.hasSession(),
      qr_read_session_active: this.qrReadSessionActive,
      qr_read_session_locked: this.qrReadSessionLocked,
      awaiting_new_login: this.awaitingNewLogin,
    });

    if (isMismatchedStatus) {
      this.setStatus(Status.disconnected, disconnectionCode);
    } else {
      this.setStatus(Status.connecting, ECodeMessage.awaitConnection);
      await this.healthCheckService.notifyDisconnected(
        statusMessage ?? 'Connection closed',
        {
          detectedStatus: Status.connecting,
          workerStatus: EWorkerStatus.disponible,
          providerState: shouldRetryAfterClose ? 'reconnecting' : 'disponible',
          publishStatus: false,
        }
      );
    }

    const workerStatusId = isMismatchedStatus
      ? EWorkerStatus.mismatched
      : EWorkerStatus.disponible;

    if (!this.awaitingNewLogin) {
      const payload: IBaileysConnectionState = {
        status: this.status,
        worker_id: getWorker(),
        account_id: getAccount(),
        code: this.code,
        phone: getPhoneNumber(this.socket?.user?.id),
        worker_status_id: workerStatusId,
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        provider_state: isMismatchedStatus ? 'disconnected' : 'reconnecting',
        degraded_reason:
          statusMessage ??
          (isMismatchedStatus ? 'terminal_disconnect' : 'connection_closed'),
      };

      const payloadStr = JSON.stringify(payload);
      if (payloadStr !== this.lastStatusPayload) {
        if (isMismatchedStatus) {
          this.publishSub(payload, true);
        } else {
          this.publishTelemetry(payload);
        }
        this.lastStatusPayload = payloadStr;

        this.saveLogWppConnection({
          worker_id: getWorker(),
          status: this.status,
          code: this.code?.toString(),
          message: statusMessage ?? 'BaileysConnectionService disconnected',
          date: new Date(),
        });
      }

      if (isMismatchedStatus) {
        this.cancelTransientDisconnectStatus();
        await this.notifyWorkerStatusSafely(payload, 'close');
      } else {
        this.scheduleTransientDisconnectStatus(payload, 'close');
      }
    }

    if (isMismatchedStatus) {
      await this.updateWorkerMismatchedStatus();
    }

    if (statusCode === ECodeMessage.loggedOut) {
      if (shouldConfirmDeviceRemoval) {
        resolve(this.state());
        this.pendingResolve = undefined;
        this.scheduleNextReconnectAttempt(allowActiveQrLifecycle);
        return;
      }

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

      await this.clearSessionStorage();
      this.deviceRemovedConfirmationPending = false;
    }

    resolve(this.state());
    this.pendingResolve = undefined;

    if (!isMismatchedStatus) {
      this.scheduleNextReconnectAttempt(allowActiveQrLifecycle);
    }
  }

  private onNewLoginAttempt() {
    this.deviceRemovedConfirmationPending = false;
    this.cancelKafkaReadinessRetry();
    this.clearQrRenewalTimer();
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
      this.isQrPairingInProgress()
    );
  }

  private maybeMarkPairingInProgressFromCreds(
    creds: Partial<{ registered: boolean; me: unknown }>
  ): void {
    // Baileys may populate `me` before credentials become restorable. The
    // explicit `isNewLogin` event owns that transition; this fallback only
    // accepts the durable `registered=true` boundary.
    if (creds.registered !== true) {
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
      !this.qrReadSessionLocked &&
      !this.postgresAuthStore?.hasPendingHandoff()
    );
  }

  private async rejectQrDuringPostgresHandoff(
    settle: (state: IBaileysConnectionState) => void
  ): Promise<void> {
    const reason = 'qr_presented_during_handoff';
    const postgresAuthStore = this.postgresAuthStore;
    this.logDebug('baileys.provider.handoff.qr_rejected', {
      trace_id: this.debugTraceId,
      layer: 'baileys',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.baileys,
      connection_attempt_id: this.connectionAttemptId,
      runtime_generation: this.runtimeGeneration,
      reason,
    });
    try {
      await postgresAuthStore?.rollbackPendingHandoff(reason);
    } catch (error) {
      this.logDebug('baileys.provider.handoff.qr_rollback_failed', {
        trace_id: this.debugTraceId,
        layer: 'baileys',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.baileys,
        connection_attempt_id: this.connectionAttemptId,
        runtime_generation: this.runtimeGeneration,
        reason: this.errorMessage(error),
      });
    } finally {
      await postgresAuthStore?.close();
    }
    this.postgresAuthStore = undefined;
    this.cancelAttempt(false);
    this.setStatus(Status.disconnected, ECodeMessage.badSession);
    this.connectionEstablished = false;
    const payload = this.state(undefined, undefined, {
      worker_status_id: EWorkerStatus.disponible,
      reason,
      qr_pending: false,
      session_ready: false,
      authenticated: false,
      can_send: false,
      can_receive_runtime: false,
    });
    this.publishSub(payload, true);
    void this.notifyWorkerStatusSafely(payload, reason);
    settle(payload);
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
      this.clearQrRenewalTimer();
      // The manager has already fenced and authorized this attempt. Keep the
      // retry lifecycle active before the first QR as well: a socket may fail
      // while the previous logout/PQ rollback is still being finalized, and
      // that transient boundary must recover without another HTTP request.
      this.qrLifecycleReconnectAuthorized = true;
      this.qrReadSessionActive = true;
      this.qrReadSessionLocked = false;
      this.qrGenerationCount = 0;
      this.qrHash = undefined;
    }
  }

  private resetQrReadSession(): void {
    this.clearQrRenewalTimer();
    this.qrLifecycleReconnectAuthorized = false;
    this.qrReadSessionActive = false;
    this.qrGenerationCount = 0;
  }

  private isActiveQrReadSession(): boolean {
    return (
      this.initialConnection &&
      this.typeConnection === EBaileysConnectionType.qrcode &&
      this.qrReadSessionActive &&
      !this.qrReadSessionLocked &&
      Boolean(this.qrHash)
    );
  }

  private canContinueQrReadSession(): boolean {
    return (
      this.initialConnection &&
      this.typeConnection === EBaileysConnectionType.qrcode &&
      this.qrReadSessionActive &&
      !this.qrReadSessionLocked &&
      this.qrGenerationCount < this.maxQrGenerations
    );
  }

  private shouldScheduleRetryAfterClose(
    allowActiveQrLifecycle = this.qrLifecycleReconnectAuthorized
  ): boolean {
    if (
      this.postgresLeaseRecoveryRequired &&
      this.postgresLeaseRecoveryResumeGeneration !==
        this.postgresLeaseRecoveryGeneration
    ) {
      return false;
    }
    if (this.userRequestedDisconnect) {
      return false;
    }

    if (!this.initialConnection) {
      return false;
    }

    if (!this.hasSession() && !allowActiveQrLifecycle) {
      return false;
    }

    return !this.isTerminalSessionDisconnectCode(this.code);
  }

  private isTerminalSessionDisconnectCode(code: ECodeMessage): boolean {
    return [
      ECodeMessage.loggedOut,
      ECodeMessage.multideviceMismatch,
      ECodeMessage.connectionReplaced,
      ECodeMessage.badSession,
    ].includes(code);
  }

  private async handleQrGenerationLimitReached(): Promise<void> {
    this.clearQrRenewalTimer();
    this.qrLifecycleReconnectAuthorized = false;
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
      connection_attempt_id: this.connectionAttemptId,
      debug_trace_id: this.debugTraceId,
      runtime_generation: this.runtimeGeneration,
    };

    this.publishSub(payload, true);
    // The terminal event releases the modal to offer a fresh QR attempt. Give
    // its durable/outbox publication a bounded head start, but never keep a
    // provider socket alive indefinitely when the central path is degraded.
    try {
      await this.withDeadline(
        this.notifyWorkerStatusSafely(payload, 'qr_limit_reached'),
        CONNECTION_QR_TERMINAL_PUBLISH_TIMEOUT_MS,
        'qr_terminal_publish_timeout'
      );
    } catch (error) {
      console.error('[BaileysConnection] QR terminal publication delayed', {
        ...workerErrorDiagnostics(error),
      });
    } finally {
      this.cancelAttempt(false);
    }
  }

  hasSession(): boolean {
    if (usesPostgresSessionStorage()) {
      if (this.isTerminalSessionDisconnectCode(this.code)) {
        return false;
      }
      const liveEvidence =
        this.postgresAuthStore?.hasRestorableSessionCached() ?? false;
      if (liveEvidence) {
        this.postgresRestorableSessionRetained = true;
      }
      return liveEvidence || this.postgresRestorableSessionRetained;
    }
    return fs.existsSync(getFolder()) && fs.readdirSync(getFolder()).length > 0;
  }

  private async loadPostgresAuthenticationState() {
    const store = this.getPostgresAuthStore();
    const terminalBeforeLoad = this.isTerminalSessionDisconnectCode(this.code);
    const userDisconnectBeforeLoad = this.userRequestedDisconnect;
    const authentication = await store.loadAuthenticationState();
    await this.bootstrapLegacyVolumeMigration(store);
    if (this.postgresAuthStore !== store) {
      throw new BaileysSessionFenceError(
        'baileys_postgres_session_store_replaced_during_load'
      );
    }
    const terminalAfterLoad = this.isTerminalSessionDisconnectCode(this.code);
    const userDisconnectAfterLoad = this.userRequestedDisconnect;
    if (
      (!terminalBeforeLoad && terminalAfterLoad) ||
      (!userDisconnectBeforeLoad && userDisconnectAfterLoad)
    ) {
      this.postgresRestorableSessionRetained = false;
      throw new BaileysSessionFenceError(
        'baileys_postgres_session_terminated_during_load'
      );
    }
    this.postgresRestorableSessionRetained =
      !terminalAfterLoad &&
      !userDisconnectAfterLoad &&
      store.hasRestorableSessionCached();
    return authentication;
  }

  private async bootstrapLegacyVolumeMigration(
    store: BaileysPostgresAuthStateStore
  ): Promise<void> {
    const migrationId = process.env.SESSION_STORAGE_MIGRATION_ID?.trim();
    if (!migrationId || this.legacyVolumeMigrationBootstrapped) {
      return;
    }

    const expectedChecksum =
      process.env.LEGACY_SESSION_CHECKSUM_SHA256?.trim().toLowerCase();
    if (!expectedChecksum || !/^[a-f0-9]{64}$/.test(expectedChecksum)) {
      throw new BaileysLegacyVolumeMigrationError(
        'legacy_session_migration_checksum_invalid'
      );
    }

    const revision = store.getRevisionInfoCached();
    if (
      revision &&
      ['validating', 'active'].includes(revision.status) &&
      store.hasRestorableSessionCached()
    ) {
      this.legacyVolumeMigrationBootstrapped = true;
      return;
    }
    if (revision?.status !== 'staging') {
      throw new BaileysLegacyVolumeMigrationError(
        'legacy_session_migration_revision_not_stageable'
      );
    }

    const legacyRoot = '/app/legacy-session';
    const snapshot = await snapshotLegacySessionVolume(legacyRoot);
    if (snapshot.checksumSha256 !== expectedChecksum) {
      throw new BaileysLegacyVolumeMigrationError(
        'legacy_session_migration_checksum_mismatch'
      );
    }

    const files = await readBaileysLegacyVolumeAuthFiles(
      legacyRoot,
      getWorker()
    );

    const records = normalizeSecureImportRecords({
      format_version: '1',
      source: 'whatsapp_web',
      target_provider: 'baileys',
      payload: {
        baileys_multi_file_auth_state: {
          files,
          storage_layout: 'multi_file_auth_state_v1',
        },
      },
    });
    await store.stageImport(records, 'legacy-volume-v1');
    if (!store.hasRestorableSessionCached()) {
      throw new BaileysLegacyVolumeMigrationError(
        'legacy_session_migration_not_restorable'
      );
    }
    this.legacyVolumeMigrationBootstrapped = true;
  }

  async refreshPersistedSessionState(): Promise<boolean> {
    if (!usesPostgresSessionStorage()) {
      return this.hasSession();
    }

    await this.runConnectionPhase(
      'postgres_auth_state_preload',
      AUTH_STATE_TIMEOUT_MS,
      'postgres_auth_state_timeout',
      () => this.loadPostgresAuthenticationState()
    );
    return this.hasSession();
  }

  async verifyAndPublishConnectionStatus(
    input: BaileysConnectionMetadataInput = {}
  ): Promise<IBaileysConnectionState> {
    return this.confirmReadyAndPublish('verify', input);
  }

  private async runReadyConfirmation(
    context: BaileysReadyConfirmationContext
  ): Promise<IBaileysConnectionState> {
    const initialReadiness =
      await this.healthCheckService.verifyCurrentSession();
    if (!this.isCurrentReadyConfirmation(context)) {
      return this.state();
    }

    if (!initialReadiness.session_ready) {
      return this.handleSessionNotReady(context, initialReadiness);
    }

    try {
      const readiness = await this.activateReadyRuntime(context);
      if (!readiness) {
        return this.state();
      }
      return await this.finalizeReadyConfirmation(context, readiness);
    } catch (error) {
      return this.handleReadyRuntimeFailure(context, initialReadiness, error);
    }
  }

  private async activateReadyRuntime(
    context: BaileysReadyConfirmationContext
  ): Promise<BaileysReadinessResult | undefined> {
    const marked = await this.baileysIncomingMessageService.markConnectionReady(
      context.socket
    );
    if (!this.isCurrentReadyConfirmation(context)) {
      this.baileysIncomingMessageService.markConnectionUnavailable(
        context.socket
      );
      return undefined;
    }
    if (!marked) {
      throw new Error('whatsapp_runtime_fence_activation_failed');
    }

    await this.waitForKafkaReadinessGate(
      context.socket,
      context.socketId,
      context.epoch
    );
    if (!this.isCurrentReadyConfirmation(context)) {
      return undefined;
    }

    const readiness = await this.healthCheckService.verifyCurrentSession();
    if (!this.isCurrentReadyConfirmation(context)) {
      return undefined;
    }
    this.assertStrongProviderReadiness(readiness);

    return readiness;
  }

  private assertStrongProviderReadiness(
    readiness: BaileysReadinessResult
  ): void {
    if (
      readiness.session_ready === true &&
      readiness.can_send === true &&
      readiness.can_receive_runtime === true &&
      readiness.authenticated === true
    ) {
      return;
    }

    throw new Error(
      readiness.degraded_reason ??
        readiness.reason ??
        'provider_became_unavailable_during_consumer_startup'
    );
  }

  private async handleSessionNotReady(
    context: BaileysReadyConfirmationContext,
    readiness: BaileysReadinessResult
  ): Promise<IBaileysConnectionState> {
    if (!this.isCurrentReadyConfirmation(context)) {
      return this.state();
    }

    this.baileysIncomingMessageService.markConnectionUnavailable(
      context.socket
    );
    if (context.source === 'open') {
      this.cancelKafkaReadinessRetry();
    }
    this.setStatus(Status.connecting, ECodeMessage.awaitConnection);
    this.connectionEstablished = false;

    const payload = this.buildUnavailableReadyPayload(context, readiness, {
      can_send: readiness.can_send,
      provider_state: readiness.provider_state,
      degraded_reason:
        readiness.degraded_reason ?? readiness.reason ?? 'session_not_ready',
    });
    this.healthCheckService.markStatusPublished(readiness);
    this.publishReadyPayload(context, payload);
    await this.notifyWorkerStatusSafely(
      payload,
      context.source === 'open'
        ? 'open_verification_failed'
        : 'verify_not_ready'
    );
    if (!this.isCurrentReadyConfirmation(context)) {
      return this.state();
    }

    if (context.source === 'open') {
      this.scheduleNextReconnectAttempt();
    } else {
      this.scheduleKafkaReadinessRetry(context.socket, context.socketId);
    }
    return payload;
  }

  private async handleReadyRuntimeFailure(
    context: BaileysReadyConfirmationContext,
    readiness: BaileysReadinessResult,
    error: unknown
  ): Promise<IBaileysConnectionState> {
    if (!this.isCurrentReadyConfirmation(context)) {
      return this.state();
    }

    if (error instanceof BaileysCanonicalCodecError) {
      return this.handleTerminalHandoffCandidateFailure(
        context,
        readiness,
        error
      );
    }

    const preserveProviderRuntime = isKafkaConsumerReadinessPending(error);
    if (!preserveProviderRuntime) {
      this.baileysIncomingMessageService.markConnectionUnavailable(
        context.socket
      );
    }
    this.setStatus(
      Status.connecting,
      ECodeMessage.awaitConnection,
      preserveProviderRuntime
    );
    this.connectionEstablished = false;
    if (!preserveProviderRuntime) {
      this.healthCheckService.stop();
    }

    const payload = this.buildUnavailableReadyPayload(context, readiness, {
      can_send: false,
      provider_state: 'kafka_consumers_not_ready',
      degraded_reason: getErrorMessage(error),
    });
    this.publishReadyPayload(context, payload);
    await this.notifyWorkerStatusSafely(
      payload,
      context.source === 'open'
        ? 'open_kafka_consumers_failed'
        : 'verify_kafka_consumers_failed'
    );
    if (this.isCurrentReadyConfirmation(context)) {
      this.scheduleKafkaReadinessRetry(context.socket, context.socketId);
    }
    return payload;
  }

  private async handleTerminalHandoffCandidateFailure(
    context: BaileysReadyConfirmationContext,
    readiness: BaileysReadinessResult,
    error: BaileysCanonicalCodecError
  ): Promise<IBaileysConnectionState> {
    this.baileysIncomingMessageService.markConnectionUnavailable(
      context.socket
    );
    this.userRequestedDisconnect = true;
    this.initialConnection = false;
    try {
      await this.closeProviderSocketForHandoff(context.socket);
    } catch (closeError) {
      this.logDebug('baileys.provider.handoff.terminal_socket_close_failed', {
        trace_id: context.debugTraceId,
        layer: 'baileys',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.baileys,
        connection_attempt_id: context.connectionAttemptId,
        runtime_generation: context.runtimeGeneration,
        reason: this.errorMessage(closeError),
      });
    }
    if (this.socket === context.socket) this.socket = undefined;
    this.setStatus(Status.disconnected, ECodeMessage.badSession);
    this.cancelAttempt(true);
    this.healthCheckService.stop();

    const postgresAuthStore = this.postgresAuthStore;
    this.postgresAuthStore = undefined;
    try {
      await postgresAuthStore?.close();
    } catch (closeError) {
      this.logDebug('baileys.provider.handoff.terminal_store_close_failed', {
        trace_id: context.debugTraceId,
        layer: 'baileys',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.baileys,
        connection_attempt_id: context.connectionAttemptId,
        runtime_generation: context.runtimeGeneration,
        reason: this.errorMessage(closeError),
      });
    }

    const payload: IBaileysConnectionState = {
      ...this.buildUnavailableReadyPayload(context, readiness, {
        can_send: false,
        provider_state: 'invalid_session',
        degraded_reason: error.code,
      }),
      status: Status.disconnected,
      code: ECodeMessage.badSession,
      worker_status_id: EWorkerStatus.error,
      qr_pending: false,
      session_ready: false,
      authenticated: false,
      can_send: false,
      can_receive_runtime: false,
    };
    this.publishReadyPayload(context, payload);
    await this.notifyWorkerStatusSafely(
      payload,
      `handoff_candidate_terminal:${error.code}`
    );
    return payload;
  }

  private buildUnavailableReadyPayload(
    context: BaileysReadyConfirmationContext,
    readiness: BaileysReadinessResult,
    overrides: Pick<
      IBaileysConnectionState,
      'can_send' | 'provider_state' | 'degraded_reason'
    >
  ): IBaileysConnectionState {
    return {
      status: this.status,
      worker_id: getWorker(),
      account_id: getAccount(),
      code: this.code,
      phone: getPhoneNumber(context.socket.user?.id),
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: context.connectionAttemptId,
      runtime_generation: context.runtimeGeneration,
      debug_trace_id: context.debugTraceId,
      session_ready: false,
      can_send: overrides.can_send,
      can_receive_runtime: readiness.can_receive_runtime,
      authenticated: readiness.authenticated,
      provider_state: overrides.provider_state,
      degraded_reason: overrides.degraded_reason,
      last_probe_at: readiness.last_probe_at,
      probe_latency_ms: readiness.probe_latency_ms,
    };
  }

  private buildOnlineReadyPayload(
    context: BaileysReadyConfirmationContext,
    readiness: BaileysReadinessResult
  ): IBaileysConnectionState {
    return {
      status: Status.connected,
      worker_id: getWorker(),
      account_id: getAccount(),
      code: ECodeMessage.connectionEstablished,
      phone: getPhoneNumber(context.socket.user?.id),
      worker_status_id: EWorkerStatus.online,
      connection_attempt_id: context.connectionAttemptId,
      runtime_generation: context.runtimeGeneration,
      debug_trace_id: context.debugTraceId,
      session_ready: true,
      can_send: readiness.can_send,
      can_receive_runtime: readiness.can_receive_runtime,
      authenticated: readiness.authenticated,
      provider_state: readiness.provider_state,
      degraded_reason: readiness.degraded_reason,
      last_probe_at: readiness.last_probe_at,
      probe_latency_ms: readiness.probe_latency_ms,
    };
  }

  private publishReadyPayload(
    context: BaileysReadyConfirmationContext,
    payload: IBaileysConnectionState
  ): void {
    this.lastStatusPayload = JSON.stringify(payload);
    this.publishSub(payload, context.source === 'verify');
  }

  private async finalizeReadyConfirmation(
    context: BaileysReadyConfirmationContext,
    readiness: BaileysReadinessResult
  ): Promise<IBaileysConnectionState> {
    if (usesPostgresSessionStorage()) {
      await this.getPostgresAuthStore().promoteStagedImportIfReady();
    }
    const payload = this.buildOnlineReadyPayload(context, readiness);
    const hadConfirmedOnline =
      this.centralOnlineAcknowledged &&
      this.connectionEstablished &&
      this.status === Status.connected;
    const notification = await this.notifyWorkerStatusSafely(
      payload,
      context.source === 'open' ? 'open' : 'verify_ready'
    );
    if (!this.isCurrentReadyConfirmation(context)) {
      this.baileysIncomingMessageService.markConnectionUnavailable(
        context.socket
      );
      return this.state();
    }

    if (notification.outcome === 'accepted') {
      return this.commitReadyConfirmation(context, readiness, payload);
    }

    return this.handleReadyNotificationFailure(
      context,
      readiness,
      payload,
      notification,
      hadConfirmedOnline
    );
  }

  private commitReadyConfirmation(
    context: BaileysReadyConfirmationContext,
    readiness: BaileysReadinessResult,
    payload: IBaileysConnectionState
  ): IBaileysConnectionState {
    this.setStatus(Status.connected, ECodeMessage.connectionEstablished);
    this.connectionEstablished = true;
    this.setCentralOnlineAcknowledged(true);
    this.cancelKafkaReadinessRetry();
    this.healthCheckService.markStatusPublished(readiness);
    this.publishReadyPayload(context, payload);
    this.healthCheckService.start(HEALTH_CHECK_INTERVAL_MS);
    if (context.source === 'open') {
      void this.logConnectionIpInLocal();
    }
    return payload;
  }

  private handleReadyNotificationFailure(
    context: BaileysReadyConfirmationContext,
    readiness: BaileysReadinessResult,
    payload: IBaileysConnectionState,
    notification: Exclude<
      WorkerStatusNotificationResult,
      { outcome: 'accepted' }
    >,
    hadConfirmedOnline: boolean
  ): IBaileysConnectionState {
    const recoverable =
      notification.outcome === 'failed' &&
      notification.classification === 'recoverable';
    const reason =
      notification.outcome === 'failed'
        ? notification.reason
        : 'unexpected_worker_status_deferral';
    this.logReadyNotificationFailure(context, payload, recoverable, reason);

    if (recoverable && hadConfirmedOnline) {
      this.healthCheckService.markStatusPublished(readiness);
      return payload;
    }

    if (!recoverable) {
      this.invalidateReadyConfirmation();
      this.cancelKafkaReadinessRetry();
      this.baileysIncomingMessageService.markConnectionUnavailable(
        context.socket
      );
      this.healthCheckService.stop();
    }

    this.setStatus(
      Status.connecting,
      ECodeMessage.awaitConnection,
      recoverable
    );
    this.connectionEstablished = false;
    const pendingPayload = this.buildNotificationFailurePayload(
      payload,
      readiness,
      recoverable,
      reason
    );
    this.publishReadyPayload(context, pendingPayload);
    if (recoverable) {
      this.scheduleKafkaReadinessRetry(context.socket, context.socketId);
    }
    return pendingPayload;
  }

  private logReadyNotificationFailure(
    context: BaileysReadyConfirmationContext,
    payload: IBaileysConnectionState,
    recoverable: boolean,
    reason: string
  ): void {
    console.warn(
      '[BaileysConnection] Connected status was not published because NotifyWorkerStatus failed',
      {
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        connection_attempt_id: context.connectionAttemptId,
        classification: recoverable ? 'recoverable' : 'terminal',
        error: reason,
      }
    );
  }

  private buildNotificationFailurePayload(
    payload: IBaileysConnectionState,
    readiness: BaileysReadinessResult,
    recoverable: boolean,
    reason: string
  ): IBaileysConnectionState {
    return {
      ...payload,
      status: this.status,
      code: this.code,
      worker_status_id: EWorkerStatus.disponible,
      session_ready: false,
      can_send: false,
      can_receive_runtime: recoverable ? readiness.can_receive_runtime : false,
      provider_state: recoverable
        ? 'worker_status_not_published'
        : 'worker_status_rejected',
      degraded_reason: reason,
    };
  }
  private async restoreWithRetries(): Promise<IBaileysConnectionState> {
    try {
      return await this.connectExclusive({
        initial_connection: this.initialConnection,
        allow_restore: false,
        from_disconnect_restart: true,
        requested_by_user: false,
        connection_attempt_id: this.connectionAttemptId,
        runtime_generation: this.runtimeGeneration,
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
    const payloadWithConnectionMetadata = this.withConnectionMetadata(payload);
    this.logDebug('baileys.provider.status_staged', {
      trace_id: payloadWithConnectionMetadata.debug_trace_id,
      layer: 'baileys',
      worker_id: payloadWithConnectionMetadata.worker_id,
      account_id: payloadWithConnectionMetadata.account_id,
      worker_type_id: payloadWithConnectionMetadata.worker_type_id,
      connection_attempt_id:
        payloadWithConnectionMetadata.connection_attempt_id,
      runtime_generation: payloadWithConnectionMetadata.runtime_generation,
      status: payloadWithConnectionMetadata.status,
      code: payloadWithConnectionMetadata.code,
      reason: payloadWithConnectionMetadata.reason,
      worker_status_id: payloadWithConnectionMetadata.worker_status_id,
      session_ready: payloadWithConnectionMetadata.session_ready,
      can_send: payloadWithConnectionMetadata.can_send,
      can_receive_runtime: payloadWithConnectionMetadata.can_receive_runtime,
      authenticated: payloadWithConnectionMetadata.authenticated,
      provider_state: payloadWithConnectionMetadata.provider_state,
      degraded_reason: payloadWithConnectionMetadata.degraded_reason,
      phone: payloadWithConnectionMetadata.phone,
      has_qrcode: Boolean(payloadWithConnectionMetadata.qrcode),
      has_pairing_code: Boolean(payloadWithConnectionMetadata.pairing_code),
      has_passkey_public_key: Boolean(
        payloadWithConnectionMetadata.passkey_public_key
      ),
      passkey_public_key_len:
        payloadWithConnectionMetadata.passkey_public_key?.length ?? 0,
      has_passkey_confirmation_code: Boolean(
        payloadWithConnectionMetadata.passkey_confirmation_code
      ),
      passkey_skip_handoff_ux:
        payloadWithConnectionMetadata.passkey_skip_handoff_ux === true,
      force,
    });
    if (!this.initialConnection && !force) {
      return;
    }

    const data = JSON.stringify(payloadWithConnectionMetadata);
    if (data === this.lastPayload && !force) {
      return;
    }

    this.lastPayload = data;
  }

  private publishTelemetry(payload: IBaileysConnectionState): void {
    const payloadWithConnectionMetadata = this.withConnectionMetadata(payload);
    this.lastPayload = JSON.stringify(payloadWithConnectionMetadata);
    void (
      this.balanceWorkerStatusGrpcClientService.publishWorkerRuntimeEvent?.(
        payloadWithConnectionMetadata
      ) ?? Promise.resolve()
    ).catch((error) => {
      console.error('[BaileysConnection] Runtime telemetry failed', {
        ...workerErrorDiagnostics(error),
      });
    });
  }

  private async notifyWorkerStatusSafely(
    payload: IBaileysConnectionState,
    context: string
  ): Promise<WorkerStatusNotificationResult> {
    const payloadWithConnectionMetadata = this.withConnectionMetadata(payload);
    const providerState = (
      payloadWithConnectionMetadata.provider_state ?? ''
    ).toLowerCase();
    const degradedReason = (
      payloadWithConnectionMetadata.degraded_reason ?? ''
    ).toLowerCase();
    const isPreservedKafkaPositioning =
      providerState === 'kafka_consumers_not_ready' &&
      degradedReason.startsWith('kafka_consumers_not_ready:');
    if (
      payloadWithConnectionMetadata.worker_status_id ===
        EWorkerStatus.disponible &&
      isPreservedKafkaPositioning
    ) {
      this.logDebug('baileys.provider.central_status_deferred', {
        trace_id: payloadWithConnectionMetadata.debug_trace_id,
        layer: 'baileys',
        worker_id: payloadWithConnectionMetadata.worker_id,
        account_id: payloadWithConnectionMetadata.account_id,
        worker_type_id: payloadWithConnectionMetadata.worker_type_id,
        connection_attempt_id:
          payloadWithConnectionMetadata.connection_attempt_id,
        runtime_generation: payloadWithConnectionMetadata.runtime_generation,
        status: payloadWithConnectionMetadata.status,
        code: payloadWithConnectionMetadata.code,
        reason: context,
        worker_status_id: payloadWithConnectionMetadata.worker_status_id,
        session_ready: false,
        can_send: payloadWithConnectionMetadata.can_send,
        can_receive_runtime: payloadWithConnectionMetadata.can_receive_runtime,
        authenticated: true,
        provider_state: payloadWithConnectionMetadata.provider_state,
        degraded_reason:
          payloadWithConnectionMetadata.degraded_reason ??
          'command_ingress_positioning',
      });
      return {
        outcome: 'deferred',
        reason: 'command_ingress_positioning',
      };
    }
    try {
      this.logDebug('baileys.provider.notify_status', {
        trace_id: payloadWithConnectionMetadata.debug_trace_id,
        layer: 'baileys',
        worker_id: payloadWithConnectionMetadata.worker_id,
        account_id: payloadWithConnectionMetadata.account_id,
        worker_type_id: payloadWithConnectionMetadata.worker_type_id,
        connection_attempt_id:
          payloadWithConnectionMetadata.connection_attempt_id,
        runtime_generation: payloadWithConnectionMetadata.runtime_generation,
        status: payloadWithConnectionMetadata.status,
        code: payloadWithConnectionMetadata.code,
        reason: context,
        worker_status_id: payloadWithConnectionMetadata.worker_status_id,
        session_ready: payloadWithConnectionMetadata.session_ready,
        can_send: payloadWithConnectionMetadata.can_send,
        can_receive_runtime: payloadWithConnectionMetadata.can_receive_runtime,
        authenticated: payloadWithConnectionMetadata.authenticated,
        provider_state: payloadWithConnectionMetadata.provider_state,
        degraded_reason: payloadWithConnectionMetadata.degraded_reason,
        phone: payloadWithConnectionMetadata.phone,
        has_qrcode: Boolean(payloadWithConnectionMetadata.qrcode),
        has_pairing_code: Boolean(payloadWithConnectionMetadata.pairing_code),
        has_passkey_public_key: Boolean(
          payloadWithConnectionMetadata.passkey_public_key
        ),
        has_passkey_confirmation_code: Boolean(
          payloadWithConnectionMetadata.passkey_confirmation_code
        ),
        passkey_skip_handoff_ux:
          payloadWithConnectionMetadata.passkey_skip_handoff_ux === true,
      });
      const nativeStatus = payloadWithConnectionMetadata.connection_status;
      const claimsStrongOnline =
        payloadWithConnectionMetadata.worker_status_id ===
          EWorkerStatus.online &&
        payloadWithConnectionMetadata.session_ready === true &&
        payloadWithConnectionMetadata.can_send === true &&
        payloadWithConnectionMetadata.can_receive_runtime === true &&
        payloadWithConnectionMetadata.authenticated === true;
      const currentNativeStatus = this.getConnectionStatus();
      if (
        claimsStrongOnline &&
        (payloadWithConnectionMetadata.connection_status_source_id !==
          this.nativeConnectionStatusSourceId ||
          !isWhatsappConnectionOnline(currentNativeStatus) ||
          !isWhatsappConnectionOnline(nativeStatus))
      ) {
        throw new Error('baileys_online_native_connection_status_unavailable');
      }
      if (claimsStrongOnline) {
        payloadWithConnectionMetadata.connection_status = currentNativeStatus;
      }
      const requiresLeaseProof =
        usesPostgresSessionStorage() &&
        claimsStrongOnline &&
        isWhatsappConnectionOnline(nativeStatus);
      const leaseProof = requiresLeaseProof
        ? this.postgresAuthStore?.getConnectionStatusLeaseProof()
        : undefined;
      if (requiresLeaseProof && !leaseProof) {
        throw new Error(
          'baileys_online_connection_status_lease_proof_unavailable'
        );
      }
      if (leaseProof) {
        await this.balanceWorkerStatusGrpcClientService.notifyWorkerStatus(
          payloadWithConnectionMetadata,
          { connectionStatusLeaseProof: leaseProof }
        );
      } else {
        await this.balanceWorkerStatusGrpcClientService.notifyWorkerStatus(
          payloadWithConnectionMetadata
        );
      }
      return { outcome: 'accepted' };
    } catch (error) {
      const failure = classifyWorkerStatusNotificationFailure(error);
      console.error('[BaileysConnection] NotifyWorkerStatus failed', {
        context,
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        worker_status_id: payload.worker_status_id,
        reason: failure.reason,
        classification: failure.classification,
        grpc_code: failure.grpcCode,
        ...workerErrorDiagnostics(error),
      });
      return failure;
    }
  }

  private async updateWorkerMismatchedStatus(): Promise<void> {
    const payload: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: Status.disconnected,
      worker_id: getWorker(),
      account_id: getAccount(),
      phone: getPhoneNumber(this.socket?.user?.id),
      worker_status_id: EWorkerStatus.mismatched,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      provider_state: 'mismatched',
      degraded_reason: 'mismatched',
    };

    this.publishSub(payload);

    await this.notifyWorkerStatusSafely(payload, 'mismatched_status');
  }

  private async safeLogout(
    forceLogout = false,
    disconnectCode = ECodeMessage.loggedOut
  ): Promise<void> {
    this.invalidateReadyConfirmation();
    this.clearReconnectRetryTimer();
    this.clearQrRenewalTimer();

    const socket = this.socket;
    if (forceLogout && socket?.user) {
      try {
        await this.invokeProviderLifecycleOperation(
          socket,
          'logout',
          () => socket.logout(),
          false
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch {
        this.saveLogWppConnection({
          worker_id: getWorker(),
          status: Status.disconnected,
          code: ECodeMessage.connectionLost,
          message: 'Error during logout',
          date: new Date(),
        });
        if (typeof socket.end === 'function') {
          await socket.end(undefined).catch(() => undefined);
        }
      }

      this.setStatus(Status.disconnected, ECodeMessage.loggedOut);
      if (this.socket === socket) this.socket = undefined;
      return;
    }

    try {
      if (socket && typeof socket.end === 'function') {
        await this.invokeProviderLifecycleOperation(
          socket,
          'end',
          () => socket.end(undefined),
          false
        );
      }
    } catch {
      this.saveLogWppConnection({
        worker_id: getWorker(),
        status: Status.disconnected,
        code: ECodeMessage.connectionLost,
        message: 'Error during WebSocket close',
        date: new Date(),
      });
      await socket?.end(undefined).catch(() => undefined);
    }

    this.setStatus(Status.disconnected, disconnectCode);
    if (this.socket === socket) this.socket = undefined;
  }

  private cancelAttempt(skipWebSocketClose = false) {
    this.invalidateReadyConfirmation();
    this.clearReconnectRetryTimer();
    this.clearQrRenewalTimer();
    this.cancelKafkaReadinessRetry();

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
    this.setCentralOnlineAcknowledged(false);

    if (!skipWebSocketClose) {
      this.socket = undefined;
    }
  }

  private async reportConnected(): Promise<IBaileysConnectionState> {
    if (!this.initialConnection) {
      return this.state();
    }

    this.lastPayload = null;
    return this.verifyAndPublishConnectionStatus({
      connection_attempt_id: this.connectionAttemptId,
      runtime_generation: this.runtimeGeneration,
      debug_trace_id: this.debugTraceId,
    });
  }

  private prepareFolder() {
    if (usesPostgresSessionStorage()) {
      return;
    }
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

  private async handlePostgresSessionLeaseLost(
    store: BaileysPostgresAuthStateStore,
    error: BaileysSessionFenceError
  ): Promise<void> {
    if (this.postgresAuthStore !== store) {
      return;
    }

    if (
      this.userRequestedDisconnect ||
      this.explicitSessionRemovalInFlight ||
      this.providerHandoffKey ||
      this.isTerminalSessionDisconnectCode(this.code)
    ) {
      this.postgresRestorableSessionRetained = false;
      this.postgresLeaseRecoveryRequired = false;
      this.postgresLeaseRecoveryGeneration += 1;
      this.postgresLeaseRecoveryResumeGeneration = undefined;
      this.postgresAuthStore = undefined;
      await store.close().catch(() => undefined);
      return;
    }

    this.postgresRestorableSessionRetained =
      store.hasRestorableSessionCached() ||
      this.postgresRestorableSessionRetained;
    this.postgresLeaseRecoveryRequired = true;
    this.postgresLeaseRecoveryGeneration += 1;
    this.postgresLeaseRecoveryResumeGeneration = undefined;
    this.logDebug('baileys.provider.postgres_session_lease_lost', {
      trace_id: this.debugTraceId,
      layer: 'baileys',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.baileys,
      connection_attempt_id: this.connectionAttemptId,
      runtime_generation: this.runtimeGeneration,
      reason: error.code,
      recoverable_session: this.postgresRestorableSessionRetained,
    });

    // Close provider effects synchronously. The database availability guard
    // owns durable fence reacquisition and must be the only path that starts a
    // replacement socket after this point.
    this.cancelAttempt(false);

    const listeners = [...this.postgresSessionLeaseLostListeners];
    const outcomes = await Promise.allSettled(
      listeners.map((listener) => Promise.resolve(listener(error)))
    );
    outcomes.forEach((outcome) => {
      if (outcome.status === 'rejected') {
        console.error('[BaileysConnection] Session lease-loss handler failed', {
          ...workerErrorDiagnostics(outcome.reason),
        });
      }
    });

    // The supervisor normally closes and detaches this store from suspend().
    // Keep a local fallback so a missing/failed subscriber cannot leave the
    // old generation or its auto-renew resources alive.
    if (this.postgresAuthStore === store) {
      this.postgresAuthStore = undefined;
      await store.close().catch((closeError) => {
        console.error(
          '[BaileysConnection] Failed to close fenced PostgreSQL session store',
          { ...workerErrorDiagnostics(closeError) }
        );
      });
    }
  }

  private async clearSessionStorage(): Promise<void> {
    if (this.sessionClearFlight) {
      await this.sessionClearFlight;
      return;
    }

    this.postgresRestorableSessionRetained = false;
    this.postgresLeaseRecoveryRequired = false;
    this.postgresLeaseRecoveryGeneration += 1;
    this.postgresLeaseRecoveryResumeGeneration = undefined;

    const flight = (async (): Promise<void> => {
      if (usesPostgresSessionStorage()) {
        const postgresAuthStore = this.getPostgresAuthStore();
        try {
          await postgresAuthStore.clearSession();
        } finally {
          if (this.postgresAuthStore === postgresAuthStore) {
            this.postgresAuthStore = undefined;
          }
          this.runtimeFenceConnectionAuthorization = undefined;
          await postgresAuthStore.close();
        }
        return;
      }
      this.clearFolder();
    })().finally(() => {
      if (this.sessionClearFlight === flight) {
        this.sessionClearFlight = undefined;
      }
    });
    this.sessionClearFlight = flight;
    await flight;
  }

  /**
   * A bootstrap attempted before the manager grants the replacement
   * connection epoch may hold a fenced or rejected native store opening.
   * Detach it after the previous socket is closed so the imported revision is
   * always opened under the newly activated manager-owned epoch.
   */
  private async resetPostgresAuthStoreForAuthorizedImport(): Promise<void> {
    const store = this.postgresAuthStore;
    if (!store) {
      return;
    }

    this.postgresAuthStore = undefined;
    await store.close().catch((error) => {
      this.logDebug('baileys.provider.secure_session_import.store_reset', {
        trace_id: this.debugTraceId,
        layer: 'baileys',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.baileys,
        connection_attempt_id: this.connectionAttemptId,
        runtime_generation: this.runtimeGeneration,
        reason: workerErrorFailureReason(
          'secure_session_import_store_reset_failed',
          error
        ),
      });
    });
  }

  private getPostgresAuthStore(): BaileysPostgresAuthStateStore {
    if (!usesPostgresSessionStorage()) {
      throw new Error(
        'Baileys PostgreSQL session store requested in legacy mode'
      );
    }
    if (!this.postgresAuthStore) {
      const store = BaileysPostgresAuthStateStore.fromEnvironment(getWorker(), {
        onLeaseLost: (error) =>
          this.handlePostgresSessionLeaseLost(store, error),
      });
      this.postgresAuthStore = store;
    }
    return this.postgresAuthStore;
  }

  private setStatus(
    s: Status,
    c?: ECodeMessage,
    preserveProviderRuntime = false
  ) {
    this.status = s;

    if (c && this.isTerminalSessionDisconnectCode(c)) {
      this.postgresRestorableSessionRetained = false;
      this.postgresLeaseRecoveryRequired = false;
      this.postgresLeaseRecoveryGeneration += 1;
      this.postgresLeaseRecoveryResumeGeneration = undefined;
    }

    if (s !== Status.connected) {
      this.setCentralOnlineAcknowledged(false);
      if (!preserveProviderRuntime) {
        void emitWorkerProviderRuntimeState('baileys', false).catch((error) => {
          console.error(
            '[BaileysConnection] Failed to stop Kafka consumers after status change',
            error
          );
        });
      }
    }

    if (c) {
      this.code = c;
    }
  }

  private setCentralOnlineAcknowledged(acknowledged: boolean): void {
    this.centralOnlineAcknowledged = acknowledged;
    setWorkerKafkaDispatchAuthorized(acknowledged);
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
      authorized_connection_epoch: this.runtimeFenceConnectionAuthorization
        ?.connection_attempt_id
        ? this.runtimeFenceConnectionAuthorization.connection_epoch
        : undefined,
      runtime_generation: this.runtimeGeneration,
      debug_trace_id: this.debugTraceId,
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

  private withConnectionMetadata(
    payload: IBaileysConnectionState
  ): IBaileysConnectionState {
    const connectionAttemptId =
      payload.connection_attempt_id ?? this.connectionAttemptId;
    const runtimeGeneration =
      payload.runtime_generation ?? this.runtimeGeneration;
    const debugTraceId = payload.debug_trace_id ?? this.debugTraceId;
    const authorizedConnectionEpoch =
      payload.authorized_connection_epoch ??
      (this.runtimeFenceConnectionAuthorization?.connection_attempt_id
        ? this.runtimeFenceConnectionAuthorization.connection_epoch
        : undefined);
    const activeFence =
      this.baileysIncomingMessageService.getActiveRuntimeFenceIdentity?.();
    const connectionEpoch =
      payload.connection_epoch ?? activeFence?.connection_epoch;
    const connectionSequence =
      payload.connection_sequence ?? activeFence?.connection_sequence;
    const connectionStatus =
      payload.connection_status ?? this.getConnectionStatus();
    const connectionStatusSourceId =
      payload.connection_status_source_id ??
      this.nativeConnectionStatusSourceId;
    if (
      payload.connection_attempt_id === connectionAttemptId &&
      payload.authorized_connection_epoch === authorizedConnectionEpoch &&
      payload.runtime_generation === runtimeGeneration &&
      payload.worker_type_id === EWorkerType.baileys &&
      payload.connection_epoch === connectionEpoch &&
      payload.connection_sequence === connectionSequence &&
      payload.connection_status === connectionStatus &&
      payload.connection_status_source_id === connectionStatusSourceId &&
      payload.debug_trace_id === debugTraceId
    ) {
      return payload;
    }

    return {
      ...payload,
      worker_type_id: EWorkerType.baileys,
      connection_epoch: connectionEpoch,
      connection_sequence: connectionSequence,
      connection_status: connectionStatus,
      connection_status_source_id: connectionStatusSourceId,
      connection_attempt_id: connectionAttemptId,
      authorized_connection_epoch: authorizedConnectionEpoch,
      runtime_generation: runtimeGeneration,
      debug_trace_id: debugTraceId,
    };
  }

  private bindNativeConnectionStatus(socket: WASocket): void {
    const source = socket as unknown as BaileysNativeConnectionStatusSource;
    this.nativeConnectionStatusSource = source as unknown as object;
    this.nativeConnectionStatusSourceId = randomUUID();
    this.nativeConnectionStatus = undefined;
    if (
      typeof source.getConnectionStatus !== 'function' ||
      typeof source.ev?.on !== 'function'
    ) {
      this.logDebug('baileys.provider.native_connection_status_unavailable', {
        trace_id: this.debugTraceId,
        layer: 'baileys',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.baileys,
        connection_attempt_id: this.connectionAttemptId,
        runtime_generation: this.runtimeGeneration,
      });
      return;
    }

    source.ev.on('connection_status', (snapshot) => {
      if (this.nativeConnectionStatusSource !== (source as unknown as object)) {
        return;
      }
      this.acceptNativeConnectionStatus(source, snapshot, true);
    });
    this.acceptNativeConnectionStatus(
      source,
      source.getConnectionStatus(),
      true
    );
  }

  private acceptNativeConnectionStatus(
    source: BaileysNativeConnectionStatusSource,
    value: unknown,
    publish: boolean
  ): void {
    if (this.nativeConnectionStatusSource !== (source as unknown as object)) {
      return;
    }
    const snapshot = normalizeWhatsappConnectionStatus(value, 'baileys');
    if (!snapshot) {
      this.setCentralOnlineAcknowledged(false);
      return;
    }
    if (
      !isNewerWhatsappConnectionStatus(this.nativeConnectionStatus, snapshot)
    ) {
      return;
    }

    this.nativeConnectionStatus = snapshot;
    if (!isWhatsappConnectionOnline(snapshot)) {
      // Source identity and monotonic sequence are fenced first so a delayed
      // status from the same socket cannot revoke a newer ONLINE generation.
      // Once accepted, dispatch closes before listeners or persistence run.
      this.setCentralOnlineAcknowledged(false);
    }
    for (const listener of this.nativeConnectionStatusListeners) {
      try {
        listener({ ...snapshot });
      } catch {
        // A local observer cannot interfere with provider lifecycle handling.
      }
    }
    if (!publish) return;

    this.logDebug('baileys.provider.native_connection_status', {
      trace_id: this.debugTraceId,
      layer: 'baileys',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.baileys,
      connection_attempt_id: this.connectionAttemptId,
      runtime_generation: this.runtimeGeneration,
      status: snapshot.status,
      sequence: snapshot.sequence,
      connected: snapshot.connected,
      authenticated: snapshot.authenticated,
      session_valid: snapshot.sessionValid,
      recoverable: snapshot.recoverable,
      qr_available: snapshot.qrAvailable,
      reason: snapshot.reason,
      error_code: snapshot.errorCode,
    });

    const payload = this.state(undefined, undefined, {
      connection_status: snapshot,
      session_ready: isWhatsappConnectionOnline(snapshot),
      authenticated: snapshot.authenticated,
      can_send: false,
      can_receive_runtime: false,
      provider_state: snapshot.status,
      degraded_reason: snapshot.errorCode ?? snapshot.reason,
    });
    this.enqueueNativeConnectionStatusPersistence(payload, snapshot);
  }

  private enqueueNativeConnectionStatusPersistence(
    payload: IBaileysConnectionState,
    snapshot: IWhatsappConnectionStatus
  ): void {
    const sourceId = this.nativeConnectionStatusSourceId;
    if (!sourceId) return;
    const requiresLeaseProof =
      usesPostgresSessionStorage() &&
      snapshot.status === EWhatsappConnectionStatus.online;
    const leaseProof = requiresLeaseProof
      ? this.postgresAuthStore?.getConnectionStatusLeaseProof()
      : undefined;
    if (requiresLeaseProof && !leaseProof) {
      this.logDebug(
        'baileys.provider.native_connection_status_persistence_rejected',
        {
          trace_id: this.debugTraceId,
          layer: 'baileys',
          worker_id: getWorker(),
          account_id: getAccount(),
          worker_type_id: EWorkerType.baileys,
          runtime_generation: this.runtimeGeneration,
          status: snapshot.status,
          sequence: snapshot.sequence,
          reason: 'session_lease_proof_unavailable',
        }
      );
      return;
    }
    const state = this.withConnectionMetadata(payload);
    this.lastPayload = JSON.stringify(state);
    this.nativeConnectionStatusPersistenceQueue.enqueue({
      eventId: randomUUID(),
      sourceId,
      sequence: snapshot.sequence,
      payload: { state, leaseProof },
    });
  }

  private async flushNativeConnectionStatusPersistence(
    operation: string
  ): Promise<void> {
    if (await this.nativeConnectionStatusPersistenceQueue.flush(5_000)) return;
    this.logDebug(
      'baileys.provider.native_connection_status_persistence_pending',
      {
        trace_id: this.debugTraceId,
        layer: 'baileys',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.baileys,
        runtime_generation: this.runtimeGeneration,
        reason: operation,
      }
    );
  }

  private logNativeConnectionStatusPersistenceFailure(
    failure: NativeConnectionStatusPersistenceFailure<BaileysNativeConnectionStatusPersistencePayload>
  ): void {
    console.error('[BaileysConnection] Native status persistence failed', {
      source_id: failure.item.sourceId,
      sequence: failure.item.sequence,
      status: failure.item.payload.state.connection_status?.status,
      retrying: failure.retrying,
      ...workerErrorDiagnostics(failure.error),
    });
  }

  private resolveWebSocket(
    reference: unknown = this.socket
  ): WebSocket | undefined {
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

  private isUnconfirmedDeviceRemovedDisconnect(error: unknown): boolean {
    if (
      this.extractStatusCode(error) !== ECodeMessage.loggedOut ||
      !error ||
      typeof error !== 'object'
    ) {
      return false;
    }

    const data = (error as { data?: unknown }).data;
    if (!data || typeof data !== 'object') {
      return false;
    }

    const node = data as { tag?: unknown; attrs?: { type?: unknown } };
    return node.tag === 'conflict' && node.attrs?.type === 'device_removed';
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
