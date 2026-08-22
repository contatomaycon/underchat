import whatsappWeb, { type ChatState } from '@wwebjs/whatsapp-web.js';
import {
  normalizeCanonicalProjection,
  type WwebjsCanonicalBrowserProjection,
} from '@wwebjs/whatsapp-web.js/src/session/CanonicalSessionBridge.js';
import QRCode from 'qrcode';
import Redis from 'ioredis';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { singleton, inject } from 'tsyringe';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { wwebjsEnvironment } from '@core/config/environments';
import { EBaileysConnectionStatus as Status } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
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
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { BalanceWorkerStatusGrpcClientService } from '@core/services/balanceWorkerStatusGrpcClient.service';
import { chatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import { getPhoneNumber } from '@core/common/functions/getPhoneNumber';
import { buildWppConnectionDocumentId } from '@core/common/functions/buildWppConnectionDocumentId';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { WwebjsIncomingMessageService } from './incoming.service';
import {
  WwebjsHealthCheckService,
  type WwebjsCanonicalActivationCheckpointState,
  type WwebjsProviderProbeGate,
} from './healthCheck.service';
import { markWwebjsProviderProcessReplacementRequired } from '@core/common/functions/wwebjsProcessReplacement';
import { IChatTyping } from '@core/common/interfaces/IChatTyping';
import { EProxyProtocol } from '@core/common/enums/EProxyProtocol';
import {
  ConnectionLifecycleDebugContext,
  ConnectionLifecycleDebugService,
} from '@core/services/connectionLifecycleDebug.service';
import { logLocalConnectionStatus } from '@core/common/functions/localConnectionStatusLog';
import { logConnectionFlowConsole } from '@core/common/functions/connectionFlowConsoleLog';
import { emitWorkerProviderRuntimeState } from '@core/common/functions/workerProviderRuntimeState';
import { setWorkerKafkaDispatchAuthorized } from '@core/common/functions/workerKafkaDispatchAuthorization';
import { resolveHistoryReconciliationConfig } from '@core/common/functions/historyReconciliationConfig';
import {
  acquireWwebjsSessionLifecycleLease,
  beginWwebjsRuntimeSessionActivation,
  ensureWwebjsSessionCandidate,
  inspectWwebjsLocalAuthSession,
  isWwebjsSessionLockBusy,
  markWwebjsRuntimeSessionReady,
  markWwebjsSessionValidated,
  purgeWwebjsSessionQuarantine,
  quarantineWwebjsLocalAuthSession,
  recordWwebjsSessionRestoreFailure,
  type WwebjsSessionGuardContext,
  type WwebjsSessionInspection,
  type WwebjsSessionLifecycleLease,
  type WwebjsSessionMarker,
  type WwebjsSessionQuarantineResult,
} from './sessionGuard';
import {
  isWwebjsOwnedBrowserProcessTerminated,
  requestWwebjsOwnedBrowserProcessTermination,
  runWithWwebjsBrowserLaunchOwner,
  type WwebjsOwnedBrowserProcess,
} from './browserProcessOwnership';
import {
  cleanupWwebjsChromiumProfileArtifactsForCurrentOwnerSync,
  recoverWwebjsChromiumProfileBeforeLaunch,
} from './chromiumProfileLockRecovery';
import {
  isProviderInvocationCapacityError,
  ProviderInvocationInFlightError,
  ProviderInvocationSingleFlight,
} from '@core/common/functions/providerInvocationSingleFlight';
import {
  invokeProviderAuxiliaryWithTimeout,
  ProviderAuxiliaryInvocationSingleFlight,
  ProviderAuxiliaryInvocationTimeoutError,
} from '@core/common/functions/providerAuxiliaryInvocation';
import {
  createPostgresWwebjsSessionStoreFromEnvironment,
  resolveWwebjsCanonicalCompanionIdentity,
  type WwebjsBrowserProjection,
  type PostgresWwebjsSessionStore,
} from './postgresSessionStore';
import {
  workerErrorDiagnostics,
  workerErrorFailureReason,
} from '@core/common/functions/workerErrorDiagnostics';
import {
  IPrepareProviderHandoffRequestProto,
  IPrepareProviderHandoffResponseProto,
} from '@core/common/interfaces/IProviderHandoffPrepareProto';
import {
  IWhatsappConnectionStatus,
  IWhatsappConnectionStatusEventSource,
} from '@core/common/interfaces/IWhatsappConnectionStatus';
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
import {
  retryLegacySessionVolumeSnapshot,
  snapshotLegacySessionVolume,
} from '@core/services/sessionStorageMigrationSnapshot.service';
import { withWritableWwebjsLegacyProfileCopy } from './legacyVolumeMigrationProfile';

class CanonicalActivationCheckpointProbeDeferredError extends ProviderInvocationInFlightError {
  readonly checkpointDeferred = true;

  constructor(readonly deferredDurationMs = 0) {
    super('capacity');
    this.name = 'CanonicalActivationCheckpointProbeDeferredError';
  }
}

interface CanonicalCheckpointDeferredProviderCall {
  readonly token: symbol;
  checkpointGeneration?: number;
  readonly deferredAtMs: number;
  readonly providerCall: Promise<unknown>;
  postCheckpointDeadlineMs?: number;
}

interface WwebjsNativeConnectionStatusPersistencePayload {
  state: IBaileysConnectionState;
  leaseProof?: WorkerRuntimeConnectionStatusLeaseProof;
}

export interface WwebjsConnectionStatusHealthEvidence {
  connectionStatus?: IWhatsappConnectionStatus;
  connectionStatusSourceId?: string;
  sourceCurrent: boolean;
  leaseRequired: boolean;
  leaseProofValid: boolean;
  sessionStorage: WwebjsSessionStorageMode;
  sessionRevisionId?: string;
  sessionStorageMigrationId?: string;
}

export type WwebjsSessionLeaseLostListener = (
  error: Error
) => void | Promise<void>;

interface WwebjsNativeLifecycleStatusSource extends IWhatsappConnectionStatusEventSource {
  _setConnectionStatus?(
    status: string,
    details?: { reason?: string; errorCode?: string }
  ): unknown;
}

const HEALTH_CHECK_INTERVAL_MS = 30_000;
const RETRY_DELAY = 60_000;
const MAX_RETRIES = 10;
const PROVIDER_RUNTIME_STOP_MAX_ATTEMPTS = 3;
const RECONNECT_COOLDOWN_DELAY = 30 * 60 * 1000;
const MAX_QR_GENERATIONS = 5;
const QR_REFRESH_INTERVAL_MS = 25_000;
const QR_REFRESH_EVENT_TIMEOUT_MS = 10_000;
const QR_REFRESH_CAPACITY_RETRY_MS = 1_000;
const CONNECTION_STATE_RECONCILE_INTERVAL_MS = 5_000;
const CONNECTION_STATE_READY_EVENT_RECONCILE_INTERVAL_MS = 500;
const CONNECTION_STATE_READY_EVENT_FAST_WINDOW_MS = 10_000;
const CONNECTION_STATE_RECONCILE_TIMEOUT_MS = 120_000;
const CONNECTION_STATE_CHECK_TIMEOUT_MS = 10_000;
const CANONICAL_CHECKPOINT_PROVIDER_DRAIN_GRACE_MS =
  CONNECTION_STATE_CHECK_TIMEOUT_MS;
const CONNECTION_STATE_READY_GRACE_MS = 30_000;
const CONNECTION_EVENT_BRIDGE_ATTACH_TIMEOUT_MS = 20_000;
const CONNECTION_PAGE_CHECK_TIMEOUT_MS = 5_000;
const DEFAULT_PUPPETEER_PROTOCOL_TIMEOUT_MS = 60_000;
const MIN_PUPPETEER_PROTOCOL_TIMEOUT_MS = 5_000;
const MAX_PUPPETEER_PROTOCOL_TIMEOUT_MS = 240_000;
const QR_DATA_URL_GENERATION_TIMEOUT_MS = 1_500;
const CONNECTION_ATTEMPT_GUARD_TIMEOUT_GRACE_MS = 5_000;
const DEFAULT_CLIENT_DESTROY_TIMEOUT_MS = 15_000;
const DEFAULT_PENDING_TEARDOWN_TIMEOUT_MS = 20_000;
const QR_SVG_MARGIN_MODULES = 4;
const SHOULD_LOG_CONNECTION_IP =
  process.env.APP_ENVIRONMENT === EAppEnvironment.local;
export type WwebjsSessionStorageMode = 'legacy_volume' | 'postgres';

export function resolveWwebjsSessionStorageMode(
  rawValue = process.env.WORKER_SESSION_STORAGE
): WwebjsSessionStorageMode {
  const normalized = rawValue?.trim().toLowerCase();
  if (!normalized || normalized === 'legacy_volume') {
    return 'legacy_volume';
  }
  if (normalized === 'postgres') {
    return 'postgres';
  }

  throw new Error('wwebjs_session_storage_invalid');
}

function usesPostgresSessionStorage(): boolean {
  return resolveWwebjsSessionStorageMode() === 'postgres';
}

interface WwebjsProviderHandoffProjection {
  artifact?: {
    checksum_sha256?: unknown;
    size_bytes?: unknown;
  };
  provider_projection?: {
    records?: unknown;
  };
  canonicalProjection?: {
    device?: unknown;
    record_count?: unknown;
  };
}

export interface WwebjsProviderHandoffCheckpointProof {
  checksum: string;
  sizeBytes: number;
  recordCount: number;
}

function parseWwebjsProviderHandoffCount(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : Number.NaN;
  }
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
    return Number.NaN;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

export function resolveWwebjsProviderHandoffCheckpointProof(
  handoff: Record<string, unknown>
): WwebjsProviderHandoffCheckpointProof {
  const projection = handoff.projection as
    WwebjsProviderHandoffProjection | undefined;
  const checksum = String(
    projection?.artifact?.checksum_sha256 ?? ''
  ).toLowerCase();
  const sizeBytes = parseWwebjsProviderHandoffCount(
    projection?.artifact?.size_bytes
  );
  const providerProjection = projection?.provider_projection;
  const providerRecords = providerProjection?.records;
  const canonicalProjection = projection?.canonicalProjection;
  const canonicalRecordCount = parseWwebjsProviderHandoffCount(
    canonicalProjection?.record_count
  );
  const recordCount = parseWwebjsProviderHandoffCount(
    handoff.checkpointRecordCount
  );
  const canonicalDevice = canonicalProjection?.device;
  const canonicalProofPresent =
    canonicalDevice !== null &&
    typeof canonicalDevice === 'object' &&
    !Array.isArray(canonicalDevice) &&
    Number.isSafeInteger(canonicalRecordCount) &&
    canonicalRecordCount >= 0;
  const providerRecordCount = Array.isArray(providerRecords)
    ? providerRecords.length
    : null;
  const providerProofPresent = providerRecordCount !== null;

  if (
    !/^[0-9a-f]{64}$/.test(checksum) ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes < 0 ||
    (providerProjection !== undefined && !providerProofPresent) ||
    (!canonicalProofPresent && !providerProofPresent) ||
    !Number.isSafeInteger(recordCount) ||
    recordCount < 0 ||
    (canonicalProofPresent && recordCount !== canonicalRecordCount + 1) ||
    (!canonicalProofPresent &&
      providerProofPresent &&
      recordCount !== providerRecordCount)
  ) {
    throw new Error('wwebjs_provider_handoff_checkpoint_proof_invalid');
  }

  return { checksum, sizeBytes, recordCount };
}

function getWwebjsSessionStorage(): EWorkerSessionStorage {
  return usesPostgresSessionStorage()
    ? EWorkerSessionStorage.postgres
    : EWorkerSessionStorage.legacy_volume;
}

function isHistoryReconciliationEnabled(): boolean {
  return resolveHistoryReconciliationConfig().enabled;
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

const WWEBJS_PROVIDER_HANDOFF_RECONNECT_RETRY_MS = readBoundedIntEnv(
  'WWEBJS_PROVIDER_HANDOFF_RECONNECT_RETRY_MS',
  2_000,
  250,
  15_000
);

const WWEBJS_CLIENT_DESTROY_TIMEOUT_MS = readBoundedIntEnv(
  'WWEBJS_CLIENT_DESTROY_TIMEOUT_MS',
  DEFAULT_CLIENT_DESTROY_TIMEOUT_MS,
  1_000,
  60_000
);
const WWEBJS_CLIENT_LOGOUT_TIMEOUT_MS = WWEBJS_CLIENT_DESTROY_TIMEOUT_MS;
const WWEBJS_CLIENT_INITIALIZE_SETTLEMENT_TIMEOUT_MS = readBoundedIntEnv(
  'WWEBJS_CLIENT_INITIALIZE_SETTLEMENT_TIMEOUT_MS',
  DEFAULT_CLIENT_DESTROY_TIMEOUT_MS,
  1_000,
  120_000
);
const WWEBJS_BROWSER_TERMINATION_TIMEOUT_MS = readBoundedIntEnv(
  'WWEBJS_BROWSER_TERMINATION_TIMEOUT_MS',
  5_000,
  1_000,
  30_000
);
const WWEBJS_CONNECTION_TEARDOWN_TIMEOUT_MS =
  WWEBJS_CLIENT_INITIALIZE_SETTLEMENT_TIMEOUT_MS +
  WWEBJS_CLIENT_DESTROY_TIMEOUT_MS +
  WWEBJS_BROWSER_TERMINATION_TIMEOUT_MS +
  2_000;
const WWEBJS_PENDING_TEARDOWN_TIMEOUT_MS = readBoundedIntEnv(
  'WWEBJS_PENDING_TEARDOWN_TIMEOUT_MS',
  Math.max(
    DEFAULT_PENDING_TEARDOWN_TIMEOUT_MS,
    WWEBJS_CONNECTION_TEARDOWN_TIMEOUT_MS + 5_000
  ),
  1_000,
  240_000
);
const CONNECTION_QR_FIRST_QR_TIMEOUT_MS = readBoundedIntEnv(
  'CONNECTION_QR_FIRST_QR_TIMEOUT_MS',
  25_000,
  1_000,
  300_000
);
const WWEBJS_AUTH_TIMEOUT_MS = readBoundedIntEnv(
  'WWEBJS_AUTH_TIMEOUT_MS',
  30_000,
  10_000,
  300_000
);
const WWEBJS_SECURE_IMPORT_AUTH_TIMEOUT_MS = readBoundedIntEnv(
  'WWEBJS_SECURE_IMPORT_AUTH_TIMEOUT_MS',
  150_000,
  30_000,
  300_000
);
const WWEBJS_SECURE_IMPORT_GUARD_TIMEOUT_MS = readBoundedIntEnv(
  'WWEBJS_SECURE_IMPORT_GUARD_TIMEOUT_MS',
  180_000,
  30_000,
  300_000
);
const WWEBJS_CLIENT_INITIALIZE_WATCHDOG_TIMEOUT_MS = readBoundedIntEnv(
  'WWEBJS_CLIENT_INITIALIZE_WATCHDOG_TIMEOUT_MS',
  WWEBJS_SECURE_IMPORT_GUARD_TIMEOUT_MS + 30_000,
  WWEBJS_SECURE_IMPORT_GUARD_TIMEOUT_MS + 30_000,
  10 * 60_000
);
const WWEBJS_PROVIDER_HANDOFF_CONFIRMATION_BUDGET_MS = readBoundedIntEnv(
  'WORKER_PROVIDER_HANDOFF_CONNECTION_CONFIRMATION_WAIT_MS',
  5 * 60_000,
  30_000,
  10 * 60_000
);
const WWEBJS_SECURE_IMPORT_INITIALIZE_CONFIRMATION_GRACE_MS = 15_000;

export function resolveWwebjsClientInitializeWatchdogTimeoutMs(
  secureImportRestore: boolean,
  rawSecureImportValue = process.env
    .WWEBJS_SECURE_IMPORT_INITIALIZE_WATCHDOG_TIMEOUT_MS,
  regularTimeoutMs = WWEBJS_CLIENT_INITIALIZE_WATCHDOG_TIMEOUT_MS,
  providerHandoffBudgetMs = WWEBJS_PROVIDER_HANDOFF_CONFIRMATION_BUDGET_MS
): number {
  if (!secureImportRestore) {
    return regularTimeoutMs;
  }

  // Reserve the tail of the outer handoff budget for native-ready and command
  // ingress confirmation after both protected browser import passes finish.
  const maximum = Math.max(
    regularTimeoutMs,
    Math.min(
      10 * 60_000,
      providerHandoffBudgetMs -
        WWEBJS_SECURE_IMPORT_INITIALIZE_CONFIRMATION_GRACE_MS
    )
  );
  const parsed = Number.parseInt(rawSecureImportValue ?? '', 10);
  if (!Number.isFinite(parsed)) {
    return maximum;
  }

  // A canonical handoff may legitimately run an initial protected import and
  // a second post-reload sealing pass. Never let its watchdog become shorter
  // than the regular initialize fence, and keep the process-level upper bound.
  return Math.min(maximum, Math.max(regularTimeoutMs, parsed));
}

const WWEBJS_SECURE_IMPORT_INITIALIZE_WATCHDOG_TIMEOUT_MS =
  resolveWwebjsClientInitializeWatchdogTimeoutMs(true);
const WWEBJS_REMOTE_AUTH_CHECKPOINT_INTERVAL_MS = readBoundedIntEnv(
  'WWEBJS_REMOTE_AUTH_CHECKPOINT_INTERVAL_MS',
  60_000,
  60_000,
  15 * 60_000
);
// RemoteAuth delays READY until this first durable checkpoint finishes. Keep a
// short profile-flush grace without inheriting the upstream 60-second stall.
const DEFAULT_WWEBJS_REMOTE_AUTH_INITIAL_CHECKPOINT_DELAY_MS = 5_000;

export function resolveWwebjsRemoteAuthInitialCheckpointDelayMs(
  rawValue = process.env.WWEBJS_REMOTE_AUTH_INITIAL_CHECKPOINT_DELAY_MS
): number {
  const parsed = Number.parseInt(rawValue ?? '', 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_WWEBJS_REMOTE_AUTH_INITIAL_CHECKPOINT_DELAY_MS;
  }

  return Math.min(120_000, Math.max(0, parsed));
}

const WWEBJS_REMOTE_AUTH_INITIAL_CHECKPOINT_DELAY_MS =
  resolveWwebjsRemoteAuthInitialCheckpointDelayMs();
const WWEBJS_KAFKA_READINESS_RETRY_MS = readBoundedIntEnv(
  'WWEBJS_KAFKA_READINESS_RETRY_MS',
  5_000,
  250,
  60_000
);
const WWEBJS_TRANSIENT_DISCONNECT_STATUS_DEBOUNCE_MS = readBoundedIntEnv(
  'WWEBJS_TRANSIENT_DISCONNECT_STATUS_DEBOUNCE_MS',
  5_000,
  250,
  60_000
);
const WWEBJS_UNPAIRED_PERSISTENCE_MS = readBoundedIntEnv(
  'WWEBJS_UNPAIRED_PERSISTENCE_MS',
  30_000,
  5_000,
  120_000
);
const WWEBJS_STALE_SESSION_MAX_RESTORE_ATTEMPTS = readBoundedIntEnv(
  'WWEBJS_STALE_SESSION_MAX_RESTORE_ATTEMPTS',
  3,
  1,
  10
);
const WWEBJS_INCOMPLETE_ACTIVATION_MAX_RESTORE_ATTEMPTS = readBoundedIntEnv(
  'WWEBJS_INCOMPLETE_ACTIVATION_MAX_RESTORE_ATTEMPTS',
  1,
  1,
  3
);
const WWEBJS_SESSION_LOCK_MAX_RETRIES = 8;
const WWEBJS_SESSION_LOCK_RETRY_MIN_MS = 250;
const WWEBJS_SESSION_LOCK_RETRY_MAX_MS = 5_000;
const WWEBJS_SESSION_LOCK_RETRY_COOLDOWN_MS = 30_000;
const sessionLifecycleLeaseScope = new AsyncLocalStorage<{
  ownerToken?: string;
}>();
const sessionProfileTransitionScope = new AsyncLocalStorage<{
  ownerToken: string;
}>();
type WorkerStatusNotificationResult =
  | { outcome: 'accepted' }
  | { outcome: 'deferred'; reason: 'command_ingress_positioning' }
  | {
      outcome: 'failed';
      classification: 'recoverable' | 'terminal';
      reason: string;
      grpcCode?: number;
    };

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

function getFolder(): string {
  if (usesPostgresSessionStorage()) {
    const workerSegment =
      wwebjsEnvironment.wwebjsWorkerId.replace(/[^a-zA-Z0-9_-]+/g, '_') ||
      'worker';
    const ephemeralRoot =
      process.env.WWEBJS_EPHEMERAL_PROFILE_ROOT?.trim() ||
      '/tmp/underchat-wwebjs';
    return path.resolve(ephemeralRoot, workerSegment);
  }

  return `/app/data/wwebjs/storage/${wwebjsEnvironment.wwebjsWorkerId}`;
}

function getSessionQuarantineRoot(): string {
  const workerSegment =
    getWorker().replace(/[^a-zA-Z0-9_-]+/g, '_') || 'worker';
  return path.resolve(
    getFolder(),
    '..',
    '..',
    '..',
    '.underchat-quarantine',
    'wwebjs',
    workerSegment
  );
}

function getSessionLockRoot(): string {
  const workerSegment =
    getWorker().replace(/[^a-zA-Z0-9_-]+/g, '_') || 'worker';
  return path.resolve(
    getFolder(),
    '..',
    '..',
    '..',
    '.underchat-locks',
    'wwebjs',
    workerSegment
  );
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
    message === 'wwebjs_provider_became_unavailable_during_consumer_startup' ||
    (message.startsWith('wwebjs_kafka_consumer_start_failed:') &&
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

/** Resolves a bounded Puppeteer CDP deadline for the WWebJS runtime. */
export function resolveWwebjsProtocolTimeoutMs(
  rawValue = process.env.WWEBJS_PROTOCOL_TIMEOUT_MS
): number {
  const parsed = Number.parseInt(rawValue ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PUPPETEER_PROTOCOL_TIMEOUT_MS;
  }

  return Math.min(
    MAX_PUPPETEER_PROTOCOL_TIMEOUT_MS,
    Math.max(MIN_PUPPETEER_PROTOCOL_TIMEOUT_MS, parsed)
  );
}

const PUPPETEER_PROTOCOL_TIMEOUT_MS = resolveWwebjsProtocolTimeoutMs();

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

const { Client: ClientCtor, LocalAuth, RemoteAuth } = whatsappWeb;
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
type WwebjsSecureSessionImportResult = {
  accountHint?: string | null;
  backupPath?: string;
  browserProjection?: WwebjsBrowserProjection;
  canonicalProjection?: WwebjsCanonicalBrowserProjection;
  formatVersion?: string;
  importedFiles?: string[];
  sessionPath?: string;
};
type WwebjsSecureSessionImporter = (input: {
  cleanupBackupOnSuccess?: boolean;
  clientId?: string;
  dataPath?: string;
  overwrite?: boolean;
  sessionPackage: ISecureConnectionSessionPackage;
}) => Promise<WwebjsSecureSessionImportResult>;
type WwebjsProviderRuntimeActivation = {
  client: Client;
  attemptId: number;
};
type WwebjsClientInitializationState =
  'pending' | 'completed' | 'failed' | 'timed_out';
type WwebjsDeferredConnectionStateProbe = {
  proxy: ReturnType<typeof readProxyConfig>;
  secureImportRestore: boolean;
  readyObserved: boolean;
};
type WwebjsReadyConfirmationSource =
  'ready' | 'state_probe' | 'kafka_retry' | 'native_reconnect';
type WwebjsReadinessResult = Awaited<
  ReturnType<WwebjsHealthCheckService['verifyCurrentSession']>
>;

interface WwebjsReadyStatusFinalizationInput {
  client: Client;
  attemptId: number;
  proxy: ReturnType<typeof readProxyConfig>;
  source: WwebjsReadyConfirmationSource;
  runtimeActivation: WwebjsProviderRuntimeActivation;
  readiness: WwebjsReadinessResult;
  payload: IBaileysConnectionState;
}

interface WwebjsConfirmedOnlineState {
  client: Client;
  attemptId: number;
  payload: IBaileysConnectionState;
}

interface WwebjsClientInitializationLifecycle {
  attemptId: number;
  connectionInvocationGeneration: number;
  runtimeGeneration?: number;
  lifecycleOwnerToken?: string;
  lifecycleLeaseGeneration: number;
  initializePromise: Promise<void>;
  initializeState: WwebjsClientInitializationState;
  initializeWatchdogTimeoutMs: number;
  initializeWatchdogTimer?: ReturnType<typeof setTimeout>;
  deferredConnectionStateProbe?: WwebjsDeferredConnectionStateProbe;
  cancellationRequested: boolean;
  lateCleanupScheduled: boolean;
  ownedBrowserProcesses: Set<WwebjsOwnedBrowserProcess>;
  initializeErrorToken?: string;
}

type WwebjsClientDestroySettlement =
  { status: 'fulfilled' } | { status: 'rejected'; error: unknown };

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
  private qrRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  private qrRefreshEventTimer: ReturnType<typeof setTimeout> | undefined;
  private qrRefreshGeneration = 0;
  private disconnectRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private transientDisconnectStatusTimer:
    ReturnType<typeof setTimeout> | undefined;
  private transientDisconnectStatusGeneration = 0;
  private connectionStateProbeTimer: ReturnType<typeof setTimeout> | undefined;
  private teardownPromise: Promise<void> = Promise.resolve();
  private disconnectPromise: Promise<void> | undefined;
  private currentPromise: Promise<IBaileysConnectionState> | undefined;
  private pendingResolve: ((s: IBaileysConnectionState) => void) | undefined;
  private connectionAttemptSequence = 0;
  private activeConnectionAttemptId: number | undefined;
  private readonly clientConnectionAttemptIds = new WeakMap<Client, number>();
  private readonly clientInitializationLifecycles = new WeakMap<
    Client,
    WwebjsClientInitializationLifecycle
  >();
  private readonly clientDestroySettlements = new WeakMap<
    Client,
    Promise<WwebjsClientDestroySettlement>
  >();
  private readonly clientReadyConfirmationFlights = new WeakMap<
    Client,
    { attemptId: number; promise: Promise<boolean> }
  >();
  private readonly clientsWithDurableRemoteCheckpoint = new WeakSet<Client>();
  private readonly clientsWithRejectedRestorePairing = new WeakSet<Client>();
  private providerRuntimeTransitionTail: Promise<void> = Promise.resolve();
  private providerRuntimeActivation:
    WwebjsProviderRuntimeActivation | undefined;
  private providerRuntimeStopFailure: unknown;
  private lastPayload: string | null = null;
  private qrHash: string | undefined;
  private typeConnection: EBaileysConnectionType =
    EBaileysConnectionType.qrcode;
  private phoneConnection: string | undefined;
  private connectionAttemptId: string | undefined;
  private runtimeFenceConnectionAuthorization:
    IWhatsappRuntimeFenceConnectionAuthorization | undefined;
  private runtimeFenceConnectionAuthorizationTransition: Promise<void> =
    Promise.resolve();
  private debugTraceId: string | undefined;
  private runtimeGeneration: number | undefined;
  private connectionAttemptStartedAtMs = 0;
  private secureImportConnectionAttemptActive = false;
  private secureImportConnectionAttemptToken: string | undefined;
  private kafkaReadinessRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private kafkaReadinessRetryFlight: Promise<void> | undefined;
  private kafkaReadinessRetryGeneration = 0;
  private centralOnlineAcknowledged = false;
  private confirmedOnlineState: WwebjsConfirmedOnlineState | undefined;
  private readonly runtimeSessionActivationId = randomUUID();
  private readonly runtimeSessionActivationStartedAt = new Date().toISOString();
  private sessionLifecycleLease: WwebjsSessionLifecycleLease | undefined;
  private readonly browserRuntimeClients = new Set<Client>();
  private sessionLifecycleLeaseGeneration = 0;
  private sessionLifecycleTerminationUnconfirmed = false;
  private sessionProfileTransitionTail: Promise<void> = Promise.resolve();
  private activeSessionProfileTransitionOwner: string | undefined;
  private connectionInvocationGeneration = 0;
  private sessionLockRetryCount = 0;
  private sessionRestoreBlocked = false;
  private inMemoryUnpairedRestoreFailures = 0;
  private postgresSessionStore: PostgresWwebjsSessionStore | undefined;
  private postgresSessionKnown = false;
  private legacyVolumeMigrationBootstrapped = false;
  private postgresSessionEvidenceGeneration = 0;
  private postgresSessionRefreshPromise: Promise<void> | undefined;
  private postgresLeaseRecoveryRequired = false;
  private postgresLeaseRecoveryGeneration = 0;
  private postgresLeaseRecoveryResumeGeneration: number | undefined;
  private readonly postgresSessionLeaseLostListeners =
    new Set<WwebjsSessionLeaseLostListener>();
  private outboundSendFailureScope: Client | undefined;
  private consecutiveOutboundSendFailures = 0;
  private outboundSendRecoveryFlight: Promise<void> | undefined;
  private outboundSendRecoveryScope: Client | undefined;
  private outboundSendRecoveryRetryTimer:
    ReturnType<typeof setTimeout> | undefined;
  private outboundSendRecoveryAttempts = 0;
  private outboundSendRecoveryExhaustedScope: Client | undefined;
  private readonly outboundSendRecoveryRetryDelaysMs = [250, 1000] as const;
  private readonly providerLifecycleInvocationFence =
    new ProviderInvocationSingleFlight();
  private readonly providerLifecycleAuxiliarySingleFlight =
    new ProviderAuxiliaryInvocationSingleFlight();
  private readonly canonicalCheckpointDeferredProviderCalls = new WeakMap<
    Client,
    CanonicalCheckpointDeferredProviderCall
  >();
  private providerHandoffKey: string | undefined;
  private providerHandoffClient: Client | undefined;
  private providerHandoffFlight:
    Promise<IPrepareProviderHandoffResponseProto> | undefined;
  private providerHandoffResult:
    IPrepareProviderHandoffResponseProto | undefined;
  private sessionStorageMigrationId: string | undefined;
  private sessionStorageMigrationPhone: string | undefined;
  private sessionStorageMigrationResult:
    IPrepareSessionStorageMigrationResponseProto | undefined;
  private nativeConnectionStatus?: IWhatsappConnectionStatus;
  private nativeConnectionStatusSource?: object;
  private nativeConnectionStatusSourceId?: string;
  private readonly nativeConnectionStatusListeners = new Set<
    (snapshot: IWhatsappConnectionStatus) => void
  >();
  private readonly nativeConnectionStatusPersistenceQueue: NativeConnectionStatusPersistenceQueue<WwebjsNativeConnectionStatusPersistencePayload>;

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
    private readonly healthCheckService: WwebjsHealthCheckService,
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
    this.incomingMessageService.configureAuxiliaryProviderFailureRecovery?.(
      (client, error, options) => {
        const recoveryStarted = this.reportOutboundSendFailure(
          client,
          error,
          options
        );
        if (options.timedOut && recoveryStarted !== true) {
          this.ensureOutboundSendRecovery(client);
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
      getClient: () => this.client,
      getStatus: () => this.status,
      getCode: () => this.code,
      reconnect: (input) => this.reconnect(input),
      isConnected: () => this.connected,
      isNativeConnectionOnline: (client) =>
        this.isCurrentNativeConnectionOnline(client),
      prepareSession: () => this.prepareSessionBootstrap(),
      hasSession: () => this.hasSession(),
      hasCentralOnlineAcknowledgement: () =>
        this.hasCentralOnlineAcknowledgement(),
      isEventBridgeAttached: (client) =>
        this.incomingMessageService.isEventBridgeAttached(client),
      getRuntimeFenceIdentity: () =>
        this.incomingMessageService.getActiveRuntimeFenceIdentity(),
      getCanonicalActivationCheckpointState: (client) =>
        this.getCanonicalActivationCheckpointState(client),
      isProviderProbeAllowed: (client) =>
        this.getClientProviderProbeGate(client),
      onStatusMismatch: (detectedStatus, workerStatus) => {
        this.handleHealthCheckMismatch(detectedStatus, workerStatus);
      },
      onProviderProbeTimeout: (client, error) => {
        const recoveryStarted = this.reportOutboundSendFailure(client, error, {
          timedOut: true,
        });
        if (recoveryStarted !== true) {
          this.ensureOutboundSendRecovery(client);
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
        runtime_generation: wwebjsEnvironment.runtimeGeneration,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('worker_runtime_fence_rejected')
      ) {
        // The tombstone remains authoritative. WWebJS must stay dormant and
        // leave the browser profile/session store untouched until an exact
        // manager-authorized QR grant is activated.
        return false;
      }
      throw error;
    }
    await this.refreshPostgresSessionState();
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

  hasCentralOnlineAcknowledgement(): boolean {
    return this.centralOnlineAcknowledged;
  }

  getStatus(): Status {
    return this.status;
  }

  getConnectionStatus(): IWhatsappConnectionStatus | undefined {
    const source = this.client as unknown as
      IWhatsappConnectionStatusEventSource | undefined;
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

  onSessionLeaseLost(listener: WwebjsSessionLeaseLostListener): () => void {
    this.postgresSessionLeaseLostListeners.add(listener);
    return () => this.postgresSessionLeaseLostListeners.delete(listener);
  }

  beginSessionLeaseRecoveryResume(): number | undefined {
    if (!this.postgresLeaseRecoveryRequired) return undefined;
    this.postgresLeaseRecoveryResumeGeneration =
      this.postgresLeaseRecoveryGeneration;
    return this.postgresLeaseRecoveryGeneration;
  }

  markSessionLeaseRecoveryCompleted(generation?: number): boolean {
    if (generation === undefined) return !this.postgresLeaseRecoveryRequired;
    if (
      !this.postgresLeaseRecoveryRequired ||
      generation !== this.postgresLeaseRecoveryGeneration ||
      this.postgresLeaseRecoveryResumeGeneration !== generation ||
      !this.postgresSessionStore?.getConnectionStatusLeaseProof()
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

  startSessionLeaseRecoverySocket(generation?: number): boolean {
    if (
      generation === undefined ||
      generation !== this.postgresLeaseRecoveryGeneration ||
      this.postgresLeaseRecoveryResumeGeneration !== generation ||
      !this.postgresSessionKnown ||
      this.sessionRestoreBlocked ||
      !this.postgresSessionStore?.getConnectionStatusLeaseProof()
    ) {
      return false;
    }
    this.initialConnection = true;
    this.scheduleNextReconnectAttempt(false);
    return this.client !== undefined || this.disconnectRetryTimer !== undefined;
  }

  getConnectionStatusSourceId(): string | undefined {
    return this.nativeConnectionStatusSourceId;
  }

  getConnectionStatusHealthEvidence(): WwebjsConnectionStatusHealthEvidence {
    const source = this.client as unknown as
      IWhatsappConnectionStatusEventSource | undefined;
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
          'wwebjs'
        )
      : undefined;
    if (source && connectionStatus) {
      this.acceptNativeConnectionStatus(source, connectionStatus, false);
    }
    const leaseRequired = usesPostgresSessionStorage();
    const leaseProofValid =
      !leaseRequired ||
      Boolean(this.postgresSessionStore?.getConnectionStatusLeaseProof());

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
      sessionStorage: resolveWwebjsSessionStorageMode(),
      sessionRevisionId: this.postgresSessionStore?.revisionId,
      sessionStorageMigrationId:
        process.env.SESSION_STORAGE_MIGRATION_ID?.trim() || undefined,
    };
  }

  getCode(): ECodeMessage {
    return this.code;
  }

  getSocket(): Client | undefined {
    return this.client;
  }

  canRecoverRestorableSession(): boolean {
    if (
      !this.initialConnection ||
      this.userRequestedDisconnect ||
      this.sessionLifecycleTerminationUnconfirmed ||
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
      this.disconnectRetryTimer ||
      this.connecting ||
      this.currentPromise ||
      this.client
    ) {
      return false;
    }

    this.connectionEstablished = false;
    this.setCentralOnlineAcknowledged(false);
    this.setStatus(Status.disconnected, ECodeMessage.connectionLost);
    this.logDebug('wwebjs.provider.local_recovery_scheduled', {
      trace_id: this.debugTraceId,
      layer: 'wwebjs',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.wwebjs,
      connection_attempt_id: this.connectionAttemptId,
      runtime_generation: this.runtimeGeneration,
      status: this.status,
      code: this.code,
      reason: source,
      has_session: true,
    });
    this.scheduleNextReconnectAttempt(true);
    return this.disconnectRetryTimer !== undefined;
  }

  reportOutboundSendSuccess(client: Client): void {
    if (this.client !== client) {
      return;
    }
    if (this.outboundSendRecoveryScope !== client) {
      this.resetOutboundSendRecoveryState(client);
    }
    this.outboundSendFailureScope = client;
    this.consecutiveOutboundSendFailures = 0;
  }

  reportOutboundSendFailure(
    client: Client,
    error: unknown,
    options: { timedOut?: boolean } = {}
  ): boolean {
    if (this.client !== client || this.userRequestedDisconnect) {
      return false;
    }
    if (this.outboundSendFailureScope !== client) {
      this.outboundSendFailureScope = client;
      this.consecutiveOutboundSendFailures = 0;
    }
    this.consecutiveOutboundSendFailures += 1;
    console.warn('[WwebjsConnection] outbound_send_failure', {
      consecutive_failures: this.consecutiveOutboundSendFailures,
      timed_out: options.timedOut === true,
      error: getErrorMessage(error),
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

  ensureOutboundSendRecovery(client: Client): void {
    if (this.client !== client || this.userRequestedDisconnect) {
      return;
    }
    this.startOutboundSendRecovery(client);
  }

  private startOutboundSendRecovery(client = this.client): void {
    if (
      !client ||
      this.outboundSendRecoveryExhaustedScope === client ||
      this.outboundSendRecoveryFlight ||
      this.outboundSendRecoveryRetryTimer ||
      this.userRequestedDisconnect ||
      (this.client !== undefined && this.client !== client)
    ) {
      return;
    }

    if (this.outboundSendRecoveryScope !== client) {
      this.resetOutboundSendRecoveryState(client);
    }
    const attempt = this.outboundSendRecoveryAttempts + 1;
    this.outboundSendRecoveryAttempts = attempt;
    let recoveryError: unknown;
    let recovery: Promise<void>;
    recovery = this.recoverFromOutboundSendFailure(client)
      .catch((error) => {
        recoveryError = error;
        console.error('[WwebjsConnection] outbound_send_recovery_failed', {
          attempt,
          max_attempts: this.outboundSendRecoveryRetryDelaysMs.length + 1,
          error: getErrorMessage(error),
        });
      })
      .finally(() => {
        if (this.outboundSendRecoveryFlight === recovery) {
          this.outboundSendRecoveryFlight = undefined;
        }
        if (
          recoveryError !== undefined &&
          this.outboundSendRecoveryScope === client &&
          !this.userRequestedDisconnect &&
          (this.client === undefined || this.client === client)
        ) {
          this.scheduleOutboundSendRecoveryRetry(client, attempt);
        }
      });
    this.outboundSendRecoveryFlight = recovery;
  }

  private scheduleOutboundSendRecoveryRetry(
    client: Client,
    completedAttempt: number
  ): void {
    const delayMs =
      this.outboundSendRecoveryRetryDelaysMs[completedAttempt - 1];
    if (delayMs === undefined) {
      this.outboundSendRecoveryExhaustedScope = client;
      this.forceOutboundSendRecoveryFallback(client);
      return;
    }
    if (
      this.outboundSendRecoveryRetryTimer ||
      this.outboundSendRecoveryScope !== client
    ) {
      return;
    }

    this.outboundSendRecoveryRetryTimer = setTimeout(() => {
      this.outboundSendRecoveryRetryTimer = undefined;
      if (
        this.outboundSendRecoveryScope === client &&
        !this.userRequestedDisconnect &&
        (this.client === undefined || this.client === client)
      ) {
        this.startOutboundSendRecovery(client);
      }
    }, delayMs);
    this.outboundSendRecoveryRetryTimer.unref?.();
  }

  private forceOutboundSendRecoveryFallback(client: Client): void {
    if (
      this.outboundSendRecoveryScope !== client ||
      this.userRequestedDisconnect ||
      (this.client !== undefined && this.client !== client)
    ) {
      return;
    }

    console.error('[WwebjsConnection] outbound_send_recovery_exhausted', {
      attempts: this.outboundSendRecoveryAttempts,
      action: 'force_runtime_reconnect',
    });
    this.initialConnection = true;
    try {
      this.cancelAttempt(false);
    } catch (error) {
      console.error(
        '[WwebjsConnection] outbound_send_recovery_force_close_failed',
        {
          error: getErrorMessage(error),
        }
      );
    }
    this.setStatus(Status.disconnected, ECodeMessage.connectionLost);
    this.scheduleNextReconnectAttempt(true);
  }

  private resetOutboundSendRecoveryState(client: Client): void {
    if (this.outboundSendRecoveryRetryTimer) {
      clearTimeout(this.outboundSendRecoveryRetryTimer);
      this.outboundSendRecoveryRetryTimer = undefined;
    }
    this.outboundSendRecoveryScope = client;
    this.outboundSendRecoveryAttempts = 0;
    this.outboundSendRecoveryExhaustedScope = undefined;
  }

  private async recoverFromOutboundSendFailure(
    client = this.client
  ): Promise<void> {
    if (
      !client ||
      this.userRequestedDisconnect ||
      (this.client !== undefined && this.client !== client)
    ) {
      return;
    }

    this.incomingMessageService.markConnectionUnavailable(client);
    this.connectionEstablished = false;
    this.setCentralOnlineAcknowledged(false);
    this.setStatus(Status.connecting, ECodeMessage.connectionLost);
    const payload: IBaileysConnectionState = {
      status: Status.connecting,
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.wwebjs,
      code: ECodeMessage.connectionLost,
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: this.connectionAttemptId,
      runtime_generation: this.runtimeGeneration,
      debug_trace_id: this.debugTraceId,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: Boolean(client.info?.wid?._serialized),
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
      runtime_generation: this.runtimeGeneration,
      debug_trace_id: this.debugTraceId,
    });
  }

  clearUserRequestedDisconnect(): void {
    if (this.providerHandoffKey) {
      return;
    }
    this.userRequestedDisconnect = false;
  }

  republishLastState(): void {
    if (!this.lastPayload || !this.initialConnection) {
      return;
    }

    try {
      const payload = JSON.parse(this.lastPayload) as IBaileysConnectionState;
      this.publishTelemetry(payload);
    } catch (error) {
      console.error('[WwebjsConnection] Failed to parse lastPayload', {
        ...workerErrorDiagnostics(error),
      });
    }
  }

  private getSessionGuardContext(): WwebjsSessionGuardContext {
    return {
      sessionPath: this.getSessionPath(),
      runtimeRootPath: getFolder(),
      workerId: getWorker(),
      accountId: getAccount(),
      activationId: this.runtimeSessionActivationId,
      activationStartedAt: this.runtimeSessionActivationStartedAt,
      runtimeGeneration: this.runtimeGeneration,
      sessionVolumeName: wwebjsEnvironment.sessionVolumeName,
      quarantineRootPath: getSessionQuarantineRoot(),
      lockRootPath: getSessionLockRoot(),
    };
  }

  private acquireSessionLifecycleLease(): string | undefined {
    if (this.sessionLifecycleTerminationUnconfirmed) {
      return 'wwebjs_session_activation_fenced:previous_browser_termination_unconfirmed';
    }
    if (this.sessionLifecycleLease?.released) {
      this.sessionLifecycleLease = undefined;
    }
    if (this.sessionLifecycleLease) {
      return undefined;
    }

    try {
      this.sessionLifecycleLease = acquireWwebjsSessionLifecycleLease(
        this.getSessionGuardContext()
      );
      this.sessionLifecycleLeaseGeneration += 1;
      this.sessionLockRetryCount = 0;
      return undefined;
    } catch (error) {
      return getErrorMessage(error);
    }
  }

  private releaseSessionLifecycleLease(expectedOwnerToken?: string): void {
    const lease = this.sessionLifecycleLease;
    if (
      expectedOwnerToken !== undefined &&
      lease?.ownerToken !== expectedOwnerToken
    ) {
      return;
    }
    if (
      this.sessionLifecycleTerminationUnconfirmed ||
      this.browserRuntimeClients.size > 0
    ) {
      return;
    }
    this.sessionLifecycleLease = undefined;
    lease?.release();
  }

  private releaseSessionLifecycleLeaseIfCurrent(
    expectedLease: WwebjsSessionLifecycleLease | undefined
  ): void {
    if (this.sessionLifecycleLease !== expectedLease) {
      return;
    }
    this.releaseSessionLifecycleLease(expectedLease?.ownerToken);
  }

  private async runExclusiveSessionProfileTransition<T>(
    operation: string,
    transition: () => Promise<T>
  ): Promise<T> {
    const scopedOwner = sessionProfileTransitionScope.getStore()?.ownerToken;
    if (
      scopedOwner !== undefined &&
      scopedOwner === this.activeSessionProfileTransitionOwner
    ) {
      return transition();
    }

    const previous = this.sessionProfileTransitionTail.catch(() => undefined);
    let releaseTransition: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseTransition = resolve;
    });
    const ownerToken = `${operation}:${randomUUID()}`;
    const tail = previous.then(() => gate);
    this.sessionProfileTransitionTail = tail;

    await previous;
    this.activeSessionProfileTransitionOwner = ownerToken;
    try {
      return await sessionProfileTransitionScope.run(
        { ownerToken },
        transition
      );
    } finally {
      if (this.activeSessionProfileTransitionOwner === ownerToken) {
        this.activeSessionProfileTransitionOwner = undefined;
      }
      releaseTransition?.();
      if (this.sessionProfileTransitionTail === tail) {
        this.sessionProfileTransitionTail = Promise.resolve();
      }
    }
  }

  private async waitForSessionProfileTransition(): Promise<void> {
    const scopedOwner = sessionProfileTransitionScope.getStore()?.ownerToken;
    if (
      scopedOwner !== undefined &&
      scopedOwner === this.activeSessionProfileTransitionOwner
    ) {
      return;
    }

    await this.sessionProfileTransitionTail.catch(() => undefined);
  }

  private invalidatePendingConnectionInvocations(): void {
    this.connectionInvocationGeneration += 1;
  }

  private isCurrentConnectionInvocation(generation: number): boolean {
    return generation === this.connectionInvocationGeneration;
  }

  private fenceConnectionForQueuedLifecycleStop(
    publishStopped = true
  ): Client | undefined {
    const client = this.client;
    if (client && publishStopped) {
      const source = client as unknown as WwebjsNativeLifecycleStatusSource;
      source._setConnectionStatus?.(EWhatsappConnectionStatus.stopped, {
        reason: 'client_destroyed',
      });
      if (typeof source.getConnectionStatus === 'function') {
        this.acceptNativeConnectionStatus(
          source,
          source.getConnectionStatus(),
          true
        );
      }
    }
    this.invalidatePendingConnectionInvocations();
    this.invalidateClientConnectionAttempt(client);
    if (this.client === client) {
      this.client = undefined;
    }
    this.currentPromise = undefined;
    this.activeConnectionAttemptId = undefined;
    this.connecting = false;
    this.connectionEstablished = false;
    this.clearDisconnectRetryTimer();
    this.clearConnectionStateProbe();
    this.cancelKafkaReadinessRetry();
    this.incomingMessageService.unbind();
    return client;
  }

  private withSessionLifecycleLease<T>(operation: () => T): T {
    if (this.sessionLifecycleTerminationUnconfirmed) {
      throw new Error(
        'wwebjs_session_activation_fenced:previous_browser_termination_unconfirmed'
      );
    }
    const scopedLease = sessionLifecycleLeaseScope.getStore();
    if (
      scopedLease !== undefined &&
      this.sessionLifecycleLease?.ownerToken !== scopedLease.ownerToken
    ) {
      throw new Error(
        'wwebjs_session_activation_fenced:session_lifecycle_owner_changed'
      );
    }
    const alreadyHeld = Boolean(
      this.sessionLifecycleLease && !this.sessionLifecycleLease.released
    );
    if (!alreadyHeld) {
      const error = this.acquireSessionLifecycleLease();
      if (error) {
        throw new Error(error);
      }
    }

    try {
      return operation();
    } finally {
      if (!alreadyHeld) {
        this.releaseSessionLifecycleLease();
      }
    }
  }

  private getPostgresSessionStore(): PostgresWwebjsSessionStore {
    if (!usesPostgresSessionStorage()) {
      throw new Error('wwebjs_postgres_session_store_requested_in_legacy_mode');
    }
    if (this.sessionLifecycleTerminationUnconfirmed) {
      throw new Error(
        'wwebjs_postgres_session_store_fenced:process_replacement_required'
      );
    }

    if (!this.postgresSessionStore) {
      const store =
        createPostgresWwebjsSessionStoreFromEnvironment(getWorker());
      this.postgresSessionStore = store;
      store.setLeaseLostHandler((error) => {
        if (this.postgresSessionStore !== store) return;
        this.handlePostgresSessionLeaseLost(error);
      });
    }
    return this.postgresSessionStore;
  }

  private getRemoteSessionName(): string {
    return `RemoteAuth-${getWorker()}`;
  }

  private refreshPostgresSessionState(): Promise<void> {
    if (!usesPostgresSessionStorage()) {
      return Promise.resolve();
    }
    if (this.sessionLifecycleTerminationUnconfirmed) {
      return Promise.resolve();
    }
    if (this.postgresSessionRefreshPromise) {
      return this.postgresSessionRefreshPromise;
    }

    const operation = this.runPostgresSessionStateRefresh();
    const tracked = operation.finally(() => {
      if (this.postgresSessionRefreshPromise === tracked) {
        this.postgresSessionRefreshPromise = undefined;
      }
    });
    this.postgresSessionRefreshPromise = tracked;
    return tracked;
  }

  private async runPostgresSessionStateRefresh(): Promise<void> {
    const startedAt = Date.now();
    const store = this.getPostgresSessionStore();
    const evidenceGeneration = this.postgresSessionEvidenceGeneration;
    this.logDebug('wwebjs.provider.postgres_session_refresh_started', {
      trace_id: this.debugTraceId,
      layer: 'wwebjs',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.wwebjs,
      connection_attempt_id: this.connectionAttemptId,
      runtime_generation: this.runtimeGeneration,
      stage: 'revision_open',
    });
    try {
      let sessionExists = await store.sessionExists({
        session: this.getRemoteSessionName(),
      });
      await this.bootstrapLegacyVolumeMigration(store);
      sessionExists =
        sessionExists ||
        ['validating', 'active'].includes(store.revisionStatus ?? '');
      if (
        this.postgresSessionStore !== store ||
        evidenceGeneration !== this.postgresSessionEvidenceGeneration
      ) {
        return;
      }
      if (
        this.userRequestedDisconnect ||
        this.isTerminalSessionDisconnectCode(this.code)
      ) {
        this.postgresSessionKnown = false;
        return;
      }
      this.postgresSessionKnown = sessionExists;
      this.logDebug('wwebjs.provider.postgres_session_refresh_completed', {
        trace_id: this.debugTraceId,
        layer: 'wwebjs',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.wwebjs,
        connection_attempt_id: this.connectionAttemptId,
        runtime_generation: this.runtimeGeneration,
        revision_id: store.revisionId,
        revision_status: store.revisionStatus,
        has_session: this.postgresSessionKnown,
        duration_ms: Date.now() - startedAt,
        stage: 'revision_open',
      });
    } catch (error) {
      this.logDebug('wwebjs.provider.postgres_session_refresh_failed', {
        trace_id: this.debugTraceId,
        layer: 'wwebjs',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.wwebjs,
        connection_attempt_id: this.connectionAttemptId,
        runtime_generation: this.runtimeGeneration,
        duration_ms: Date.now() - startedAt,
        stage: 'revision_open',
        reason: workerErrorFailureReason(
          'wwebjs_postgres_session_open_failed',
          error
        ),
        ...workerErrorDiagnostics(error),
      });
      throw error;
    }
  }

  private async bootstrapLegacyVolumeMigration(
    store: PostgresWwebjsSessionStore
  ): Promise<void> {
    const migrationId = process.env.SESSION_STORAGE_MIGRATION_ID?.trim();
    if (!migrationId || this.legacyVolumeMigrationBootstrapped) {
      return;
    }

    const expectedChecksum =
      process.env.LEGACY_SESSION_CHECKSUM_SHA256?.trim().toLowerCase();
    if (!expectedChecksum || !/^[a-f0-9]{64}$/.test(expectedChecksum)) {
      throw new Error('legacy_session_migration_checksum_invalid');
    }
    if (
      ['validating', 'active'].includes(store.revisionStatus ?? '') &&
      (await store.sessionExists({ session: this.getRemoteSessionName() }))
    ) {
      this.legacyVolumeMigrationBootstrapped = true;
      return;
    }
    if (
      store.revisionStatus !== 'staging' ||
      store.revisionSource !== 'legacy_volume_migration'
    ) {
      throw new Error('legacy_session_migration_revision_not_stageable');
    }

    const legacyRoot = '/app/legacy-session';
    const snapshot = await snapshotLegacySessionVolume(legacyRoot);
    if (snapshot.checksumSha256 !== expectedChecksum) {
      throw new Error('legacy_session_migration_checksum_mismatch');
    }
    const profilePath = path.join(
      legacyRoot,
      'wwebjs',
      'storage',
      getWorker(),
      '.wwebjs_auth',
      `session-${getWorker()}`
    );
    await withWritableWwebjsLegacyProfileCopy(profilePath, async (staging) => {
      const stableSnapshot = await snapshotLegacySessionVolume(legacyRoot);
      if (
        stableSnapshot.checksumSha256 !== snapshot.checksumSha256 ||
        stableSnapshot.sizeBytes !== snapshot.sizeBytes ||
        stableSnapshot.recordCount !== snapshot.recordCount
      ) {
        throw new Error('legacy_session_migration_source_changed');
      }
      await store.initializeLegacyVolumeCandidateProfile(staging);
      await store.stageCandidate({
        session: this.getRemoteSessionName(),
        profilePath: staging,
      });
    });
    this.postgresSessionKnown = true;
    this.legacyVolumeMigrationBootstrapped = true;
  }

  private async purgePostgresSession(): Promise<void> {
    if (!usesPostgresSessionStorage()) {
      return;
    }

    const store = this.getPostgresSessionStore();
    const failures: unknown[] = [];
    try {
      // Client.logout() normally deletes through RemoteAuth while it still
      // owns the writer lease. Recovery may arrive after an older client
      // already closed that lease, though. Chromium has been proven stopped
      // before this method runs, so reacquire the exact runtime fence and make
      // the provider-owned purge idempotent for that stranded state.
      if (!store.getConnectionStatusLeaseProof()) {
        await store.open();
      }
      await store.delete();
    } catch (error) {
      failures.push(error);
    }
    try {
      await store.close({ requireLeaseRelease: true });
    } catch (error) {
      failures.push(error);
    }
    if (failures.length === 1) {
      throw failures[0];
    }
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        'wwebjs_postgres_session_purge_failed',
        { cause: failures[0] }
      );
    }
    this.postgresSessionEvidenceGeneration += 1;
    this.postgresSessionKnown = false;
    this.sessionRestoreBlocked = false;
  }

  private inspectCurrentLocalSession(): WwebjsSessionInspection {
    if (usesPostgresSessionStorage()) {
      const restorable =
        this.postgresSessionKnown && !this.sessionRestoreBlocked;
      return {
        exists: this.postgresSessionKnown,
        hasDurableAuthArtifacts: this.postgresSessionKnown,
        restorable,
        blockedReason: this.postgresSessionKnown
          ? this.sessionRestoreBlocked
            ? 'restore_attempts_exhausted'
            : undefined
          : 'missing_session',
        invalidMarker: false,
        incompleteActivationDetected: false,
      };
    }

    const context = this.getSessionGuardContext();
    let inspection = inspectWwebjsLocalAuthSession(
      context,
      WWEBJS_STALE_SESSION_MAX_RESTORE_ATTEMPTS
    );
    const incompleteActivation =
      inspection.incompleteActivationDetected ||
      inspection.marker?.incomplete_activation_detected === true;

    if (
      incompleteActivation &&
      WWEBJS_INCOMPLETE_ACTIVATION_MAX_RESTORE_ATTEMPTS <
        WWEBJS_STALE_SESSION_MAX_RESTORE_ATTEMPTS
    ) {
      inspection = inspectWwebjsLocalAuthSession(
        context,
        WWEBJS_INCOMPLETE_ACTIVATION_MAX_RESTORE_ATTEMPTS
      );
    }

    return inspection;
  }

  hasSession(): boolean {
    if (
      this.sessionRestoreBlocked ||
      this.userRequestedDisconnect ||
      this.isTerminalSessionDisconnectCode(this.code)
    ) {
      return false;
    }

    return this.inspectCurrentLocalSession().restorable;
  }

  private beginRuntimeSessionActivation(): string | undefined {
    if (usesPostgresSessionStorage()) {
      // The PostgreSQL adapter takes the canonical runtime lock first and
      // validates generation, writer epoch and capability on every access.
      return undefined;
    }

    try {
      return this.withSessionLifecycleLease(() => {
        const context = this.getSessionGuardContext();
        const inspection = this.inspectCurrentLocalSession();
        beginWwebjsRuntimeSessionActivation(context);
        if (inspection.restorable) {
          ensureWwebjsSessionCandidate(
            context,
            'legacy_profile',
            inspection.incompleteActivationDetected
          );
        }

        if (inspection.incompleteActivationDetected) {
          this.logDebug(
            'wwebjs.provider.session_incomplete_activation_detected',
            {
              trace_id: this.debugTraceId,
              layer: 'wwebjs',
              worker_id: getWorker(),
              account_id: getAccount(),
              worker_type_id: EWorkerType.wwebjs,
              connection_attempt_id: this.connectionAttemptId,
              runtime_generation: this.runtimeGeneration,
              previous_runtime_generation:
                inspection.runtimeActivation?.runtime_generation,
              session_volume_name: wwebjsEnvironment.sessionVolumeName,
              session_state: inspection.marker?.state ?? 'legacy',
              restore_failures: inspection.marker?.restore_failures ?? 0,
            }
          );
        }
        return undefined;
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      if (!isWwebjsSessionLockBusy(error)) {
        this.sessionRestoreBlocked = true;
      }
      console.error(
        '[WwebjsConnection] Failed to persist runtime session activation marker',
        error
      );
      return errorMessage;
    }
  }

  private markProviderSessionValidated(): boolean {
    if (usesPostgresSessionStorage()) {
      // RemoteAuth emits READY only after the first durable checkpoint.
      this.postgresSessionKnown = true;
      this.sessionRestoreBlocked = false;
      this.inMemoryUnpairedRestoreFailures = 0;
      return true;
    }

    try {
      return this.withSessionLifecycleLease(() => {
        const context = this.getSessionGuardContext();
        const marker = markWwebjsSessionValidated(context);
        if (!marker) {
          throw new Error('wwebjs_session_durable_auth_artifacts_missing');
        }
        markWwebjsRuntimeSessionReady(context);
        this.sessionRestoreBlocked = false;
        this.inMemoryUnpairedRestoreFailures = 0;
        this.logDebug('wwebjs.provider.session_validated', {
          trace_id: this.debugTraceId,
          layer: 'wwebjs',
          worker_id: getWorker(),
          account_id: getAccount(),
          worker_type_id: EWorkerType.wwebjs,
          connection_attempt_id: this.connectionAttemptId,
          runtime_generation: this.runtimeGeneration,
          session_volume_name: wwebjsEnvironment.sessionVolumeName,
          marker_written: true,
        });
        return true;
      });
    } catch (error) {
      if (!isWwebjsSessionLockBusy(error)) {
        this.sessionRestoreBlocked = true;
      }
      console.error(
        '[WwebjsConnection] Failed to persist validated session marker',
        error
      );
      return false;
    }
  }

  private markSecureImportSessionCandidate(): void {
    if (usesPostgresSessionStorage()) {
      return;
    }

    try {
      this.withSessionLifecycleLease(() => {
        ensureWwebjsSessionCandidate(
          this.getSessionGuardContext(),
          'secure_import'
        );
      });
    } catch (error) {
      console.error(
        '[WwebjsConnection] Failed to persist secure import session marker',
        error
      );
    }
  }

  private recordSessionRestoreFailure(
    providerState: string,
    reason: string
  ): {
    failures: number;
    maxAttempts: number;
    marker?: WwebjsSessionMarker;
  } {
    this.inMemoryUnpairedRestoreFailures += 1;
    if (usesPostgresSessionStorage()) {
      return {
        failures: this.inMemoryUnpairedRestoreFailures,
        maxAttempts: WWEBJS_STALE_SESSION_MAX_RESTORE_ATTEMPTS,
      };
    }

    let marker: WwebjsSessionMarker | undefined;
    try {
      marker = this.withSessionLifecycleLease(() =>
        recordWwebjsSessionRestoreFailure(
          this.getSessionGuardContext(),
          providerState,
          reason
        )
      );
    } catch (error) {
      console.error(
        '[WwebjsConnection] Failed to persist stale session restore failure',
        error
      );
    }

    const incompleteActivation =
      marker?.incomplete_activation_detected === true ||
      this.inspectCurrentLocalSession().incompleteActivationDetected;
    const maxAttempts = incompleteActivation
      ? WWEBJS_INCOMPLETE_ACTIVATION_MAX_RESTORE_ATTEMPTS
      : WWEBJS_STALE_SESSION_MAX_RESTORE_ATTEMPTS;
    const failures = Math.max(
      this.inMemoryUnpairedRestoreFailures,
      marker?.restore_failures ?? 0
    );
    return { failures, maxAttempts, marker };
  }

  private quarantineCurrentSession(
    reason: string
  ): WwebjsSessionQuarantineResult {
    this.sessionRestoreBlocked = true;
    if (usesPostgresSessionStorage()) {
      // A corrupt active revision is never deleted implicitly. RemoteAuth has
      // already attempted the previous checksum-verified revision once; an
      // explicit logout/reset remains the only destructive path.
      return { blocked: true, moved: false, error: reason };
    }

    let result: WwebjsSessionQuarantineResult;
    try {
      result = this.withSessionLifecycleLease(() =>
        quarantineWwebjsLocalAuthSession(this.getSessionGuardContext(), reason)
      );
    } catch (error) {
      result = {
        blocked: true,
        moved: false,
        error: getErrorMessage(error),
      };
    }
    this.logDebug('wwebjs.provider.session_quarantined', {
      trace_id: this.debugTraceId,
      layer: 'wwebjs',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.wwebjs,
      connection_attempt_id: this.connectionAttemptId,
      runtime_generation: this.runtimeGeneration,
      session_volume_name: wwebjsEnvironment.sessionVolumeName,
      reason,
      quarantine_moved: result.moved,
      quarantine_blocked: result.blocked,
      quarantine_error: result.error,
    });
    return result;
  }

  private purgeCurrentSessionQuarantine(strict = false): void {
    if (usesPostgresSessionStorage()) {
      this.sessionRestoreBlocked = false;
      return;
    }

    let result: ReturnType<typeof purgeWwebjsSessionQuarantine>;
    try {
      result = this.withSessionLifecycleLease(() =>
        purgeWwebjsSessionQuarantine(this.getSessionGuardContext())
      );
    } catch (error) {
      result = { purged: false, error: getErrorMessage(error) };
    }
    this.logDebug('wwebjs.provider.session_quarantine_purged', {
      trace_id: this.debugTraceId,
      layer: 'wwebjs',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.wwebjs,
      connection_attempt_id: this.connectionAttemptId,
      runtime_generation: this.runtimeGeneration,
      session_volume_name: wwebjsEnvironment.sessionVolumeName,
      purged: result.purged,
      error: result.error,
    });
    if (strict && !result.purged) {
      throw new Error(
        result.error || 'wwebjs_session_quarantine_purge_unconfirmed'
      );
    }
  }

  private prepareInvalidSessionForExplicitQr(): boolean {
    const inspection = this.inspectCurrentLocalSession();
    if (!inspection.exists) {
      this.sessionRestoreBlocked = false;
      return true;
    }

    if (inspection.restorable && !this.sessionRestoreBlocked) {
      return true;
    }

    const quarantine = this.quarantineCurrentSession(
      `explicit_qr_${inspection.blockedReason ?? 'blocked_session'}`
    );
    if (quarantine.moved) {
      this.sessionRestoreBlocked = false;
      return true;
    }

    return false;
  }

  private publishQrRequiredState(
    reason: string,
    error?: string,
    attempt?: number,
    maxAttempts?: number
  ): IBaileysConnectionState {
    this.clearConnectionStateProbe();
    this.clearDisconnectRetryTimer();
    this.cancelKafkaReadinessRetry();
    this.connectionEstablished = false;
    this.connecting = false;
    this.resetQrReadSession();
    this.qrReadSessionLocked = false;
    this.setStatus(Status.disconnected, ECodeMessage.badSession);

    const payload = this.state(undefined, undefined, {
      status: Status.disconnected,
      code: ECodeMessage.badSession,
      worker_status_id: EWorkerStatus.disponible,
      reason,
      error,
      attempt,
      max_attempts: maxAttempts,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      provider_state: 'QR_REQUIRED',
      degraded_reason: reason,
    });
    this.publishSub(payload, true);
    void this.notifyWorkerStatusSafely(payload, reason);
    this.resolvePendingState(payload);
    return payload;
  }

  private publishSessionActivationBlockedState(
    error: string
  ): IBaileysConnectionState {
    if (isWwebjsSessionLockBusy(error)) {
      return this.publishSessionLockBusyState(error);
    }

    if (this.isActivePostgresSessionRevision()) {
      this.clearConnectionStateProbe();
      this.clearDisconnectRetryTimer();
      this.cancelKafkaReadinessRetry();
      this.connectionEstablished = false;
      this.connecting = false;
      this.sessionRestoreBlocked = false;
      this.postgresSessionKnown = true;
      this.setStatus(Status.connecting, ECodeMessage.awaitConnection);
      const payload = this.state(undefined, undefined, {
        status: Status.connecting,
        code: ECodeMessage.awaitConnection,
        worker_status_id: EWorkerStatus.disponible,
        reason: 'postgres_active_revision_restarting',
        error,
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        provider_state: 'postgres_active_revision_restarting',
        degraded_reason: error,
      });
      this.publishSub(payload, true);
      void this.notifyWorkerStatusSafely(
        payload,
        'postgres_active_revision_restarting'
      );
      this.resolvePendingState(payload);
      this.scheduleNextReconnectAttempt(false);
      return payload;
    }

    this.clearConnectionStateProbe();
    this.clearDisconnectRetryTimer();
    this.cancelKafkaReadinessRetry();
    this.connectionEstablished = false;
    this.connecting = false;
    this.sessionRestoreBlocked = true;
    this.setStatus(Status.disconnected, ECodeMessage.connectionLost);

    const payload = this.state(undefined, undefined, {
      status: Status.disconnected,
      code: ECodeMessage.connectionLost,
      worker_status_id: EWorkerStatus.disponible,
      reason: 'session_activation_fenced',
      error,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      provider_state: 'SESSION_ACTIVATION_FENCED',
      degraded_reason: 'session_activation_fenced',
    });
    this.publishSub(payload, true);
    void this.notifyWorkerStatusSafely(payload, 'session_activation_fenced');
    this.resolvePendingState(payload);
    return payload;
  }

  private publishSessionLockBusyState(error: string): IBaileysConnectionState {
    this.clearConnectionStateProbe();
    this.clearDisconnectRetryTimer();
    this.cancelKafkaReadinessRetry();
    this.connectionEstablished = false;
    this.connecting = false;
    this.sessionRestoreBlocked = false;
    this.setStatus(Status.connecting, ECodeMessage.awaitConnection);

    const payload = this.state(undefined, undefined, {
      status: Status.connecting,
      code: ECodeMessage.awaitConnection,
      worker_status_id: EWorkerStatus.disponible,
      reason: 'session_lifecycle_lock_busy',
      error,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      provider_state: 'SESSION_LOCK_BUSY',
      degraded_reason: 'session_lifecycle_lock_busy',
    });
    this.publishSub(payload, true);
    void this.notifyWorkerStatusSafely(payload, 'session_lifecycle_lock_busy');
    this.resolvePendingState(payload);
    this.scheduleSessionLockRetry();
    return payload;
  }

  private async handleSessionActivationValidationFailure(
    client: Client,
    attemptId: number,
    error: string
  ): Promise<IBaileysConnectionState> {
    if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
      return this.state();
    }

    if (this.isActivePostgresSessionRevision()) {
      return (
        this.recoverActivePostgresSessionRevision(
          client,
          attemptId,
          'wwebjs_active_postgres_runtime_activation_failed'
        ) ?? this.state()
      );
    }

    this.clearConnectionStateProbe();
    this.cancelKafkaReadinessRetry();
    this.invalidateClientConnectionAttempt(client);
    this.connectionEstablished = false;
    this.connecting = false;
    this.activeConnectionAttemptId = undefined;
    this.currentPromise = undefined;
    if (this.client === client) {
      this.client = undefined;
    }
    this.incomingMessageService.markConnectionUnavailable(client);
    this.incomingMessageService.unbind();
    this.healthCheckService.stop();

    const providerRuntimeStop = this.stopProviderRuntimeAndWait(
      'session activation validation failure'
    ).catch(() => undefined);
    this.queueTeardown('session_activation_validation_failure', async () => {
      const terminated = await this.destroyClientWithTimeout(
        client,
        'session_activation_validation_failure'
      );
      if (!terminated) {
        return false;
      }
      this.clearChromiumProfileLock();
      return true;
    });
    await Promise.allSettled([
      providerRuntimeStop,
      this.waitForPendingTeardown(),
    ]);

    if (this.sessionLifecycleTerminationUnconfirmed) {
      return this.state();
    }

    return this.publishSessionActivationBlockedState(error);
  }

  private applyConnectionVerificationContext(
    input: Pick<
      IBaileysConnectionState,
      'connection_attempt_id' | 'debug_trace_id' | 'runtime_generation'
    >
  ): {
    connectionAttemptId?: string;
    debugTraceId?: string;
    runtimeGeneration?: number;
  } {
    const runtimeGeneration =
      input.runtime_generation ?? this.runtimeGeneration;
    this.runtimeGeneration = runtimeGeneration;
    return {
      connectionAttemptId:
        input.connection_attempt_id ?? this.connectionAttemptId,
      debugTraceId: input.debug_trace_id ?? this.debugTraceId,
      runtimeGeneration,
    };
  }

  // Provider verification intentionally keeps every generation/fence check in
  // one serialized orchestration boundary.
  // eslint-disable-next-line max-statements
  async verifyAndPublishConnectionStatus(
    input: Pick<
      IBaileysConnectionState,
      | 'connection_attempt_id'
      | 'authorized_connection_epoch'
      | 'debug_trace_id'
      | 'runtime_generation'
    > = {}
  ): Promise<IBaileysConnectionState> {
    const client = this.client;
    const attemptId = client
      ? this.clientConnectionAttemptIds.get(client)
      : undefined;
    const { connectionAttemptId, runtimeGeneration, debugTraceId } =
      this.applyConnectionVerificationContext(input);

    if (
      !client ||
      attemptId === undefined ||
      !this.isActiveClientConnectionAttempt(client, attemptId)
    ) {
      this.incomingMessageService.markConnectionUnavailable(client);
      this.stopProviderRuntime('client unavailable verification');
      const payload = this.state(undefined, undefined, {
        status: Status.disconnected,
        code: ECodeMessage.connectionLost,
        worker_status_id: EWorkerStatus.offline,
        connection_attempt_id: connectionAttemptId,
        runtime_generation: runtimeGeneration,
        debug_trace_id: debugTraceId,
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        provider_state: 'client_unavailable',
        degraded_reason: 'client_unavailable',
      });

      this.publishSub(payload, true);
      await this.notifyWorkerStatusSafely(payload, 'verify_client_unavailable');
      return this.withConnectionMetadata(payload);
    }

    const releaseProviderRuntimeTransition =
      await this.acquireProviderRuntimeTransition();
    try {
      if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
        return this.state();
      }
      const confirmedOnlineState = this.getConfirmedOnlineState(
        client,
        attemptId,
        connectionAttemptId,
        runtimeGeneration
      );
      if (confirmedOnlineState) {
        return confirmedOnlineState;
      }
      await this.recoverProviderRuntimeStopIfNeeded();
      if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
        return this.state();
      }

      let readiness = await this.healthCheckService.verifyCurrentSession();
      if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
        return this.state();
      }

      if (!readiness.session_ready) {
        this.incomingMessageService.markConnectionUnavailable(client);
        this.setStatus(Status.connecting, ECodeMessage.awaitConnection);
        this.connectionEstablished = false;
        this.startConnectionStateProbe(client, attemptId, readProxyConfig());

        const payload: IBaileysConnectionState = {
          status: this.status,
          worker_id: getWorker(),
          account_id: getAccount(),
          code: this.code,
          phone: this.getClientPhone(client),
          worker_status_id: EWorkerStatus.disponible,
          connection_attempt_id: connectionAttemptId,
          runtime_generation: runtimeGeneration,
          debug_trace_id: debugTraceId,
          session_ready: false,
          can_send: readiness.can_send,
          can_receive_runtime: readiness.can_receive_runtime,
          authenticated: readiness.authenticated,
          provider_state: readiness.provider_state,
          degraded_reason:
            readiness.degraded_reason ??
            readiness.reason ??
            'session_not_ready',
          last_probe_at: readiness.last_probe_at,
          probe_latency_ms: readiness.probe_latency_ms,
        };

        await this.notifyWorkerStatusSafely(payload, 'verify_not_ready');
        if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
          return this.state();
        }
        this.healthCheckService.markStatusPublished(readiness);
        this.publishSub(payload, true);
        return this.withConnectionMetadata(payload);
      }

      if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
        return this.state();
      }

      let runtimeActivation: WwebjsProviderRuntimeActivation | undefined;
      let kafkaConsumersStarted = false;
      try {
        runtimeActivation = this.claimValidatedProviderRuntimeActivation(
          client,
          attemptId
        );
        if (!(await this.incomingMessageService.prepareConnectionFence())) {
          throw new Error('whatsapp_runtime_fence_activation_failed');
        }
        if (!this.isActiveProviderRuntimeActivation(runtimeActivation)) {
          await this.stopProviderRuntimeActivationIfOwned(
            runtimeActivation,
            'stale verified runtime fence'
          );
          return this.state();
        }
        await emitWorkerProviderRuntimeState('wwebjs', true);
        kafkaConsumersStarted = true;
        if (!this.isActiveProviderRuntimeActivation(runtimeActivation)) {
          await this.stopProviderRuntimeActivationIfOwned(
            runtimeActivation,
            'stale verified connection'
          );
          return this.state();
        }

        readiness = await this.healthCheckService.verifyCurrentSession();
        if (!this.isActiveProviderRuntimeActivation(runtimeActivation)) {
          await this.stopProviderRuntimeActivationIfOwned(
            runtimeActivation,
            'stale verified readiness'
          );
          return this.state();
        }

        if (
          readiness.session_ready !== true ||
          readiness.can_send !== true ||
          readiness.can_receive_runtime !== true ||
          readiness.authenticated !== true
        ) {
          throw new Error(
            readiness.degraded_reason ??
              readiness.reason ??
              'provider_became_unavailable_during_consumer_startup'
          );
        }

        if (!(await this.incomingMessageService.markConnectionReady())) {
          throw new Error('whatsapp_runtime_fence_activation_failed');
        }
      } catch (error) {
        if (!runtimeActivation) {
          return this.handleSessionActivationValidationFailure(
            client,
            attemptId,
            getErrorMessage(error)
          );
        }
        const preserveProviderRuntime = isKafkaConsumerReadinessPending(error);
        if (!preserveProviderRuntime) {
          this.incomingMessageService.markConnectionUnavailable(client);
        }
        if (!this.isActiveProviderRuntimeActivation(runtimeActivation)) {
          await this.stopProviderRuntimeActivationIfOwned(
            runtimeActivation,
            'stale verified Kafka startup'
          );
          return this.state();
        }

        if (!preserveProviderRuntime) {
          await this.stopProviderRuntimeActivationIfOwned(
            runtimeActivation,
            kafkaConsumersStarted
              ? 'verified provider readiness failure after Kafka startup'
              : 'verified Kafka consumer startup failure'
          );
        }
        if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
          return this.state();
        }

        this.setStatus(Status.connecting, ECodeMessage.awaitConnection, true);
        this.connectionEstablished = false;
        if (kafkaConsumersStarted) {
          this.startConnectionStateProbe(client, attemptId, readProxyConfig());
        } else {
          this.scheduleKafkaReadinessRetry(
            client,
            attemptId,
            readProxyConfig()
          );
        }
        const degradedReason = getErrorMessage(error);
        const unavailablePayload: IBaileysConnectionState = {
          status: this.status,
          worker_id: getWorker(),
          account_id: getAccount(),
          code: this.code,
          phone: this.getClientPhone(client),
          worker_status_id: EWorkerStatus.disponible,
          connection_attempt_id: connectionAttemptId,
          runtime_generation: runtimeGeneration,
          debug_trace_id: debugTraceId,
          session_ready: false,
          can_send: false,
          can_receive_runtime: readiness.can_receive_runtime,
          authenticated: readiness.authenticated,
          provider_state: preserveProviderRuntime
            ? 'kafka_consumers_not_ready'
            : kafkaConsumersStarted
              ? (readiness.provider_state ?? 'provider_not_ready')
              : 'kafka_consumers_not_ready',
          degraded_reason: degradedReason,
          last_probe_at: readiness.last_probe_at,
          probe_latency_ms: readiness.probe_latency_ms,
        };

        this.publishSub(unavailablePayload, true);
        await this.notifyWorkerStatusSafely(
          unavailablePayload,
          kafkaConsumersStarted
            ? 'verify_provider_readiness_failed'
            : 'verify_kafka_consumers_failed'
        );
        return unavailablePayload;
      }

      const payload: IBaileysConnectionState = {
        status: Status.connected,
        worker_id: getWorker(),
        account_id: getAccount(),
        code: ECodeMessage.connectionEstablished,
        phone: this.getClientPhone(client),
        worker_status_id: EWorkerStatus.online,
        connection_attempt_id: connectionAttemptId,
        runtime_generation: runtimeGeneration,
        debug_trace_id: debugTraceId,
        session_ready: true,
        can_send: readiness.can_send,
        can_receive_runtime: readiness.can_receive_runtime,
        authenticated: readiness.authenticated,
        provider_state: readiness.provider_state,
        degraded_reason: readiness.degraded_reason,
        last_probe_at: readiness.last_probe_at,
        probe_latency_ms: readiness.probe_latency_ms,
      };

      if (!this.isActiveProviderRuntimeActivation(runtimeActivation)) {
        this.incomingMessageService.markConnectionUnavailable(client);
        await this.stopProviderRuntimeActivationIfOwned(
          runtimeActivation,
          'stale verified status publication'
        );
        return this.state();
      }
      if (!this.isCurrentNativeConnectionOnline(client)) {
        this.setCentralOnlineAcknowledged(false);
        return this.state();
      }
      const notification = await this.notifyWorkerStatusSafely(
        payload,
        'verify_ready'
      );
      if (!this.isActiveProviderRuntimeActivation(runtimeActivation)) {
        this.incomingMessageService.markConnectionUnavailable(client);
        await this.stopProviderRuntimeActivationIfOwned(
          runtimeActivation,
          'stale verified status notification'
        );
        return this.state();
      }
      if (!this.isCurrentNativeConnectionOnline(client)) {
        this.setCentralOnlineAcknowledged(false);
        return this.state();
      }

      if (notification.outcome !== 'accepted') {
        if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
          return this.state();
        }
        const isRecoverableFailure =
          notification.outcome === 'failed' &&
          notification.classification === 'recoverable';
        const notificationReason =
          notification.outcome === 'failed'
            ? notification.reason
            : 'unexpected_worker_status_deferral';
        if (!isRecoverableFailure) {
          this.clearConnectionStateProbe();
          this.cancelKafkaReadinessRetry();
          this.incomingMessageService.markConnectionUnavailable(client);
          await this.stopProviderRuntimeActivationIfOwned(
            runtimeActivation,
            'terminal verified online status rejection'
          );
          this.healthCheckService.stop();
        }
        if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
          return this.state();
        }
        this.setStatus(Status.connecting, ECodeMessage.awaitConnection, true);
        this.connectionEstablished = false;
        if (isRecoverableFailure) {
          this.scheduleKafkaReadinessRetry(
            client,
            attemptId,
            readProxyConfig()
          );
        }
        console.warn(
          '[WwebjsConnection] Verified connection remains pending because NotifyWorkerStatus failed',
          {
            worker_id: payload.worker_id,
            account_id: payload.account_id,
            connection_attempt_id: payload.connection_attempt_id,
            classification: isRecoverableFailure ? 'recoverable' : 'terminal',
            error: notificationReason,
          }
        );
        return this.state(undefined, undefined, {
          worker_status_id: EWorkerStatus.disponible,
          session_ready: false,
          can_send: false,
          can_receive_runtime: isRecoverableFailure
            ? readiness.can_receive_runtime
            : false,
          authenticated: readiness.authenticated,
          provider_state: isRecoverableFailure
            ? 'worker_status_not_published'
            : 'worker_status_rejected',
          degraded_reason: notificationReason,
        });
      }

      this.clearConnectionStateProbe();
      this.cancelKafkaReadinessRetry();
      this.resetQrReadSession();
      this.qrReadSessionLocked = false;
      this.qrHash = undefined;
      this.retryCount = 0;
      this.clearDisconnectRetryTimer();
      this.setStatus(Status.connected, ECodeMessage.connectionEstablished);
      this.connectionEstablished = true;
      this.setCentralOnlineAcknowledged(true, {
        client,
        attemptId,
        payload,
      });
      this.healthCheckService.markStatusPublished(readiness);
      this.publishSub(payload, true);
      this.healthCheckService.start(HEALTH_CHECK_INTERVAL_MS);
      return this.withConnectionMetadata(payload);
    } finally {
      releaseProviderRuntimeTransition();
    }
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

  private resolveConnectionRuntimeFenceAuthorization(
    input: IBaileysConnection
  ): Promise<IWhatsappRuntimeFenceConnectionAuthorization | undefined> {
    const currentAuthorization = this.runtimeFenceConnectionAuthorization;
    const currentAttemptId = currentAuthorization?.connection_attempt_id;
    const requestedAttemptId = input.connection_attempt_id?.trim();
    if (
      input.from_disconnect_restart === true &&
      this.canContinueQrReadSession() &&
      currentAuthorization !== undefined &&
      currentAttemptId !== undefined &&
      currentAttemptId === requestedAttemptId
    ) {
      return Promise.resolve({ ...currentAuthorization });
    }

    return this.resolveRuntimeFenceConnectionAuthorization(input);
  }

  private async resolveRuntimeFenceConnectionAuthorizationExclusive(
    input: IBaileysConnection
  ): Promise<IWhatsappRuntimeFenceConnectionAuthorization> {
    const runtimeGeneration = Number(
      input.runtime_generation ?? wwebjsEnvironment.runtimeGeneration
    );
    if (
      !Number.isSafeInteger(runtimeGeneration) ||
      runtimeGeneration <= 0 ||
      runtimeGeneration !== Number(wwebjsEnvironment.runtimeGeneration)
    ) {
      throw new TypeError('wwebjs_runtime_fence_generation_invalid');
    }

    const authorizedConnectionEpoch = input.authorized_connection_epoch?.trim();
    const connectionAttemptId = input.connection_attempt_id?.trim();
    if (authorizedConnectionEpoch) {
      if (
        !connectionAttemptId ||
        input.requested_by_user !== true ||
        (input.type ?? EBaileysConnectionType.qrcode) !==
          EBaileysConnectionType.qrcode
      ) {
        throw new TypeError('wwebjs_pairing_activation_grant_invalid');
      }
      await this.balanceWorkerStatusGrpcClientService.activateWhatsappRuntimeFence(
        {
          worker_id: getWorker(),
          account_id: getAccount(),
          source_provider: 'wwebjs',
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
          source_provider: 'wwebjs',
          runtime_generation: runtimeGeneration,
        }
      );
    const currentAuthorization = this.runtimeFenceConnectionAuthorization;
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
        source_provider: 'wwebjs',
        runtime_generation: runtimeGeneration,
        connection_epoch: authorization.connection_epoch,
        connection_attempt_id: authorization.connection_attempt_id,
      }
    );
    this.runtimeFenceConnectionAuthorization = authorization;
    return authorization;
  }

  async connect(input: IBaileysConnection): Promise<IBaileysConnectionState> {
    if (this.providerHandoffKey) {
      throw new Error('wwebjs_provider_handoff_runtime_fenced');
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
      runtime_generation: runtimeGeneration,
      debug_trace_id: debugTraceId,
    } = input;
    let invocationGeneration = this.connectionInvocationGeneration;
    const normalizedPhoneConnection =
      this.normalizePhoneConnection(phoneConnection);
    const effectivePhoneConnection =
      typeConnection === EBaileysConnectionType.phone
        ? (normalizedPhoneConnection ?? this.phoneConnection)
        : undefined;

    if (typeConnection === EBaileysConnectionType.phone) {
      throw new Error('Phone connection is disabled. Use QR Code.');
    }

    await this.waitForActiveDisconnect();
    if (!this.isCurrentConnectionInvocation(invocationGeneration)) {
      return this.state();
    }
    if (this.sessionLifecycleTerminationUnconfirmed) {
      return this.state(undefined, undefined, {
        status: Status.disconnected,
        code: ECodeMessage.connectionLost,
        worker_status_id: EWorkerStatus.disponible,
        reason: 'browser_termination_unconfirmed',
        error: 'wwebjs_provider_process_replacement_required',
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        provider_state: 'BROWSER_TERMINATION_UNCONFIRMED',
        degraded_reason: 'browser_termination_unconfirmed',
      });
    }
    // Consume a post-disconnect pairing grant before any profile/auth store is
    // inspected. On reconnect, recover and re-assert the exact owned epoch.
    const runtimeFenceConnectionAuthorization =
      await this.resolveConnectionRuntimeFenceAuthorization(input);
    await this.waitForSessionProfileTransition();
    if (!this.isCurrentConnectionInvocation(invocationGeneration)) {
      return this.state();
    }
    await this.recoverProviderRuntimeStopIfNeeded();
    if (!this.isCurrentConnectionInvocation(invocationGeneration)) {
      return this.state();
    }

    this.debugTraceId = debugTraceId ?? this.debugTraceId;
    this.runtimeGeneration = runtimeGeneration ?? this.runtimeGeneration;
    await this.refreshPostgresSessionState();
    this.logDebug('wwebjs.provider.connect_start', {
      trace_id: this.debugTraceId,
      layer: 'wwebjs',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.wwebjs,
      connection_attempt_id: connectionAttemptId,
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

    if (requestedByUser) {
      this.userRequestedDisconnect = false;
    }

    if (this.userRequestedDisconnect && !fromDisconnectRestart) {
      return this.state();
    }

    this.initialConnection = initialConnection;
    this.typeConnection = typeConnection;
    this.phoneConnection = effectivePhoneConnection;
    if (
      connectionAttemptId !== undefined ||
      requestedByUser ||
      runtimeFenceConnectionAuthorization?.connection_attempt_id !== undefined
    ) {
      this.connectionAttemptId =
        runtimeFenceConnectionAuthorization?.connection_attempt_id ??
        connectionAttemptId;
    }
    if (runtimeGeneration !== undefined || requestedByUser) {
      this.runtimeGeneration = runtimeGeneration;
    }
    this.trackQrReadSession(requestedByUser, typeConnection);

    if (this.connected) {
      return this.reportConnected();
    }

    const forcedRestartActiveConnection =
      forceNew && this.connecting && (requestedByUser || fromDisconnectRestart);

    if (forcedRestartActiveConnection) {
      this.cancelAttempt(false);
      invocationGeneration = this.connectionInvocationGeneration;
    }

    if (this.connecting && this.currentPromise) {
      return this.currentPromise;
    }

    if (forceNew && this.connecting && !forcedRestartActiveConnection) {
      return this.currentPromise ?? this.state();
    }

    if (forceNew && !this.connecting && !forcedRestartActiveConnection) {
      this.cancelAttempt(false);
      invocationGeneration = this.connectionInvocationGeneration;
    }

    if (
      requestedByUser &&
      this.typeConnection === EBaileysConnectionType.qrcode &&
      !this.hasSession()
    ) {
      await this.waitForPendingTeardown();
      if (!this.isCurrentConnectionInvocation(invocationGeneration)) {
        return this.state();
      }
      const lifecycleLeaseError = this.acquireSessionLifecycleLease();
      if (lifecycleLeaseError) {
        return this.publishSessionActivationBlockedState(lifecycleLeaseError);
      }
      const activationError = this.beginRuntimeSessionActivation();
      if (activationError) {
        this.releaseSessionLifecycleLease();
        return this.publishSessionActivationBlockedState(activationError);
      }
      if (!this.prepareInvalidSessionForExplicitQr()) {
        this.releaseSessionLifecycleLease();
        return this.publishQrRequiredState(
          'session_quarantine_failed_before_qr'
        );
      }
    }

    if (
      !requestedByUser &&
      allowRestore &&
      (this.status === Status.initial || this.status === Status.disconnected)
    ) {
      const inspection = this.inspectCurrentLocalSession();
      if (inspection.exists && !inspection.restorable) {
        await this.waitForPendingTeardown();
        if (!this.isCurrentConnectionInvocation(invocationGeneration)) {
          return this.state();
        }
        const lifecycleLeaseError = this.acquireSessionLifecycleLease();
        if (lifecycleLeaseError) {
          return this.publishSessionActivationBlockedState(lifecycleLeaseError);
        }
        const activationError = this.beginRuntimeSessionActivation();
        if (activationError) {
          this.releaseSessionLifecycleLease();
          return this.publishSessionActivationBlockedState(activationError);
        }
        const quarantine = this.quarantineCurrentSession(
          `automatic_restore_${inspection.blockedReason ?? 'blocked_session'}`
        );
        this.releaseSessionLifecycleLease();
        return this.publishQrRequiredState(
          quarantine.moved
            ? 'automatic_restore_session_quarantined'
            : 'automatic_restore_session_quarantine_incomplete',
          quarantine.error
        );
      }
    }

    if (
      (this.status === Status.initial || this.status === Status.disconnected) &&
      allowRestore &&
      this.hasSession()
    ) {
      if (!this.isCurrentConnectionInvocation(invocationGeneration)) {
        return this.state();
      }
      return this.startConnection(
        fromDisconnectRestart,
        runtimeFenceConnectionAuthorization
      );
    }

    if (
      this.typeConnection === EBaileysConnectionType.qrcode &&
      !requestedByUser &&
      (this.qrReadSessionLocked ||
        (!this.qrReadSessionActive && !this.hasSession()))
    ) {
      return this.state();
    }

    if (!this.isCurrentConnectionInvocation(invocationGeneration)) {
      return this.state();
    }
    return this.startConnection(
      fromDisconnectRestart,
      runtimeFenceConnectionAuthorization
    );
  }

  disconnect(input: IBaileysConnection): Promise<void> {
    const shouldRemoveSession =
      input.remove_session === true || input.preserve_session === false;
    const clientToDestroy =
      this.fenceConnectionForQueuedLifecycleStop(!shouldRemoveSession);
    if (this.disconnectPromise) {
      const previousDisconnect = this.disconnectPromise;
      let queuedDisconnect: Promise<void>;
      queuedDisconnect = previousDisconnect
        .catch(() => undefined)
        .then(() =>
          this.runExclusiveSessionProfileTransition('disconnect', () =>
            this.performDisconnect(input, clientToDestroy)
          )
        )
        .finally(() => {
          if (this.disconnectPromise === queuedDisconnect) {
            this.disconnectPromise = undefined;
          }
        });
      this.disconnectPromise = queuedDisconnect;
      return queuedDisconnect;
    }

    let disconnectPromise: Promise<void>;
    disconnectPromise = this.runExclusiveSessionProfileTransition(
      'disconnect',
      () => this.performDisconnect(input, clientToDestroy)
    ).finally(() => {
      if (this.disconnectPromise === disconnectPromise) {
        this.disconnectPromise = undefined;
      }
    });
    this.disconnectPromise = disconnectPromise;
    return disconnectPromise;
  }

  private async performDisconnect(
    input: IBaileysConnection,
    clientToDestroy?: Client
  ): Promise<void> {
    this.invalidatePendingConnectionInvocations();
    const {
      initial_connection: initialConnection = false,
      disconnected_user: disconnectedUser = false,
      preserve_session: preserveSession = true,
      remove_session: removeSession = false,
      runtime_generation: runtimeGeneration,
      debug_trace_id: debugTraceId,
    } = input;
    this.debugTraceId = debugTraceId ?? this.debugTraceId;
    this.runtimeGeneration = runtimeGeneration ?? this.runtimeGeneration;
    const shouldRemoveSession = removeSession || !preserveSession;
    const pendingProviderRuntimeTransition = this.providerRuntimeTransitionTail;

    this.initialConnection = initialConnection;
    this.connectionEstablished = false;
    this.invalidateClientConnectionAttempt(clientToDestroy);
    const providerRuntimeStop = this.stopProviderRuntimeAndWait('disconnect');
    this.healthCheckService.stop();
    this.clearDisconnectRetryTimer();
    this.cancelTransientDisconnectStatus();
    this.clearConnectionStateProbe();
    if (disconnectedUser) {
      this.userRequestedDisconnect = true;
    }
    this.retryCount = 0;
    this.resetQrReadSession();
    this.qrReadSessionLocked = false;

    if (disconnectedUser || shouldRemoveSession) {
      this.publishLogoutInProgress(true);
    }

    const [, providerRuntimeStopResult] = await Promise.allSettled([
      pendingProviderRuntimeTransition,
      providerRuntimeStop,
    ]);
    const providerRuntimeStopError =
      providerRuntimeStopResult.status === 'rejected'
        ? providerRuntimeStopResult.reason
        : undefined;

    try {
      await this.healthCheckService.notifyDisconnected(
        disconnectedUser ? 'User requested disconnect' : 'Connection closed'
      );
    } catch (error) {
      console.error(
        '[WwebjsConnection] Failed to publish disconnected health state',
        error
      );
    }

    await this.flushNativeConnectionStatusPersistence(
      'disconnect_before_browser_termination'
    );

    const runtimeTerminated =
      await this.terminateBrowserRuntimesBeforeProfileMutation(
        'disconnect',
        clientToDestroy,
        shouldRemoveSession,
        true
      );
    if (!runtimeTerminated) {
      throw new Error('wwebjs_browser_termination_unconfirmed');
    }
    try {
      if (shouldRemoveSession) {
        await this.purgePostgresSession();
        this.clearFolder(true);
        this.purgeCurrentSessionQuarantine(true);
      }
    } finally {
      this.releaseSessionLifecycleLease();
    }

    this.saveLogWppConnection({
      worker_id: getWorker(),
      status: this.status,
      code: this.code?.toString(),
      message: 'WwebjsConnectionService disconnected',
      date: new Date(),
    });

    this.setStatus(Status.disconnected, ECodeMessage.connectionClosed, true);

    const payload: IBaileysConnectionState = {
      status: this.status,
      worker_id: getWorker(),
      account_id: getAccount(),
      code: this.code,
      disconnected_user: disconnectedUser,
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: this.connectionAttemptId,
      runtime_generation: this.runtimeGeneration,
      debug_trace_id: this.debugTraceId,
    };

    // Explicit session removal is finalized durably by the manager. A second
    // provider-side terminal event can arrive after that tombstone and be
    // rejected as stale even though the profile and lease were cleared.
    if (!shouldRemoveSession) {
      this.publishSub(payload, true);
      await this.notifyWorkerStatusSafely(payload, 'disconnect');
    }

    if (providerRuntimeStopError) {
      throw providerRuntimeStopError;
    }

    const shouldReconnect =
      this.initialConnection && !disconnectedUser && !shouldRemoveSession;

    if (shouldReconnect) {
      this.scheduleNextReconnectAttempt();
    }
  }

  async importSecureSession(
    input: ISecureConnectionImportRequest
  ): Promise<IBaileysConnectionState> {
    return this.runExclusiveSessionProfileTransition('secure_import', () =>
      this.performSecureSessionImport(input)
    );
  }

  private async performSecureSessionImport(
    input: ISecureConnectionImportRequest
  ): Promise<IBaileysConnectionState> {
    this.debugTraceId = input.debug_trace_id ?? this.debugTraceId;
    this.connectionAttemptId =
      input.connection_attempt_id ?? this.connectionAttemptId;
    this.runtimeGeneration = input.runtime_generation ?? this.runtimeGeneration;

    this.logDebug('wwebjs.provider.secure_session_import.received', {
      trace_id: input.debug_trace_id,
      layer: 'wwebjs',
      worker_id: input.worker_id || getWorker(),
      account_id: input.account_id || getAccount(),
      worker_type_id: EWorkerType.wwebjs,
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
        this.summarizeWwebjsSecureSessionPayload(sessionPackage);

      this.logDebug('wwebjs.provider.secure_session_import.payload_resolved', {
        trace_id: input.debug_trace_id,
        layer: 'wwebjs',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.wwebjs,
        connection_attempt_id: input.connection_attempt_id,
        runtime_generation: input.runtime_generation,
        format_version: sessionPackage.format_version,
        target_provider: sessionPackage.target_provider,
        ...payloadSummary,
      });

      const { importer, source } =
        this.resolveWwebjsSecureSessionImporter(sessionPackage);

      this.healthCheckService.stop();
      this.cancelAttempt(false);
      this.resetQrReadSession();
      this.qrReadSessionLocked = false;
      const runtimeTerminated =
        await this.terminateBrowserRuntimesBeforeProfileMutation(
          'secure_import'
        );
      if (!runtimeTerminated) {
        throw new Error('wwebjs_browser_termination_unconfirmed');
      }
      const lifecycleLeaseError = this.acquireSessionLifecycleLease();
      if (lifecycleLeaseError) {
        throw new Error(lifecycleLeaseError);
      }
      this.clearChromiumProfileLock();
      this.prepareFolder();
      const activationError = this.beginRuntimeSessionActivation();
      if (activationError) {
        throw new Error(activationError);
      }

      const result = await importer({
        sessionPackage: sessionPackage as Parameters<
          typeof importer
        >[0]['sessionPackage'],
        clientId: getWorker(),
        dataPath: path.join(getFolder(), '.wwebjs_auth'),
        overwrite: true,
        cleanupBackupOnSuccess: false,
      });

      await this.stagePostgresSecureImportCandidate(result);
      this.markSecureImportSessionCandidate();
      this.logDebug('wwebjs.provider.secure_session_import.files_imported', {
        trace_id: input.debug_trace_id,
        layer: 'wwebjs',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.wwebjs,
        connection_attempt_id: input.connection_attempt_id,
        runtime_generation: input.runtime_generation,
        import_source: source,
        imported_file_count: result.importedFiles?.length ?? 0,
        backup_created: Boolean(result.backupPath),
        format_version: result.formatVersion,
        account_hint_present: Boolean(result.accountHint),
      });

      return this.startSecureImportRestore(input);
    } catch (error) {
      await this.safelyFailPostgresSecureImportCandidate();
      this.releaseSessionLifecycleLease();
      return this.failSecureSessionImport(input, error);
    }
  }

  private startSecureImportRestore(
    input: ISecureConnectionImportRequest
  ): IBaileysConnectionState {
    this.setStatus(Status.connecting, ECodeMessage.awaitConnection);
    this.connectionEstablished = false;
    const secureImportAttemptToken = randomUUID();
    const secureImportLifecycleLease = this.sessionLifecycleLease;
    this.secureImportConnectionAttemptActive = true;
    this.secureImportConnectionAttemptToken = secureImportAttemptToken;

    const restorePromise = this.connect({
      initial_connection: true,
      allow_restore: true,
      force_new: true,
      requested_by_user: false,
      type: EBaileysConnectionType.qrcode,
      connection_attempt_id: input.connection_attempt_id,
      runtime_generation: input.runtime_generation,
      debug_trace_id: input.debug_trace_id,
    });

    void restorePromise
      .then(async (state) => {
        this.logDebug('wwebjs.provider.secure_session_import.restore_done', {
          trace_id: input.debug_trace_id,
          layer: 'wwebjs',
          worker_id: getWorker(),
          account_id: getAccount(),
          worker_type_id: EWorkerType.wwebjs,
          connection_attempt_id: input.connection_attempt_id,
          runtime_generation: input.runtime_generation,
          status: state.status,
          code: state.code,
          session_ready: state.session_ready,
          can_send: state.can_send,
          can_receive_runtime: state.can_receive_runtime,
          authenticated: state.authenticated,
          provider_state: state.provider_state,
          degraded_reason: state.degraded_reason,
          reason: state.reason,
          error: state.error,
        });
        if (state.session_ready !== true) {
          await this.safelyFailPostgresSecureImportCandidate();
        }
        if (!this.client) {
          this.releaseSessionLifecycleLeaseIfCurrent(
            secureImportLifecycleLease
          );
        }
      })
      .catch(async (error) => {
        if (!this.client) {
          this.releaseSessionLifecycleLeaseIfCurrent(
            secureImportLifecycleLease
          );
        }
        if (
          input.connection_attempt_id &&
          input.connection_attempt_id !== this.connectionAttemptId
        ) {
          this.logDebug(
            'wwebjs.provider.secure_session_import.restore_stale_error',
            {
              trace_id: input.debug_trace_id,
              layer: 'wwebjs',
              worker_id: getWorker(),
              account_id: getAccount(),
              worker_type_id: EWorkerType.wwebjs,
              connection_attempt_id: input.connection_attempt_id,
              current_connection_attempt_id: this.connectionAttemptId,
              runtime_generation: input.runtime_generation,
              reason: getErrorMessage(error),
            }
          );
          return;
        }

        await this.safelyFailPostgresSecureImportCandidate();
        this.failSecureSessionImport(input, error);
      })
      .finally(() => {
        if (
          this.secureImportConnectionAttemptToken === secureImportAttemptToken
        ) {
          this.secureImportConnectionAttemptActive = false;
          this.secureImportConnectionAttemptToken = undefined;
        }
      });

    const payload = this.state(undefined, undefined, {
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: input.connection_attempt_id,
      runtime_generation: input.runtime_generation,
      debug_trace_id: input.debug_trace_id,
      reason: 'secure_import_restore_started',
      session_ready: false,
      authenticated: false,
      can_send: false,
      can_receive_runtime: false,
      provider_state: 'secure_import_restore_starting',
      degraded_reason: 'secure_import_restore_starting',
    });

    this.logDebug('wwebjs.provider.secure_session_import.restore_started', {
      trace_id: input.debug_trace_id,
      layer: 'wwebjs',
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      worker_type_id: payload.worker_type_id,
      connection_attempt_id: input.connection_attempt_id,
      runtime_generation: input.runtime_generation,
      status: payload.status,
      code: payload.code,
      reason: payload.reason,
    });

    return payload;
  }

  private async stagePostgresSecureImportCandidate(
    result: WwebjsSecureSessionImportResult
  ): Promise<void> {
    if (!usesPostgresSessionStorage()) {
      return;
    }

    const importedProfilePath = result.sessionPath;
    if (!importedProfilePath || !fs.existsSync(importedProfilePath)) {
      throw new Error('wwebjs_import_empty_profile');
    }

    try {
      const store = this.getPostgresSessionStore();
      if (result.browserProjection && result.canonicalProjection) {
        await store.stageExternalCanonicalProjection({
          session: this.getRemoteSessionName(),
          browserProjection: result.browserProjection,
          canonicalProjection: result.canonicalProjection,
          profilePath: importedProfilePath,
        });
      } else if (result.browserProjection) {
        await store.stageExternalBrowserProjection({
          session: this.getRemoteSessionName(),
          projection: result.browserProjection,
          profilePath: importedProfilePath,
        });
      } else {
        await store.stageCandidate({
          session: this.getRemoteSessionName(),
          profilePath: importedProfilePath,
        });
      }
      this.postgresSessionKnown = true;
    } finally {
      fs.rmSync(importedProfilePath, { recursive: true, force: true });
    }
  }

  private async failPostgresSecureImportCandidate(
    errorCode = 'secure_import_validation_failed'
  ): Promise<void> {
    if (!usesPostgresSessionStorage() || !this.postgresSessionStore) {
      return;
    }

    await this.postgresSessionStore.failCandidate(errorCode);
    await this.refreshPostgresSessionState();
  }

  private async safelyFailPostgresSecureImportCandidate(
    errorCode = 'secure_import_validation_failed'
  ): Promise<void> {
    try {
      await this.failPostgresSecureImportCandidate(errorCode);
    } catch (error) {
      this.logDebug('wwebjs.provider.secure_session_import.cleanup_failed', {
        trace_id: this.debugTraceId,
        layer: 'wwebjs',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.wwebjs,
        connection_attempt_id: this.connectionAttemptId,
        runtime_generation: this.runtimeGeneration,
        cleanup_error_name:
          error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  private isPostgresRestorePairingForbidden(
    secureImportRestore: boolean
  ): boolean {
    if (!usesPostgresSessionStorage()) {
      return false;
    }

    return (
      secureImportRestore ||
      this.postgresSessionKnown ||
      this.postgresSessionStore?.revisionStatus === 'active' ||
      this.postgresSessionStore?.hasPendingHandoff() === true
    );
  }

  private isActivePostgresSessionRevision(): boolean {
    return (
      usesPostgresSessionStorage() &&
      this.postgresSessionStore?.revisionStatus === 'active'
    );
  }

  /**
   * Once the offline handoff CAS has promoted WWebJS, protocol work may have
   * changed server-side ratchets or PQ state. That boundary is irreversible:
   * an authentication/pairing failure must restart the active WWebJS artifact
   * and must never quarantine it, request a QR, or reactivate the retired
   * Baileys/WhatsMeow revision.
   */
  private recoverActivePostgresSessionRevision(
    client: Client,
    attemptId: number,
    errorCode: string
  ): IBaileysConnectionState | undefined {
    if (
      !this.isActiveClientConnectionAttempt(client, attemptId) ||
      !this.isActivePostgresSessionRevision()
    ) {
      return undefined;
    }

    this.invalidateClientConnectionAttempt(client);
    this.stopProviderRuntime('active postgres session recovery');
    this.connectionEstablished = false;
    this.connecting = false;
    this.activeConnectionAttemptId = undefined;
    this.currentPromise = undefined;
    this.postgresSessionKnown = true;
    this.sessionRestoreBlocked = false;
    this.clearConnectionStateProbe();
    this.cancelKafkaReadinessRetry();
    this.healthCheckService.stop();
    this.setStatus(Status.connecting, ECodeMessage.awaitConnection);

    const payload: IBaileysConnectionState = {
      status: this.status,
      worker_id: getWorker(),
      account_id: getAccount(),
      code: this.code,
      phone: this.getClientPhone(client),
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: this.connectionAttemptId,
      debug_trace_id: this.debugTraceId,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      provider_state: 'postgres_active_revision_restarting',
      degraded_reason: errorCode,
    };
    this.publishSub(payload, true);
    void this.notifyWorkerStatusSafely(
      payload,
      'postgres_active_revision_restarting'
    );
    this.resolvePendingState(payload);
    this.incomingMessageService.markConnectionUnavailable(client);
    this.incomingMessageService.unbind();

    this.queueTeardown(errorCode, async () => {
      const terminated = await this.destroyClientWithTimeout(client, errorCode);
      if (!terminated) {
        return false;
      }
      if (this.client === client) {
        this.client = undefined;
      }
      this.clearChromiumProfileLock();
      return true;
    });
    void this.waitForPendingTeardown().then(() => {
      if (!this.sessionLifecycleTerminationUnconfirmed) {
        this.postgresSessionKnown = true;
        this.sessionRestoreBlocked = false;
        this.scheduleNextReconnectAttempt(false);
      }
    });
    return payload;
  }

  private async rejectUnexpectedPostgresRestorePairing(
    client: Client,
    attemptId: number,
    event: 'code' | 'qr'
  ): Promise<void> {
    if (
      !this.isActiveClientConnectionAttempt(client, attemptId) ||
      this.clientsWithRejectedRestorePairing.has(client)
    ) {
      return;
    }
    this.clientsWithRejectedRestorePairing.add(client);

    const errorCode = `wwebjs_restore_unexpected_${event}`;
    this.logDebug('wwebjs.provider.postgres_restore.pairing_rejected', {
      trace_id: this.debugTraceId,
      layer: 'wwebjs',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.wwebjs,
      connection_attempt_id: this.connectionAttemptId,
      runtime_generation: this.runtimeGeneration,
      revision_id: this.postgresSessionStore?.revisionId,
      revision_status: this.postgresSessionStore?.revisionStatus,
      handoff_pending: this.postgresSessionStore?.hasPendingHandoff() === true,
      pairing_event: event,
      error_code: errorCode,
    });

    if (this.isActivePostgresSessionRevision()) {
      this.recoverActivePostgresSessionRevision(client, attemptId, errorCode);
      return;
    }

    this.clearConnectionStateProbe();
    this.cancelKafkaReadinessRetry();
    this.invalidateClientConnectionAttempt(client);
    this.connectionEstablished = false;
    this.setStatus(Status.disconnected, ECodeMessage.badSession);

    try {
      await this.failPostgresSecureImportCandidate(errorCode);
    } catch (error) {
      this.logDebug('wwebjs.provider.postgres_restore.rollback_failed', {
        trace_id: this.debugTraceId,
        layer: 'wwebjs',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.wwebjs,
        connection_attempt_id: this.connectionAttemptId,
        pairing_event: event,
        error_code: errorCode,
        reason: getErrorMessage(error),
      });
    }

    const payload = this.state(undefined, undefined, {
      worker_status_id: EWorkerStatus.mismatched,
      reason: errorCode,
      error: errorCode,
      session_ready: false,
      authenticated: false,
      can_send: false,
      can_receive_runtime: false,
      provider_state: 'postgres_restore_pairing_rejected',
      degraded_reason: errorCode,
    });
    this.publishSub(payload, true);
    void this.notifyWorkerStatusSafely(payload, errorCode);
    this.resolvePendingState(payload);
    this.incomingMessageService.markConnectionUnavailable(client);
    this.incomingMessageService.unbind();
    this.healthCheckService.stop();

    this.queueTeardown(errorCode, async () => {
      const terminated = await this.destroyClientWithTimeout(client, errorCode);
      if (!terminated) {
        return false;
      }
      if (this.client === client) {
        this.client = undefined;
      }
      this.clearChromiumProfileLock();
      return true;
    });
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
      input.target_provider !== 'wwebjs'
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
      sessionPackage.target_provider !== 'wwebjs'
    ) {
      throw new Error('secure_session_target_provider_mismatch');
    }

    return sessionPackage;
  }

  private resolveWwebjsSecureSessionImporter(
    sessionPackage: ISecureConnectionSessionPackage
  ): { importer: WwebjsSecureSessionImporter; source: string } {
    const payload = this.getSecureSessionPayloadRecord(sessionPackage);
    const whatsappWebProfile =
      payload.whatsapp_web_profile &&
      typeof payload.whatsapp_web_profile === 'object' &&
      !Array.isArray(payload.whatsapp_web_profile)
        ? (payload.whatsapp_web_profile as Record<string, unknown>)
        : undefined;
    const canonicalProjection =
      payload.wwebjs_canonical_projection &&
      typeof payload.wwebjs_canonical_projection === 'object' &&
      !Array.isArray(payload.wwebjs_canonical_projection)
        ? (payload.wwebjs_canonical_projection as WwebjsCanonicalBrowserProjection)
        : undefined;
    const localAuth =
      payload.wwebjs_local_auth &&
      typeof payload.wwebjs_local_auth === 'object' &&
      !Array.isArray(payload.wwebjs_local_auth)
        ? (payload.wwebjs_local_auth as Record<string, unknown>)
        : undefined;
    const localAuthFiles =
      localAuth?.files &&
      typeof localAuth.files === 'object' &&
      !Array.isArray(localAuth.files)
        ? (localAuth.files as Record<string, unknown>)
        : undefined;
    const importApi = whatsappWeb.SecureSessionImport as
      Record<string, unknown> | undefined;

    if (localAuthFiles && Object.keys(localAuthFiles).length > 0) {
      const importer = importApi?.importWhatsAppWebSessionToLocalAuth;
      if (typeof importer !== 'function') {
        throw new Error('wwebjs_secure_session_importer_unavailable');
      }
      if (whatsappWebProfile && usesPostgresSessionStorage()) {
        const converter = importApi?.browserProjectionFromWhatsAppWebProfile;
        if (typeof converter !== 'function') {
          throw new Error('wwebjs_secure_session_importer_unavailable');
        }
        return {
          importer: async (input) => {
            // Validate the portable projections before mutating the target
            // profile. The physical LocalAuth tree remains the lossless
            // Chromium restore source; both projections must travel with it
            // so PostgreSQL uses the fenced external-import candidate path.
            const browserProjection = (
              converter as (
                value: ISecureConnectionSessionPackage
              ) => WwebjsBrowserProjection
            )(input.sessionPackage);
            const normalizedCanonicalProjection = canonicalProjection
              ? normalizeCanonicalProjection(canonicalProjection)
              : undefined;
            const imported = await (importer as WwebjsSecureSessionImporter)(
              input
            );
            return {
              ...imported,
              browserProjection,
              canonicalProjection: normalizedCanonicalProjection,
            };
          },
          source: 'wwebjs_local_auth+whatsapp_web_profile',
        };
      }
      return {
        importer: importer as WwebjsSecureSessionImporter,
        source: 'wwebjs_local_auth',
      };
    }

    if (whatsappWebProfile) {
      if (!usesPostgresSessionStorage()) {
        throw new Error(
          'wwebjs_secure_import_browser_projection_requires_postgres'
        );
      }
      const converter = importApi?.browserProjectionFromWhatsAppWebProfile;
      if (typeof converter !== 'function') {
        throw new Error('wwebjs_secure_session_importer_unavailable');
      }
      return {
        importer: async ({ dataPath, sessionPackage: packageToImport }) => {
          const projection = (
            converter as (
              value: ISecureConnectionSessionPackage
            ) => WwebjsBrowserProjection
          )(packageToImport);
          const normalizedCanonicalProjection = canonicalProjection
            ? normalizeCanonicalProjection(canonicalProjection)
            : undefined;
          if (!dataPath) {
            throw new Error('wwebjs_secure_import_data_path_missing');
          }
          fs.mkdirSync(dataPath, { recursive: true });
          const sessionPath = fs.mkdtempSync(
            path.join(dataPath, '.underchat-extension-import-')
          );
          return {
            browserProjection: projection,
            canonicalProjection: normalizedCanonicalProjection,
            formatVersion: packageToImport.format_version,
            importedFiles: [],
            sessionPath,
          };
        },
        source: 'whatsapp_web_profile',
      };
    }

    throw new Error('wwebjs_import_payload_unsupported');
  }

  private getSecureSessionPayloadRecord(
    sessionPackage: ISecureConnectionSessionPackage
  ): Record<string, unknown> {
    return sessionPackage.payload &&
      typeof sessionPackage.payload === 'object' &&
      !Array.isArray(sessionPackage.payload)
      ? (sessionPackage.payload as Record<string, unknown>)
      : {};
  }

  private summarizeWwebjsSecureSessionPayload(
    sessionPackage: ISecureConnectionSessionPackage
  ): Record<string, unknown> {
    const payload = this.getSecureSessionPayloadRecord(sessionPackage);
    const localAuth =
      payload.wwebjs_local_auth &&
      typeof payload.wwebjs_local_auth === 'object' &&
      !Array.isArray(payload.wwebjs_local_auth)
        ? (payload.wwebjs_local_auth as Record<string, unknown>)
        : undefined;
    const files =
      localAuth?.files &&
      typeof localAuth.files === 'object' &&
      !Array.isArray(localAuth.files)
        ? (localAuth.files as Record<string, unknown>)
        : undefined;
    const profile =
      payload.whatsapp_web_profile &&
      typeof payload.whatsapp_web_profile === 'object' &&
      !Array.isArray(payload.whatsapp_web_profile)
        ? (payload.whatsapp_web_profile as Record<string, unknown>)
        : undefined;
    const signalStorage =
      profile?.signalStorage &&
      typeof profile.signalStorage === 'object' &&
      !Array.isArray(profile.signalStorage)
        ? (profile.signalStorage as Record<string, unknown>)
        : undefined;
    const signalStores = Array.isArray(signalStorage?.stores)
      ? signalStorage.stores
      : [];

    return {
      has_wwebjs_local_auth: Boolean(localAuth),
      profile_file_count: files ? Object.keys(files).length : 0,
      has_default_cookies: Boolean(files?.['Default/Cookies']),
      has_default_indexeddb: Object.keys(files ?? {}).some((file) =>
        file.startsWith('Default/IndexedDB/')
      ),
      has_whatsapp_web_creds: Boolean(payload.whatsapp_web_creds),
      has_whatsapp_web_profile: Boolean(profile),
      has_wwebjs_canonical_projection: Boolean(
        payload.wwebjs_canonical_projection
      ),
      whatsapp_web_profile_signal_store_count: signalStores.length,
      has_baileys_multi_file_auth_state: Boolean(
        payload.baileys_multi_file_auth_state
      ),
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

    this.logDebug('wwebjs.provider.secure_session_import.failed', {
      trace_id: input.debug_trace_id,
      layer: 'wwebjs',
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
      rawMessage === 'wwebjs_import_payload_unsupported' ||
      rawMessage === 'wwebjs_import_payload_missing' ||
      rawMessage === 'wwebjs_import_empty_profile'
    ) {
      return 'WWebJS secure import requires payload.wwebjs_local_auth.files or a lossless payload.whatsapp_web_profile.';
    }
    if (
      rawMessage === 'wwebjs_secure_import_browser_projection_requires_postgres'
    ) {
      return 'WWebJS Chrome extension import requires PostgreSQL session storage.';
    }

    return rawMessage;
  }

  reconnect(input: IBaileysConnection): void {
    if (this.providerHandoffKey) {
      return;
    }
    const { initial_connection: initialConnection = true } = input;
    this.initialConnection = initialConnection;
    this.debugTraceId = input.debug_trace_id ?? this.debugTraceId;
    this.runtimeGeneration = input.runtime_generation ?? this.runtimeGeneration;

    if (
      initialConnection &&
      this.hasSession() &&
      !input.authorized_connection_epoch &&
      !this.userRequestedDisconnect &&
      this.initialConnection
    ) {
      this.scheduleNextReconnectAttempt();
      return;
    }

    this.connect({
      initial_connection: initialConnection,
      requested_by_user: Boolean(input.authorized_connection_epoch),
      type: EBaileysConnectionType.qrcode,
      connection_attempt_id:
        input.connection_attempt_id ?? this.connectionAttemptId,
      authorized_connection_epoch: input.authorized_connection_epoch,
      runtime_generation: this.runtimeGeneration,
      debug_trace_id: input.debug_trace_id ?? this.debugTraceId,
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
    const clientToDestroy = this.fenceConnectionForQueuedLifecycleStop();
    return this.runExclusiveSessionProfileTransition('shutdown', () =>
      this.performShutdown(clientToDestroy)
    );
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
      input.provider !== 'wwebjs' ||
      input.runtime_generation !== wwebjsEnvironment.runtimeGeneration ||
      input.runtime_capability !== process.env.WORKER_RUNTIME_CAPABILITY
    ) {
      throw new Error('wwebjs_session_storage_migration_context_invalid');
    }

    if (
      this.sessionStorageMigrationId &&
      this.sessionStorageMigrationId !== input.migration_id
    ) {
      throw new Error('wwebjs_session_storage_migration_already_owned');
    }
    if (this.sessionStorageMigrationResult) {
      return { ...this.sessionStorageMigrationResult };
    }

    const phone =
      this.sessionStorageMigrationPhone ??
      (this.client ? (this.getClientPhone(this.client) ?? '') : '');
    const normalizedExpected = (input.expected_phone ?? '').replace(/\D/gu, '');
    const normalizedPhone = phone.replace(/\D/gu, '');
    if (normalizedExpected && normalizedExpected !== normalizedPhone) {
      throw new Error('wwebjs_session_storage_migration_phone_mismatch');
    }
    if (!normalizedPhone) {
      throw new Error('wwebjs_session_storage_migration_identity_missing');
    }
    this.sessionStorageMigrationId = input.migration_id;
    this.sessionStorageMigrationPhone = phone;

    await this.shutdown();
    const checkpoint = await retryLegacySessionVolumeSnapshot(async () => {
      const profile = await fs.promises.stat(this.getSessionPath());
      if (!profile.isDirectory()) {
        throw new Error('wwebjs_legacy_session_profile_invalid');
      }
      return snapshotLegacySessionVolume();
    });
    const result: IPrepareSessionStorageMigrationResponseProto = {
      worker_id: input.worker_id,
      provider: 'wwebjs',
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

  prepareProviderHandoff(
    input: IPrepareProviderHandoffRequestProto
  ): Promise<IPrepareProviderHandoffResponseProto> {
    const key = `${input.handoff_id}:${input.lifecycle_operation_id}`;
    if (this.providerHandoffKey && this.providerHandoffKey !== key) {
      return Promise.reject(
        new Error('wwebjs_provider_handoff_already_in_progress')
      );
    }
    if (this.providerHandoffResult) {
      return Promise.resolve({ ...this.providerHandoffResult });
    }
    if (this.providerHandoffFlight) {
      return this.providerHandoffFlight;
    }

    this.providerHandoffKey = key;
    this.userRequestedDisconnect = true;
    this.initialConnection = false;
    this.setCentralOnlineAcknowledged(false);
    setWorkerKafkaDispatchAuthorized(false);
    this.providerHandoffClient ??=
      this.fenceConnectionForQueuedLifecycleStop(false);
    const flight = this.runExclusiveSessionProfileTransition(
      'provider_handoff',
      () => this.performPrepareProviderHandoff(input)
    ).finally(() => {
      if (this.providerHandoffFlight === flight) {
        this.providerHandoffFlight = undefined;
      }
    });
    this.providerHandoffFlight = flight;
    return flight;
  }

  private async performPrepareProviderHandoff(
    input: IPrepareProviderHandoffRequestProto
  ): Promise<IPrepareProviderHandoffResponseProto> {
    if (
      !usesPostgresSessionStorage() ||
      input.worker_id !== getWorker() ||
      input.account_id !== getAccount() ||
      input.source_provider !== 'wwebjs' ||
      input.target_provider === 'wwebjs' ||
      !['baileys', 'whatsmeow'].includes(input.target_provider) ||
      input.runtime_generation !== wwebjsEnvironment.runtimeGeneration
    ) {
      throw new Error('wwebjs_provider_handoff_context_invalid');
    }
    const sourceRevisionId = Number(input.source_revision_id);
    if (!Number.isSafeInteger(sourceRevisionId) || sourceRevisionId <= 0) {
      throw new Error('wwebjs_provider_handoff_source_revision_invalid');
    }
    const client = this.providerHandoffClient;
    const authStrategy = (
      client as unknown as {
        authStrategy?: {
          prepareHandoff?: (
            targetProvider: 'baileys' | 'whatsmeow',
            expected: {
              handoffId: string;
              lifecycleOperationId: string;
              sourceRevisionId: string;
            }
          ) => Promise<Record<string, unknown>>;
        };
      }
    )?.authStrategy;
    const nativePrepareHandoff =
      authStrategy?.prepareHandoff?.bind(authStrategy);
    if (client && !nativePrepareHandoff) {
      throw new Error('wwebjs_native_prepare_handoff_api_unavailable');
    }

    this.debugTraceId = input.debug_trace_id ?? this.debugTraceId;
    this.runtimeGeneration = input.runtime_generation;
    this.healthCheckService.stop();
    this.clearDisconnectRetryTimer();
    this.cancelTransientDisconnectStatus();
    this.clearConnectionStateProbe();
    this.cancelKafkaReadinessRetry();
    this.incomingMessageService.unbind();
    this.logDebug('wwebjs.provider_handoff.drain_started', {
      trace_id: input.debug_trace_id,
      layer: 'wwebjs',
      worker_id: input.worker_id,
      account_id: input.account_id,
      worker_type_id: EWorkerType.wwebjs,
      runtime_generation: input.runtime_generation,
      handoff_id: input.handoff_id,
      lifecycle_operation_id: input.lifecycle_operation_id,
      source_revision_id: input.source_revision_id,
      target_provider: input.target_provider,
    });

    await this.providerRuntimeTransitionTail.catch(() => undefined);
    await this.stopProviderRuntimeAndWait('provider_handoff');
    let handoff: Record<string, unknown>;
    if (client) {
      if (!nativePrepareHandoff) {
        throw new Error('wwebjs_native_prepare_handoff_api_unavailable');
      }
      await this.providerLifecycleInvocationFence.fenceAndWaitForIdle(
        client,
        WWEBJS_CLIENT_DESTROY_TIMEOUT_MS
      );
      handoff = await nativePrepareHandoff(
        input.target_provider as 'baileys' | 'whatsmeow',
        {
          handoffId: input.handoff_id,
          lifecycleOperationId: input.lifecycle_operation_id,
          sourceRevisionId: input.source_revision_id,
        }
      );
    } else {
      const store = this.getPostgresSessionStore();
      try {
        const descriptor = await store.open();
        if (
          descriptor.revision_id !== input.source_revision_id ||
          !['staging', 'validating'].includes(descriptor.revision_status ?? '')
        ) {
          throw new Error('wwebjs_clientless_handoff_source_not_preparing');
        }
        const before = await store.exportProjection();
        const records = before.provider_projection?.records ?? [];
        const indexedDbStores =
          before.provider_projection?.indexeddb_stores ?? [];
        if (
          before.identity ||
          before.artifact ||
          !Array.isArray(records) ||
          records.length !== 0 ||
          !Array.isArray(indexedDbStores) ||
          indexedDbStores.length !== 0
        ) {
          throw new Error('wwebjs_clientless_handoff_source_not_empty');
        }
        handoff = await store.prepareHandoff(
          input.target_provider as 'baileys' | 'whatsmeow',
          {
            handoffId: input.handoff_id,
            lifecycleOperationId: input.lifecycle_operation_id,
            sourceRevisionId: input.source_revision_id,
          }
        );
        const leaseReleased = await store.close({
          requireLeaseRelease: true,
        });
        handoff = { ...handoff, leaseReleased };
      } catch (error) {
        await store.close().catch(() => undefined);
        throw error;
      }
    }
    if (
      String(handoff.handoffId ?? '') !== input.handoff_id ||
      String(handoff.lifecycleOperationId ?? '') !==
        input.lifecycle_operation_id ||
      String(handoff.sourceRevisionId ?? '') !== input.source_revision_id ||
      handoff.leaseReleased !== true
    ) {
      throw new Error('wwebjs_provider_handoff_native_proof_invalid');
    }

    const { checksum, sizeBytes, recordCount } =
      resolveWwebjsProviderHandoffCheckpointProof(handoff);

    const runtimeTerminated = client
      ? await this.terminateBrowserRuntimesBeforeProfileMutation(
          'provider_handoff',
          client,
          false,
          true
        )
      : true;
    if (!runtimeTerminated) {
      throw new Error(
        'wwebjs_provider_handoff_browser_termination_unconfirmed'
      );
    }
    this.providerHandoffClient = undefined;
    this.connectionEstablished = false;
    this.connecting = false;
    this.setStatus(Status.disconnected, ECodeMessage.connectionClosed, true);
    this.releaseSessionLifecycleLease();

    const result: IPrepareProviderHandoffResponseProto = {
      worker_id: input.worker_id,
      provider: 'wwebjs',
      handoff_id: input.handoff_id,
      lifecycle_operation_id: input.lifecycle_operation_id,
      source_revision_id: input.source_revision_id,
      runtime_generation: input.runtime_generation,
      prepared: true,
      consumers_drained: true,
      writes_paused: true,
      checkpoint_persisted: true,
      provider_disconnected: true,
      lease_released: true,
      checkpoint_checksum_sha256: checksum,
      checkpoint_size_bytes: String(sizeBytes),
      checkpoint_record_count: String(recordCount),
      prepared_at: new Date().toISOString(),
      error: '',
    };
    this.providerHandoffResult = result;
    this.logDebug('wwebjs.provider_handoff.prepared', {
      trace_id: input.debug_trace_id,
      layer: 'wwebjs',
      worker_id: input.worker_id,
      account_id: input.account_id,
      worker_type_id: EWorkerType.wwebjs,
      runtime_generation: input.runtime_generation,
      handoff_id: input.handoff_id,
      lifecycle_operation_id: input.lifecycle_operation_id,
      source_revision_id: input.source_revision_id,
      target_provider: input.target_provider,
      checkpoint_size_bytes: sizeBytes,
      checkpoint_record_count: recordCount,
      lease_released: true,
    });
    return { ...result };
  }

  private async performShutdown(clientToDestroy?: Client): Promise<void> {
    this.invalidatePendingConnectionInvocations();
    this.resetQrReadSession();
    this.qrReadSessionLocked = false;
    this.invalidateClientConnectionAttempt();
    this.connecting = false;
    this.connectionEstablished = false;
    this.setStatus(Status.disconnected, ECodeMessage.connectionLost, true);
    this.pendingResolve?.(this.state());
    this.pendingResolve = undefined;
    this.currentPromise = undefined;
    this.activeConnectionAttemptId = undefined;
    this.stopProviderRuntime('shutdown');
    this.retryCount = 0;
    this.healthCheckService.stop();
    this.clearDisconnectRetryTimer();
    this.clearConnectionStateProbe();
    this.incomingMessageService.unbind();

    await this.flushNativeConnectionStatusPersistence(
      'shutdown_before_browser_termination'
    );

    const runtimeTerminated =
      await this.terminateBrowserRuntimesBeforeProfileMutation(
        'shutdown',
        clientToDestroy,
        false,
        true
      );
    if (!runtimeTerminated) {
      return;
    }
    this.releaseSessionLifecycleLease();
  }

  private resolvePendingState(payload: IBaileysConnectionState): void {
    this.pendingResolve?.(this.attachConnectionMetadata(payload));
    this.pendingResolve = undefined;
  }

  cancelConnectionAttempt(): void {
    this.cancelAttempt(false);
  }

  private startConnection(
    fromDisconnectRestart = false,
    runtimeFenceConnectionAuthorization = this
      .runtimeFenceConnectionAuthorization
  ): Promise<IBaileysConnectionState> {
    const attemptId = ++this.connectionAttemptSequence;
    const explicitSecureImportRestore =
      this.secureImportConnectionAttemptActive;
    if (explicitSecureImportRestore) {
      this.secureImportConnectionAttemptActive = false;
      this.secureImportConnectionAttemptToken = undefined;
    }
    // A target provider receives the canonical PostgreSQL revision while the
    // handoff is still pending. It is a protected restore even when it was not
    // initiated through the explicit secure-import command, so it must not be
    // cut short by the normal QR/connection deadlines before RemoteAuth can
    // finish importing and validating the preserved session.
    const secureImportRestore =
      explicitSecureImportRestore ||
      (usesPostgresSessionStorage() &&
        this.postgresSessionStore?.hasPendingHandoff() === true);

    this.clearDisconnectRetryTimer();
    this.cancelKafkaReadinessRetry();
    this.clearConnectionStateProbe();
    this.connecting = true;
    this.connectionAttemptStartedAtMs = Date.now();
    this.setStatus(Status.connecting, ECodeMessage.awaitConnection);
    this.activeConnectionAttemptId = attemptId;
    if (!fromDisconnectRestart) {
      this.retryCount = 0;
    }
    let connectionPromise: Promise<IBaileysConnectionState>;
    connectionPromise = this.waitForPendingTeardown()
      .then(async () => {
        if (this.activeConnectionAttemptId !== attemptId) {
          return this.state();
        }

        const lifecycleLeaseError = this.acquireSessionLifecycleLease();
        if (lifecycleLeaseError) {
          return this.publishSessionActivationBlockedState(lifecycleLeaseError);
        }
        const lifecycleLease = this.sessionLifecycleLease;

        const activationError = this.beginRuntimeSessionActivation();
        if (activationError) {
          this.releaseSessionLifecycleLeaseIfCurrent(lifecycleLease);
          return this.publishSessionActivationBlockedState(activationError);
        }

        try {
          this.prepareFolder();
          this.logDebug('wwebjs.provider.connection_starting', {
            trace_id: this.debugTraceId,
            layer: 'wwebjs',
            worker_id: getWorker(),
            account_id: getAccount(),
            worker_type_id: EWorkerType.wwebjs,
            connection_attempt_id: this.connectionAttemptId,
            status: this.status,
            code: this.code,
            from_disconnect_restart: fromDisconnectRestart,
            secure_import_restore: secureImportRestore,
          });
          this.publishConnectionStarting();
          return await this.withConnectionAttemptGuardTimeout(
            this.createAndWaitClient(
              attemptId,
              secureImportRestore,
              runtimeFenceConnectionAuthorization
            ),
            attemptId,
            secureImportRestore
          );
        } catch (error) {
          if (
            !this.client ||
            !this.isActiveClientConnectionAttempt(this.client, attemptId)
          ) {
            this.releaseSessionLifecycleLeaseIfCurrent(lifecycleLease);
          }
          throw error;
        }
      })
      .finally(() => {
        if (
          this.currentPromise !== connectionPromise ||
          this.activeConnectionAttemptId !== attemptId
        ) {
          return;
        }
        this.connecting = false;
        this.currentPromise = undefined;
        this.activeConnectionAttemptId = undefined;
      });
    this.currentPromise = connectionPromise;

    return connectionPromise;
  }

  private withConnectionAttemptGuardTimeout(
    promise: Promise<IBaileysConnectionState>,
    attemptId: number,
    secureImportRestore = false
  ): Promise<IBaileysConnectionState> {
    const deadlineMs = secureImportRestore
      ? WWEBJS_SECURE_IMPORT_GUARD_TIMEOUT_MS
      : CONNECTION_QR_FIRST_QR_TIMEOUT_MS +
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
        resolve(this.attachConnectionMetadata(state));
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

        if (this.shouldResolveQrAttemptTimeoutAsFailure()) {
          const payload = this.resolveQrAttemptTimeout(
            startedAtMs,
            'connection_attempt_guard_timeout'
          );
          settle(payload);
          return;
        }

        settle(this.state());
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

  private async waitForActiveDisconnect(): Promise<void> {
    while (this.disconnectPromise) {
      await this.disconnectPromise;
    }
  }

  private async waitForPendingTeardown(): Promise<void> {
    try {
      await this.runWithTimeout(
        'pending_teardown_wait',
        this.teardownPromise.catch(() => undefined),
        WWEBJS_PENDING_TEARDOWN_TIMEOUT_MS
      );
    } catch {
      this.markSessionLifecycleTerminationUnconfirmed(
        'pending_teardown_wait_timeout'
      );
    }
  }

  private queueTeardown(
    operation: string,
    teardown: () => Promise<boolean>,
    options?: { lifecycleOwnerToken?: string }
  ): void {
    const lifecycleOwnerToken =
      options === undefined
        ? this.sessionLifecycleLease?.ownerToken
        : options.lifecycleOwnerToken;
    this.teardownPromise = this.teardownPromise
      .catch(() => undefined)
      .then(async () => {
        let runtimeTerminated = false;
        try {
          const teardownPromise = sessionLifecycleLeaseScope.run(
            { ownerToken: lifecycleOwnerToken },
            teardown
          );
          runtimeTerminated = await this.runWithTimeout(
            `connection_teardown:${operation}`,
            teardownPromise,
            WWEBJS_CONNECTION_TEARDOWN_TIMEOUT_MS
          );
        } catch {}

        if (!runtimeTerminated) {
          this.markSessionLifecycleTerminationUnconfirmed(operation);
          return;
        }
        if (lifecycleOwnerToken !== undefined) {
          this.releaseSessionLifecycleLease(lifecycleOwnerToken);
        }
      });
  }

  private markSessionLifecycleTerminationUnconfirmed(operation: string): void {
    markWwebjsProviderProcessReplacementRequired();
    if (this.sessionLifecycleTerminationUnconfirmed) {
      return;
    }
    this.sessionLifecycleTerminationUnconfirmed = true;
    this.sessionRestoreBlocked = true;
    this.connecting = false;
    this.connectionEstablished = false;
    this.clearDisconnectRetryTimer();
    this.clearConnectionStateProbe();
    this.cancelKafkaReadinessRetry();
    this.setStatus(Status.disconnected, ECodeMessage.connectionLost);

    const payload = this.state(undefined, undefined, {
      status: Status.disconnected,
      code: ECodeMessage.connectionLost,
      worker_status_id: EWorkerStatus.disponible,
      reason: 'browser_termination_unconfirmed',
      error: operation,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      provider_state: 'BROWSER_TERMINATION_UNCONFIRMED',
      degraded_reason: 'browser_termination_unconfirmed',
    });
    this.publishSub(payload, true);
    void this.notifyWorkerStatusSafely(
      payload,
      'browser_termination_unconfirmed'
    );
    this.resolvePendingState(payload);
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

  private trackCanonicalCheckpointDeferredProviderCall(
    client: Client,
    providerCall: Promise<unknown>,
    checkpointGeneration?: number,
    checkpointInProgress = false
  ): void {
    const token = Symbol('canonical-checkpoint-provider-call');
    const deferredAtMs = Date.now();
    const entry: CanonicalCheckpointDeferredProviderCall = {
      token,
      checkpointGeneration,
      deferredAtMs,
      providerCall,
      ...(checkpointInProgress
        ? {}
        : {
            postCheckpointDeadlineMs:
              deferredAtMs + CANONICAL_CHECKPOINT_PROVIDER_DRAIN_GRACE_MS,
          }),
    };
    this.canonicalCheckpointDeferredProviderCalls.set(client, entry);
    const clearIfOwner = (): void => {
      if (
        this.canonicalCheckpointDeferredProviderCalls.get(client)?.token ===
        token
      ) {
        this.canonicalCheckpointDeferredProviderCalls.delete(client);
      }
    };
    void providerCall.then(clearIfOwner, clearIfOwner);
  }

  private async invokeProviderLifecycleOperation<T>(
    client: Client,
    operation: string,
    invoke: () => Promise<T>,
    timeoutMs = WWEBJS_CLIENT_LOGOUT_TIMEOUT_MS,
    checkpointAware = false
  ): Promise<T> {
    const checkpointAtAdmission = checkpointAware
      ? this.getCanonicalActivationCheckpointState(client)
      : undefined;
    if (checkpointAtAdmission?.inProgress) {
      throw new CanonicalActivationCheckpointProbeDeferredError();
    }

    const lease = this.providerLifecycleInvocationFence.acquire(client);
    if (!lease) {
      throw new ProviderInvocationInFlightError(
        this.providerLifecycleInvocationFence.isStalled(client)
          ? 'stalled'
          : 'capacity'
      );
    }

    const operationKey = `connection_${operation}`;
    const operationLease = checkpointAware
      ? this.providerLifecycleAuxiliarySingleFlight.acquire(
          client,
          operationKey
        )
      : undefined;
    if (checkpointAware && !operationLease) {
      lease.releaseBeforeStart();
      if (this.canonicalCheckpointDeferredProviderCalls.get(client)) {
        throw new CanonicalActivationCheckpointProbeDeferredError();
      }
      throw new ProviderInvocationInFlightError('capacity');
    }

    const providerStartedAt = Date.now();
    const providerCall = operationLease
      ? operationLease.start(() => lease.start(invoke))
      : lease.start(invoke);
    try {
      const result = await invokeProviderAuxiliaryWithTimeout({
        provider: 'wwebjs',
        operation: operationKey,
        timeoutMs,
        invoke: () => providerCall,
      });
      if (checkpointAware && checkpointAtAdmission) {
        const checkpointAtSettlement =
          this.getCanonicalActivationCheckpointState(client);
        if (
          checkpointAtSettlement.inProgress ||
          (checkpointAtAdmission.generation !== undefined &&
            checkpointAtSettlement.generation !== undefined &&
            checkpointAtAdmission.generation !==
              checkpointAtSettlement.generation)
        ) {
          throw new CanonicalActivationCheckpointProbeDeferredError(
            Date.now() - providerStartedAt
          );
        }
      }
      return result;
    } catch (error) {
      if (error instanceof CanonicalActivationCheckpointProbeDeferredError) {
        throw error;
      }
      if (checkpointAware && checkpointAtAdmission) {
        const checkpointAtOutcome =
          this.getCanonicalActivationCheckpointState(client);
        const checkpointOverlapped =
          checkpointAtOutcome.inProgress ||
          (checkpointAtAdmission.generation !== undefined &&
            checkpointAtOutcome.generation !== undefined &&
            checkpointAtAdmission.generation !==
              checkpointAtOutcome.generation);
        if (checkpointOverlapped) {
          if (error instanceof ProviderAuxiliaryInvocationTimeoutError) {
            this.trackCanonicalCheckpointDeferredProviderCall(
              client,
              providerCall,
              checkpointAtOutcome.generation,
              checkpointAtOutcome.inProgress
            );
          }
          throw new CanonicalActivationCheckpointProbeDeferredError(
            Date.now() - providerStartedAt
          );
        }
      }
      if (error instanceof ProviderAuxiliaryInvocationTimeoutError) {
        lease.markStalled();
      }
      throw error;
    }
  }

  private trackClientInitialization(
    client: Client,
    attemptId: number,
    initializePromise: Promise<void>,
    watchdogTimeoutMs = WWEBJS_CLIENT_INITIALIZE_WATCHDOG_TIMEOUT_MS
  ): WwebjsClientInitializationLifecycle {
    const lifecycle: WwebjsClientInitializationLifecycle = {
      attemptId,
      connectionInvocationGeneration: this.connectionInvocationGeneration,
      runtimeGeneration: this.runtimeGeneration,
      lifecycleOwnerToken: this.sessionLifecycleLease?.ownerToken,
      lifecycleLeaseGeneration: this.sessionLifecycleLeaseGeneration,
      initializePromise,
      initializeState: 'pending',
      initializeWatchdogTimeoutMs: Math.max(1, watchdogTimeoutMs),
      cancellationRequested: false,
      lateCleanupScheduled: false,
      ownedBrowserProcesses: new Set<WwebjsOwnedBrowserProcess>(),
    };
    this.clientInitializationLifecycles.set(client, lifecycle);
    lifecycle.initializeWatchdogTimer = setTimeout(() => {
      this.handleClientInitializationWatchdogTimeout(
        client,
        attemptId,
        lifecycle
      );
    }, lifecycle.initializeWatchdogTimeoutMs);
    lifecycle.initializeWatchdogTimer.unref?.();

    this.logDebug('wwebjs.provider.client_initialize_started', {
      trace_id: this.debugTraceId,
      layer: 'wwebjs',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.wwebjs,
      connection_attempt_id: this.connectionAttemptId,
      runtime_generation: this.runtimeGeneration,
      attempt: attemptId,
      stage: 'client_initialize',
      timeout_ms: lifecycle.initializeWatchdogTimeoutMs,
    });

    void initializePromise.catch((error) => {
      if (
        this.clientInitializationLifecycles.get(client) === lifecycle &&
        lifecycle.initializeState === 'pending'
      ) {
        this.clearClientInitializationWatchdog(lifecycle);
        lifecycle.initializeState = 'failed';
        lifecycle.deferredConnectionStateProbe = undefined;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logDebug('wwebjs.provider.client_initialize_failed', {
        trace_id: this.debugTraceId,
        layer: 'wwebjs',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.wwebjs,
        connection_attempt_id: this.connectionAttemptId,
        runtime_generation: this.runtimeGeneration,
        attempt: attemptId,
        stage: 'client_initialize',
        reason: workerErrorFailureReason(
          'wwebjs_client_initialize_failed',
          error
        ),
        ...workerErrorDiagnostics(error),
      });
      void this.handleInitializeError(message, client, attemptId, lifecycle);
    });
    void initializePromise.then(
      () => {
        if (
          this.clientInitializationLifecycles.get(client) !== lifecycle ||
          lifecycle.initializeState !== 'pending'
        ) {
          return;
        }
        this.clearClientInitializationWatchdog(lifecycle);
        lifecycle.initializeState = 'completed';
        this.logDebug('wwebjs.provider.client_initialize_completed', {
          trace_id: this.debugTraceId,
          layer: 'wwebjs',
          worker_id: getWorker(),
          account_id: getAccount(),
          worker_type_id: EWorkerType.wwebjs,
          connection_attempt_id: this.connectionAttemptId,
          runtime_generation: this.runtimeGeneration,
          attempt: attemptId,
          stage: 'client_initialize',
        });
        const deferredProbe = lifecycle.deferredConnectionStateProbe;
        lifecycle.deferredConnectionStateProbe = undefined;
        if (
          deferredProbe &&
          lifecycle.cancellationRequested === false &&
          this.isActiveClientConnectionAttempt(client, attemptId) &&
          this.status === Status.connecting &&
          !this.connectionEstablished
        ) {
          this.startConnectionStateProbe(
            client,
            attemptId,
            deferredProbe.proxy,
            deferredProbe.secureImportRestore,
            deferredProbe.readyObserved
          );
        }
      },
      () => undefined
    );
    return lifecycle;
  }

  private clearClientInitializationWatchdog(
    lifecycle: WwebjsClientInitializationLifecycle
  ): void {
    if (!lifecycle.initializeWatchdogTimer) {
      return;
    }
    clearTimeout(lifecycle.initializeWatchdogTimer);
    lifecycle.initializeWatchdogTimer = undefined;
  }

  private handleClientInitializationWatchdogTimeout(
    client: Client,
    attemptId: number,
    lifecycle: WwebjsClientInitializationLifecycle
  ): void {
    if (
      this.clientInitializationLifecycles.get(client) !== lifecycle ||
      lifecycle.attemptId !== attemptId ||
      lifecycle.initializeState !== 'pending' ||
      lifecycle.cancellationRequested
    ) {
      return;
    }

    const operation = 'client_initialize_watchdog_timeout';
    this.clearClientInitializationWatchdog(lifecycle);
    lifecycle.initializeState = 'timed_out';
    lifecycle.cancellationRequested = true;
    lifecycle.deferredConnectionStateProbe = undefined;
    markWwebjsProviderProcessReplacementRequired();

    this.logDebug('wwebjs.provider.client_initialize_timed_out', {
      trace_id: this.debugTraceId,
      layer: 'wwebjs',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.wwebjs,
      connection_attempt_id: this.connectionAttemptId,
      runtime_generation: this.runtimeGeneration,
      attempt: attemptId,
      stage: 'client_initialize',
      timeout_ms: lifecycle.initializeWatchdogTimeoutMs,
      reason: operation,
    });

    this.invalidatePendingConnectionInvocations();
    this.invalidateClientConnectionAttempt(client);
    this.currentPromise = undefined;
    this.activeConnectionAttemptId = undefined;
    this.connecting = false;
    this.connectionEstablished = false;
    this.clearDisconnectRetryTimer();
    this.clearConnectionStateProbe();
    this.cancelKafkaReadinessRetry();
    this.stopProviderRuntime(operation);
    this.healthCheckService.stop();
    this.incomingMessageService.markConnectionUnavailable(client);
    this.incomingMessageService.unbind();

    /*
     * Never invoke client.destroy() while initialize() is unresolved. Signal
     * only browser processes whose launch ownership was captured, retain the
     * lifecycle lease, and make the process-replacement requirement sticky.
     * If initialize settles later, the existing late cleanup invokes the SDK
     * only after that settlement.
     */
    this.requestOwnedBrowserProcessTermination(lifecycle, operation);
    this.scheduleLateClientInitializationCleanup(client, lifecycle, operation);
    this.markSessionLifecycleTerminationUnconfirmed(operation);
    void this.forceTerminateClientRuntimeWithoutSdkOverlap(client, operation)
      .then((terminated) => {
        this.logDebug('wwebjs.provider.client_initialize_timeout_fenced', {
          trace_id: this.debugTraceId,
          layer: 'wwebjs',
          worker_id: getWorker(),
          account_id: getAccount(),
          worker_type_id: EWorkerType.wwebjs,
          connection_attempt_id: this.connectionAttemptId,
          runtime_generation: this.runtimeGeneration,
          attempt: attemptId,
          stage: 'client_initialize',
          browser_termination_confirmed: terminated,
          process_replacement_required: true,
          reason: operation,
        });
      })
      .catch((error) => {
        this.logDebug(
          'wwebjs.provider.client_initialize_timeout_fence_failed',
          {
            trace_id: this.debugTraceId,
            layer: 'wwebjs',
            worker_id: getWorker(),
            account_id: getAccount(),
            worker_type_id: EWorkerType.wwebjs,
            connection_attempt_id: this.connectionAttemptId,
            runtime_generation: this.runtimeGeneration,
            attempt: attemptId,
            stage: 'client_initialize',
            process_replacement_required: true,
            reason: workerErrorFailureReason(
              'wwebjs_client_initialize_timeout_fence_failed',
              error
            ),
            ...workerErrorDiagnostics(error),
          }
        );
      });
  }

  private getCanonicalActivationCheckpointState(
    client: Client
  ): WwebjsCanonicalActivationCheckpointState {
    const authStrategy = (
      client as Client & {
        authStrategy?: {
          canonicalActivationCheckpointInProgress?: unknown;
          canonicalActivationCheckpointGeneration?: unknown;
          getCanonicalActivationCheckpointState?: () => unknown;
          isCanonicalActivationRecoveryRequired?: () => unknown;
          isCanonicalActiveRestartAttestationPending?: () => unknown;
        };
      }
    ).authStrategy;

    if (!authStrategy) {
      return { inProgress: false };
    }

    try {
      const activationRecoveryRequired =
        authStrategy.isCanonicalActivationRecoveryRequired?.() === true;
      const activeRestartAttestationPending =
        authStrategy.isCanonicalActiveRestartAttestationPending?.() === true;
      const rawCheckpointState =
        authStrategy.getCanonicalActivationCheckpointState?.();
      if (rawCheckpointState !== undefined) {
        if (
          typeof rawCheckpointState !== 'object' ||
          rawCheckpointState === null
        ) {
          return { inProgress: true };
        }
        const checkpointState = rawCheckpointState as {
          inProgress?: unknown;
          generation?: unknown;
        };
        if (
          typeof checkpointState.inProgress !== 'boolean' ||
          !Number.isSafeInteger(checkpointState.generation) ||
          (checkpointState.generation as number) < 0
        ) {
          return { inProgress: true };
        }
        return {
          inProgress:
            checkpointState.inProgress ||
            activationRecoveryRequired ||
            activeRestartAttestationPending,
          generation: checkpointState.generation as number,
        };
      }

      const rawGeneration =
        authStrategy.canonicalActivationCheckpointGeneration;
      return {
        inProgress:
          authStrategy.canonicalActivationCheckpointInProgress === true ||
          activationRecoveryRequired ||
          activeRestartAttestationPending,
        ...(Number.isSafeInteger(rawGeneration) &&
        (rawGeneration as number) >= 0
          ? { generation: rawGeneration as number }
          : {}),
      };
    } catch {
      return { inProgress: true };
    }
  }

  private getClientProviderProbeGate(client: Client): WwebjsProviderProbeGate {
    const lifecycle = this.clientInitializationLifecycles.get(client);
    const checkpointState = this.getCanonicalActivationCheckpointState(client);
    if (!lifecycle) {
      return checkpointState.inProgress
        ? {
            allowed: false,
            state: 'canonical_activation_checkpoint',
          }
        : true;
    }
    if (
      lifecycle.initializeState === 'completed' &&
      lifecycle.cancellationRequested === false
    ) {
      return checkpointState.inProgress
        ? {
            allowed: false,
            state: 'canonical_activation_checkpoint',
          }
        : true;
    }
    if (lifecycle.initializeState === 'timed_out') {
      return {
        allowed: false,
        state: 'initialization_timeout',
        processReplacementRequired: true,
      };
    }
    if (lifecycle.cancellationRequested) {
      return {
        allowed: false,
        state: 'cancellation_requested',
        processReplacementRequired: this.sessionLifecycleTerminationUnconfirmed,
      };
    }
    if (lifecycle.initializeState === 'failed') {
      return {
        allowed: false,
        state: 'initialization_failed',
      };
    }
    return {
      allowed: false,
      state: 'initializing',
    };
  }

  private registerOwnedBrowserProcess(
    client: Client,
    attemptId: number,
    ownedBrowserProcess: WwebjsOwnedBrowserProcess
  ): void {
    const lifecycle = this.clientInitializationLifecycles.get(client);
    if (lifecycle) {
      lifecycle.ownedBrowserProcesses.add(ownedBrowserProcess);
    }
    if (
      !lifecycle ||
      lifecycle.attemptId !== attemptId ||
      lifecycle.connectionInvocationGeneration !==
        this.connectionInvocationGeneration ||
      lifecycle.runtimeGeneration !== this.runtimeGeneration ||
      lifecycle.lifecycleLeaseGeneration !==
        this.sessionLifecycleLeaseGeneration ||
      lifecycle.lifecycleOwnerToken !== this.sessionLifecycleLease?.ownerToken
    ) {
      this.markSessionLifecycleTerminationUnconfirmed(
        'browser_spawn_without_current_attempt_owner'
      );
      throw new Error(
        'wwebjs_browser_process_spawned_without_current_attempt_owner'
      );
    }
  }

  private handleOwnedBrowserProcessIdentityCaptured(
    client: Client,
    attemptId: number,
    ownedBrowserProcess: WwebjsOwnedBrowserProcess
  ): void {
    const lifecycle = this.clientInitializationLifecycles.get(client);
    if (
      !lifecycle ||
      lifecycle.attemptId !== attemptId ||
      !lifecycle.ownedBrowserProcesses.has(ownedBrowserProcess)
    ) {
      this.markSessionLifecycleTerminationUnconfirmed(
        'browser_identity_captured_without_registered_owner'
      );
      throw new Error(
        'wwebjs_browser_process_identity_captured_without_registered_owner'
      );
    }

    if (
      lifecycle.cancellationRequested &&
      !requestWwebjsOwnedBrowserProcessTermination(ownedBrowserProcess)
    ) {
      this.markSessionLifecycleTerminationUnconfirmed(
        'browser_spawn_after_initialize_cancellation'
      );
    }
  }

  private requestOwnedBrowserProcessTermination(
    lifecycle: WwebjsClientInitializationLifecycle | undefined,
    operation: string
  ): boolean {
    if (!lifecycle) {
      return true;
    }

    let allSignalsAccepted = true;
    for (const ownedBrowserProcess of lifecycle.ownedBrowserProcesses) {
      if (!requestWwebjsOwnedBrowserProcessTermination(ownedBrowserProcess)) {
        allSignalsAccepted = false;
      }
    }
    if (!allSignalsAccepted) {
      console.error(
        '[WwebjsConnection] Refused to signal a browser process whose ownership identity changed',
        { operation }
      );
    }
    return allSignalsAccepted;
  }

  private areOwnedBrowserProcessesTerminated(
    lifecycle: WwebjsClientInitializationLifecycle | undefined
  ): boolean {
    if (!lifecycle) {
      return true;
    }
    for (const ownedBrowserProcess of lifecycle.ownedBrowserProcesses) {
      if (!isWwebjsOwnedBrowserProcessTerminated(ownedBrowserProcess)) {
        return false;
      }
    }
    return true;
  }

  private async waitForOwnedBrowserProcessTermination(
    lifecycle: WwebjsClientInitializationLifecycle | undefined,
    timeoutMs: number
  ): Promise<boolean> {
    const deadlineMs = Date.now() + timeoutMs;
    while (Date.now() < deadlineMs) {
      if (this.areOwnedBrowserProcessesTerminated(lifecycle)) {
        return true;
      }
      this.requestOwnedBrowserProcessTermination(
        lifecycle,
        'browser_termination_retry'
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return this.areOwnedBrowserProcessesTerminated(lifecycle);
  }

  private scheduleLateClientInitializationCleanup(
    client: Client,
    lifecycle: WwebjsClientInitializationLifecycle,
    operation: string
  ): void {
    if (lifecycle.lateCleanupScheduled) {
      return;
    }
    lifecycle.lateCleanupScheduled = true;

    const settlement = lifecycle.initializePromise.then(
      () => undefined,
      () => undefined
    );
    void settlement
      .then(() =>
        sessionLifecycleLeaseScope.run(
          { ownerToken: lifecycle.lifecycleOwnerToken },
          () =>
            this.destroyInitializedClientRuntimeWithTimeout(
              client,
              `${operation}:late_initialize_cleanup`
            )
        )
      )
      .then((terminated) => {
        if (!terminated) {
          console.error(
            '[WwebjsConnection] Late-initialized browser cleanup could not confirm termination',
            { operation }
          );
        }
      })
      .catch((error) => {
        console.error(
          '[WwebjsConnection] Late-initialized browser cleanup failed',
          { operation, error: getErrorMessage(error) }
        );
      });
  }

  private async waitForClientInitializationSettlement(
    client: Client,
    operation: string
  ): Promise<boolean> {
    const lifecycle = this.clientInitializationLifecycles.get(client);
    if (!lifecycle) {
      return true;
    }

    lifecycle.cancellationRequested = true;
    lifecycle.deferredConnectionStateProbe = undefined;
    this.clearClientInitializationWatchdog(lifecycle);
    const settlement = lifecycle.initializePromise.then(
      () => undefined,
      () => undefined
    );
    try {
      await this.runWithTimeout(
        `client_initialize_settlement:${operation}`,
        settlement,
        WWEBJS_CLIENT_INITIALIZE_SETTLEMENT_TIMEOUT_MS
      );
      return true;
    } catch {
      this.scheduleLateClientInitializationCleanup(
        client,
        lifecycle,
        operation
      );
      this.markSessionLifecycleTerminationUnconfirmed(
        `${operation}:client_initialize_settlement_timeout`
      );
      return false;
    }
  }

  private async destroyClientWithTimeout(
    client: Client,
    operation: string
  ): Promise<boolean> {
    const lifecycle = this.clientInitializationLifecycles.get(client);
    if (lifecycle) {
      lifecycle.cancellationRequested = true;
      lifecycle.deferredConnectionStateProbe = undefined;
      this.clearClientInitializationWatchdog(lifecycle);
    }
    const initializationSettled =
      await this.waitForClientInitializationSettlement(client, operation);
    if (!initializationSettled) {
      this.requestOwnedBrowserProcessTermination(lifecycle, operation);
      await this.waitForOwnedBrowserProcessTermination(
        lifecycle,
        WWEBJS_BROWSER_TERMINATION_TIMEOUT_MS
      );
      return false;
    }

    return this.destroyInitializedClientRuntimeWithTimeout(client, operation);
  }

  private async destroyInitializedClientRuntimeWithTimeout(
    client: Client,
    operation: string
  ): Promise<boolean> {
    const lifecycle = this.clientInitializationLifecycles.get(client);
    const browserBeforeDestroy = client.pupBrowser;
    const destroySettlement = this.getOrStartClientDestroySettlement(client);
    let settlement: WwebjsClientDestroySettlement;
    try {
      settlement = await this.runWithTimeout(
        `client_destroy:${operation}`,
        destroySettlement,
        WWEBJS_CLIENT_DESTROY_TIMEOUT_MS
      );
    } catch (error) {
      this.markSessionLifecycleTerminationUnconfirmed(
        `${operation}:client_destroy_timeout`
      );
      this.logDebug('wwebjs.provider.client_destroy_timed_out', {
        trace_id: this.debugTraceId,
        layer: 'wwebjs',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.wwebjs,
        connection_attempt_id: this.connectionAttemptId,
        runtime_generation: this.runtimeGeneration,
        stage: 'client_destroy',
        timeout_ms: WWEBJS_CLIENT_DESTROY_TIMEOUT_MS,
        process_replacement_required: true,
        reason: workerErrorFailureReason(
          'wwebjs_client_destroy_timeout',
          error
        ),
      });
      this.requestOwnedBrowserProcessTermination(lifecycle, operation);
      await this.waitForOwnedBrowserProcessTermination(
        lifecycle,
        WWEBJS_BROWSER_TERMINATION_TIMEOUT_MS
      );
      void destroySettlement.then((lateSettlement) => {
        this.logDebug('wwebjs.provider.client_destroy_late_settlement', {
          trace_id: this.debugTraceId,
          layer: 'wwebjs',
          worker_id: getWorker(),
          account_id: getAccount(),
          worker_type_id: EWorkerType.wwebjs,
          connection_attempt_id: this.connectionAttemptId,
          runtime_generation: this.runtimeGeneration,
          stage: 'client_destroy',
          outcome: lateSettlement.status,
          process_replacement_required: true,
          reason:
            lateSettlement.status === 'rejected'
              ? workerErrorFailureReason(
                  'wwebjs_client_destroy_late_failure',
                  lateSettlement.error
                )
              : 'wwebjs_client_destroy_late_completion',
        });
      });
      return false;
    }

    const browser = client.pupBrowser ?? browserBeforeDestroy;
    const browserProcess = browser?.process?.();
    const trackedBrowserProcess = browserProcess
      ? [...(lifecycle?.ownedBrowserProcesses ?? [])].find(
          (owned) => owned.childProcess === browserProcess
        )
      : undefined;
    const gracefulBrowserTerminationConfirmed = Boolean(
      (!browserProcess ||
        (trackedBrowserProcess &&
          isWwebjsOwnedBrowserProcessTerminated(trackedBrowserProcess))) &&
      this.areOwnedBrowserProcessesTerminated(lifecycle) &&
      (!browser || !this.isBrowserConnected(browser))
    );
    if (
      settlement.status === 'rejected' ||
      !gracefulBrowserTerminationConfirmed
    ) {
      this.requestOwnedBrowserProcessTermination(lifecycle, operation);
    }
    const ownedProcessesTerminated =
      await this.waitForOwnedBrowserProcessTermination(
        lifecycle,
        WWEBJS_BROWSER_TERMINATION_TIMEOUT_MS
      );
    const browserTerminated = browserProcess
      ? Boolean(
          trackedBrowserProcess &&
          isWwebjsOwnedBrowserProcessTerminated(trackedBrowserProcess)
        )
      : !browser || !this.isBrowserConnected(browser);

    if (browserTerminated && ownedProcessesTerminated) {
      this.browserRuntimeClients.delete(client);
      return true;
    }

    console.error(
      '[WwebjsConnection] Browser termination could not be confirmed; retaining the session lifecycle lease',
      {
        operation,
        browser_pid: browserProcess?.pid,
        browser_connected: this.isBrowserConnected(browser),
        browser_process_owned: Boolean(trackedBrowserProcess),
        owned_processes_terminated: ownedProcessesTerminated,
      }
    );
    this.markSessionLifecycleTerminationUnconfirmed(operation);
    return false;
  }

  private getOrStartClientDestroySettlement(
    client: Client
  ): Promise<WwebjsClientDestroySettlement> {
    const existing = this.clientDestroySettlements.get(client);
    if (existing) {
      return existing;
    }

    const settlement = Promise.resolve()
      .then(() => client.destroy())
      .then<WwebjsClientDestroySettlement, WwebjsClientDestroySettlement>(
        () => ({ status: 'fulfilled' }),
        (error: unknown) => ({ status: 'rejected', error })
      );
    this.clientDestroySettlements.set(client, settlement);
    return settlement;
  }

  private async forceTerminateClientRuntimeWithoutSdkOverlap(
    client: Client,
    operation: string
  ): Promise<boolean> {
    const lifecycle = this.clientInitializationLifecycles.get(client);
    if (lifecycle) {
      lifecycle.cancellationRequested = true;
      lifecycle.deferredConnectionStateProbe = undefined;
      this.clearClientInitializationWatchdog(lifecycle);
    }
    const browser = client.pupBrowser;
    const browserProcess = browser?.process?.();
    const trackedBrowserProcess = browserProcess
      ? [...(lifecycle?.ownedBrowserProcesses ?? [])].find(
          (owned) => owned.childProcess === browserProcess
        )
      : undefined;

    this.requestOwnedBrowserProcessTermination(lifecycle, operation);
    const ownedProcessesTerminated =
      await this.waitForOwnedBrowserProcessTermination(
        lifecycle,
        WWEBJS_BROWSER_TERMINATION_TIMEOUT_MS
      );
    const browserTerminated = browserProcess
      ? Boolean(
          trackedBrowserProcess &&
          isWwebjsOwnedBrowserProcessTerminated(trackedBrowserProcess)
        )
      : !browser || !this.isBrowserConnected(browser);

    if (browserTerminated && ownedProcessesTerminated) {
      this.browserRuntimeClients.delete(client);
      return true;
    }

    console.error(
      '[WwebjsConnection] Timed-out logout browser termination could not be confirmed',
      {
        operation,
        browser_pid: browserProcess?.pid,
        browser_connected: this.isBrowserConnected(browser),
        browser_process_owned: Boolean(trackedBrowserProcess),
        owned_processes_terminated: ownedProcessesTerminated,
      }
    );
    this.markSessionLifecycleTerminationUnconfirmed(operation);
    return false;
  }

  private isBrowserConnected(browser: Client['pupBrowser']): boolean {
    try {
      return browser?.isConnected?.() === true;
    } catch {
      return true;
    }
  }

  private prepareFolder(): void {
    this.withSessionLifecycleLease(() => {
      if (!fs.existsSync(getFolder())) {
        fs.mkdirSync(getFolder(), { recursive: true });
      }
    });
  }

  private clearFolder(strict = false): void {
    this.withSessionLifecycleLease(() => {
      if (!fs.existsSync(getFolder())) {
        return;
      }

      const failures: string[] = [];
      for (const f of fs.readdirSync(getFolder())) {
        try {
          fs.rmSync(path.join(getFolder(), f), {
            recursive: true,
            force: true,
          });
        } catch (error) {
          failures.push(`${f}: ${getErrorMessage(error)}`);
        }
      }
      const remaining = fs.existsSync(getFolder())
        ? fs.readdirSync(getFolder())
        : [];
      if (strict && (failures.length > 0 || remaining.length > 0)) {
        throw new Error(
          `wwebjs_session_folder_cleanup_unconfirmed:${[
            ...failures,
            ...remaining.map((entry) => `${entry}: remained`),
          ].join('|')}`
        );
      }
    });
  }

  private getSessionPath(): string {
    const sessionDirectory = usesPostgresSessionStorage()
      ? this.getRemoteSessionName()
      : `session-${getWorker()}`;
    return path.join(getFolder(), '.wwebjs_auth', sessionDirectory);
  }

  private clearChromiumProfileLock(): void {
    this.withSessionLifecycleLease(() => {
      const result = cleanupWwebjsChromiumProfileArtifactsForCurrentOwnerSync(
        this.getSessionPath()
      );
      if (result.removedArtifacts > 0) {
        this.logDebug('wwebjs.provider.chromium_profile_lock_local_cleanup', {
          trace_id: this.debugTraceId,
          layer: 'wwebjs',
          worker_id: getWorker(),
          account_id: getAccount(),
          worker_type_id: EWorkerType.wwebjs,
          connection_attempt_id: this.connectionAttemptId,
          runtime_generation: this.runtimeGeneration,
          session_volume_name: wwebjsEnvironment.sessionVolumeName,
          recovered_scopes: result.recoveredScopes,
          removed_artifacts: result.removedArtifacts,
        });
      }
    });
  }

  private async recoverChromiumProfileBeforeLaunch(): Promise<void> {
    if (usesPostgresSessionStorage()) {
      // Database-backed profiles are container-ephemeral and can have no
      // owner in another container. Docker-aware authorization remains a
      // legacy-volume concern only.
      this.clearChromiumProfileLock();
      return;
    }

    let acquiredForRecovery = false;
    if (!this.sessionLifecycleLease || this.sessionLifecycleLease.released) {
      const lifecycleLeaseError = this.acquireSessionLifecycleLease();
      if (lifecycleLeaseError) {
        throw new Error(
          `wwebjs_chromium_profile_lock_recovery_blocked:${lifecycleLeaseError}`
        );
      }
      acquiredForRecovery = true;
    }
    const lifecycleLease = this.sessionLifecycleLease;
    if (!lifecycleLease || lifecycleLease.released) {
      throw new Error(
        'wwebjs_chromium_profile_lock_recovery_blocked:lifecycle_lease_missing'
      );
    }

    try {
      const result = await recoverWwebjsChromiumProfileBeforeLaunch({
        sessionDir: this.getSessionPath(),
        workerId: getWorker(),
        accountId: getAccount(),
        runtimeGeneration: this.runtimeGeneration,
        sessionVolumeName: wwebjsEnvironment.sessionVolumeName,
        authorizeForeignOwner: async (request) => {
          const response =
            await this.balanceWorkerStatusGrpcClientService.authorizeChromiumLockCleanup(
              request
            );
          return {
            authorized: response.authorized === true,
            reason: response.reason ?? '',
            request_id: response.request_id ?? '',
            requester_container_id: response.requester_container_id ?? '',
            owner_container_id: response.owner_container_id ?? '',
            session_volume_name: response.session_volume_name ?? '',
            singleton_lock_target: response.singleton_lock_target ?? '',
            expires_at_unix_ms: response.expires_at_unix_ms ?? 0,
          };
        },
      });
      if (
        this.sessionLifecycleLease !== lifecycleLease ||
        lifecycleLease.released
      ) {
        throw new Error(
          'wwebjs_chromium_profile_lock_recovery_blocked:lifecycle_lease_changed'
        );
      }
      if (result.removedArtifacts > 0) {
        this.logDebug(
          'wwebjs.provider.chromium_profile_lock_recovery_completed',
          {
            trace_id: this.debugTraceId,
            layer: 'wwebjs',
            worker_id: getWorker(),
            account_id: getAccount(),
            worker_type_id: EWorkerType.wwebjs,
            connection_attempt_id: this.connectionAttemptId,
            runtime_generation: this.runtimeGeneration,
            session_volume_name: wwebjsEnvironment.sessionVolumeName,
            recovered_scopes: result.recoveredScopes,
            removed_artifacts: result.removedArtifacts,
          }
        );
      }
    } catch (error) {
      const reason = getErrorMessage(error);
      console.error(
        '[WwebjsConnection] Chromium profile lock recovery blocked browser launch',
        {
          worker_id: getWorker(),
          account_id: getAccount(),
          runtime_generation: this.runtimeGeneration,
          session_volume_name: wwebjsEnvironment.sessionVolumeName,
          reason,
        }
      );
      this.logDebug('wwebjs.provider.chromium_profile_lock_recovery_blocked', {
        trace_id: this.debugTraceId,
        layer: 'wwebjs',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.wwebjs,
        connection_attempt_id: this.connectionAttemptId,
        runtime_generation: this.runtimeGeneration,
        session_volume_name: wwebjsEnvironment.sessionVolumeName,
        reason,
      });
      throw error;
    } finally {
      if (acquiredForRecovery) {
        this.releaseSessionLifecycleLeaseIfCurrent(lifecycleLease);
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
    }, WWEBJS_TRANSIENT_DISCONNECT_STATUS_DEBOUNCE_MS);
    this.transientDisconnectStatusTimer.unref?.();
  }

  private clearConnectionStateProbe(): void {
    if (!this.connectionStateProbeTimer) {
      return;
    }

    clearTimeout(this.connectionStateProbeTimer);
    this.connectionStateProbeTimer = undefined;
  }

  private cancelKafkaReadinessRetry(): void {
    this.kafkaReadinessRetryGeneration += 1;
    if (this.kafkaReadinessRetryTimer) {
      clearTimeout(this.kafkaReadinessRetryTimer);
      this.kafkaReadinessRetryTimer = undefined;
    }

    // An in-flight retry is fenced by the generation and active-client checks.
    // Releasing the slot here lets a new client attempt schedule its own retry
    // without waiting for the stale promise to settle.
    this.kafkaReadinessRetryFlight = undefined;
  }

  private hasKafkaReadinessRetryFor(
    client: Client,
    attemptId: number
  ): boolean {
    return (
      this.isActiveClientConnectionAttempt(client, attemptId) &&
      Boolean(this.kafkaReadinessRetryTimer || this.kafkaReadinessRetryFlight)
    );
  }

  private scheduleKafkaReadinessRetry(
    client: Client,
    attemptId: number,
    proxy: ReturnType<typeof readProxyConfig>
  ): void {
    if (
      !this.isActiveClientConnectionAttempt(client, attemptId) ||
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
        !this.isActiveClientConnectionAttempt(client, attemptId)
      ) {
        return;
      }

      let retryAgain = true;
      const flight = this.confirmReadyAndMarkConnected(
        client,
        attemptId,
        proxy,
        'kafka_retry'
      )
        .then((connected) => {
          retryAgain = !connected;
        })
        .catch((error) => {
          console.error(
            '[WwebjsConnection] Kafka readiness retry failed',
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
            this.isActiveClientConnectionAttempt(client, attemptId)
          ) {
            this.scheduleKafkaReadinessRetry(client, attemptId, proxy);
          }
        });

      this.kafkaReadinessRetryFlight = flight;
    }, WWEBJS_KAFKA_READINESS_RETRY_MS);
    this.kafkaReadinessRetryTimer.unref?.();
  }

  private publishReconnectAttempt(attempt: number, delayMs: number): void {
    const isProviderHandoff =
      usesPostgresSessionStorage() &&
      this.postgresSessionStore?.hasPendingHandoff() === true;
    const retryPayload: IBaileysConnectionState = {
      status: Status.connecting,
      worker_id: getWorker(),
      account_id: getAccount(),
      code: ECodeMessage.awaitConnection,
      worker_status_id: EWorkerStatus.disponible,
      attempt,
      max_attempts: MAX_RETRIES,
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
    this.logDebug('wwebjs.provider.reconnect_scheduled', {
      worker_id: getWorker(),
      account_id: getAccount(),
      connection_attempt_id: this.connectionAttemptId,
      runtime_generation: this.runtimeGeneration,
      debug_trace_id: this.debugTraceId,
      attempt,
      max_attempts: MAX_RETRIES,
      delay_ms: delayMs,
      provider_handoff: isProviderHandoff,
      provider_state: retryPayload.provider_state,
      degraded_reason: retryPayload.degraded_reason,
    });
    // The debounced disconnect owns the central transition. Retry telemetry is
    // UI-only so it cannot repeatedly reset a recovering channel to disponible.
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

  private publishLogoutInProgress(providerRuntimeAlreadyStopped = false): void {
    this.setStatus(
      Status.connecting,
      ECodeMessage.logoutInProgress,
      providerRuntimeAlreadyStopped
    );
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

  private scheduleReconnectCooldown(
    forceNew = false,
    allowActiveQrLifecycle = false
  ): void {
    this.clearDisconnectRetryTimer();
    this.disconnectRetryTimer = setTimeout(() => {
      this.disconnectRetryTimer = undefined;
      if (!this.shouldScheduleRetryAfterDisconnect(allowActiveQrLifecycle)) {
        return;
      }
      this.scheduleNextReconnectAttempt(forceNew, allowActiveQrLifecycle);
    }, RECONNECT_COOLDOWN_DELAY);
  }

  private scheduleSessionLockRetry(): void {
    if (this.userRequestedDisconnect) {
      return;
    }

    this.sessionLockRetryCount += 1;
    const exhausted =
      this.sessionLockRetryCount > WWEBJS_SESSION_LOCK_MAX_RETRIES;
    if (exhausted) {
      this.sessionLockRetryCount = 0;
    }

    const exponentialDelay = Math.min(
      WWEBJS_SESSION_LOCK_RETRY_MAX_MS,
      WWEBJS_SESSION_LOCK_RETRY_MIN_MS *
        2 ** Math.max(0, this.sessionLockRetryCount - 1)
    );
    const jitterWindow = Math.max(1, Math.floor(exponentialDelay * 0.4));
    const delayMs = exhausted
      ? WWEBJS_SESSION_LOCK_RETRY_COOLDOWN_MS
      : Math.max(
          WWEBJS_SESSION_LOCK_RETRY_MIN_MS,
          exponentialDelay -
            Math.floor(jitterWindow / 2) +
            Math.floor(Math.random() * jitterWindow)
        );

    this.clearDisconnectRetryTimer();
    this.disconnectRetryTimer = setTimeout(() => {
      this.disconnectRetryTimer = undefined;
      if (!this.shouldScheduleRetryAfterDisconnect(false)) {
        return;
      }
      this.connect({
        initial_connection: this.initialConnection,
        force_new: true,
        allow_restore: true,
        type: this.typeConnection,
        phone_connection: this.phoneConnection,
        requested_by_user: false,
        from_disconnect_restart: true,
        connection_attempt_id: this.connectionAttemptId,
        runtime_generation: this.runtimeGeneration,
        debug_trace_id: this.debugTraceId,
      }).catch(() => {
        this.scheduleSessionLockRetry();
      });
    }, delayMs);
  }

  private scheduleNextReconnectAttempt(
    forceNew = false,
    allowActiveQrLifecycle = this.canContinueQrReadSession()
  ): void {
    if (!this.shouldScheduleRetryAfterDisconnect(allowActiveQrLifecycle)) {
      return;
    }

    if (this.retryCount >= MAX_RETRIES) {
      this.retryCount = 0;
      this.publishReconnectAttempt(MAX_RETRIES, RECONNECT_COOLDOWN_DELAY);
      this.scheduleReconnectCooldown(forceNew, allowActiveQrLifecycle);
      return;
    }

    const nextAttempt = this.retryCount + 1;
    const recoveringProviderHandoff =
      usesPostgresSessionStorage() &&
      this.postgresSessionStore?.hasPendingHandoff() === true;
    const delayMs =
      nextAttempt === 1
        ? 0
        : recoveringProviderHandoff
          ? WWEBJS_PROVIDER_HANDOFF_RECONNECT_RETRY_MS
          : RETRY_DELAY;

    this.retryCount = nextAttempt;
    this.publishReconnectAttempt(nextAttempt, delayMs);

    this.clearDisconnectRetryTimer();
    this.disconnectRetryTimer = setTimeout(() => {
      this.disconnectRetryTimer = undefined;
      if (!this.shouldScheduleRetryAfterDisconnect(allowActiveQrLifecycle)) {
        return;
      }
      this.connect({
        initial_connection: this.initialConnection,
        force_new: forceNew,
        allow_restore: true,
        type: this.typeConnection,
        phone_connection: this.phoneConnection,
        requested_by_user: false,
        from_disconnect_restart: true,
        connection_attempt_id: this.connectionAttemptId,
        runtime_generation: this.runtimeGeneration,
        debug_trace_id: this.debugTraceId,
      }).catch(() => {
        this.scheduleNextReconnectAttempt(forceNew, allowActiveQrLifecycle);
      });
    }, delayMs);
  }

  private scheduleReconnectAfterProviderDisconnect(
    statusCode: ECodeMessage,
    allowActiveQrLifecycle = false
  ): void {
    if (this.sessionLifecycleTerminationUnconfirmed) {
      return;
    }

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
          this.scheduleNextReconnectAttempt(false, allowActiveQrLifecycle);
        });
      }, RETRY_DELAY);
      return;
    }

    this.scheduleNextReconnectAttempt(
      allowActiveQrLifecycle,
      allowActiveQrLifecycle
    );
  }

  private isActiveClient(client: Client): boolean {
    return this.client === client;
  }

  private isActiveClientConnectionAttempt(
    client: Client,
    attemptId: number
  ): boolean {
    const initializationLifecycle =
      this.clientInitializationLifecycles.get(client);
    return (
      this.isActiveClient(client) &&
      this.clientConnectionAttemptIds.get(client) === attemptId &&
      initializationLifecycle?.cancellationRequested !== true
    );
  }

  private invalidateClientConnectionAttempt(client = this.client): void {
    this.cancelKafkaReadinessRetry();
    if (!client) {
      return;
    }

    this.clientConnectionAttemptIds.delete(client);
    this.clientReadyConfirmationFlights.delete(client);
  }

  private claimProviderRuntimeActivation(
    client: Client,
    attemptId: number
  ): WwebjsProviderRuntimeActivation {
    const current = this.providerRuntimeActivation;
    if (current?.client === client && current.attemptId === attemptId) {
      return current;
    }

    const activation = { client, attemptId };
    this.providerRuntimeActivation = activation;
    return activation;
  }

  private claimValidatedProviderRuntimeActivation(
    client: Client,
    attemptId: number
  ): WwebjsProviderRuntimeActivation {
    if (!this.markProviderSessionValidated()) {
      throw new Error('wwebjs_session_activation_validation_failed');
    }
    return this.claimProviderRuntimeActivation(client, attemptId);
  }

  private isActiveProviderRuntimeActivation(
    activation: WwebjsProviderRuntimeActivation
  ): boolean {
    return (
      this.providerRuntimeActivation === activation &&
      this.isActiveClientConnectionAttempt(
        activation.client,
        activation.attemptId
      )
    );
  }

  private async acquireProviderRuntimeTransition(): Promise<() => void> {
    const previous = this.providerRuntimeTransitionTail;
    let releaseGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.providerRuntimeTransitionTail = tail;

    await previous.catch(() => undefined);

    let released = false;
    return () => {
      if (released) {
        return;
      }

      released = true;
      releaseGate?.();
      if (this.providerRuntimeTransitionTail === tail) {
        this.providerRuntimeTransitionTail = Promise.resolve();
      }
    };
  }

  private async stopProviderRuntimeActivationIfOwned(
    activation: WwebjsProviderRuntimeActivation,
    context: string
  ): Promise<void> {
    if (this.providerRuntimeActivation !== activation) {
      return;
    }

    this.providerRuntimeActivation = undefined;
    try {
      await this.stopProviderRuntimeAndWait(context);
    } catch (error) {
      console.error(
        `[WwebjsConnection] Failed to stop Kafka consumers after ${context}`,
        error
      );
    }
  }

  private async emitProviderRuntimeStoppedWithRetry(
    context: string
  ): Promise<void> {
    let lastError: unknown;
    for (
      let attempt = 1;
      attempt <= PROVIDER_RUNTIME_STOP_MAX_ATTEMPTS;
      attempt += 1
    ) {
      try {
        await emitWorkerProviderRuntimeState('wwebjs', false);
        return;
      } catch (error) {
        lastError = error;
        console.error(
          `[WwebjsConnection] Kafka consumer stop attempt ${attempt}/${PROVIDER_RUNTIME_STOP_MAX_ATTEMPTS} failed after ${context}`,
          error
        );
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Kafka consumers could not be stopped after ${context}`);
  }

  private async stopProviderRuntimeAndWait(context: string): Promise<void> {
    this.providerRuntimeActivation = undefined;
    try {
      await this.emitProviderRuntimeStoppedWithRetry(context);
      this.providerRuntimeStopFailure = undefined;
    } catch (error) {
      this.providerRuntimeStopFailure = error;
      throw error;
    }
  }

  private async recoverProviderRuntimeStopIfNeeded(): Promise<void> {
    if (this.providerRuntimeStopFailure === undefined) {
      return;
    }

    await this.stopProviderRuntimeAndWait(
      'recovering from previous Kafka consumer stop failure'
    );
  }

  private stopProviderRuntime(context: string): void {
    this.setCentralOnlineAcknowledged(false);
    void this.stopProviderRuntimeAndWait(context).catch((error) => {
      console.error(
        `[WwebjsConnection] Kafka consumers remain unavailable after ${context}`,
        error
      );
    });
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

  private isChromiumProfileRecoveryBlockedError(message: string): boolean {
    return message.includes('wwebjs_chromium_profile_lock_recovery_blocked:');
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

  private isAuthStateBootstrapTimeoutError(message: string): boolean {
    return message.trim().toLowerCase() === 'wwebjs_auth_state_timeout';
  }

  private handleNonTransientInitializeError(message: string): void {
    const inspection = this.inspectCurrentLocalSession();
    if (!inspection.restorable) {
      const quarantine = inspection.exists
        ? this.quarantineCurrentSession(
            `initialize_error_${inspection.blockedReason ?? 'invalid_session'}`
          )
        : undefined;
      this.publishQrRequiredState(
        quarantine?.moved
          ? 'initialize_error_session_quarantined'
          : 'initialize_error_requires_new_session',
        quarantine?.error ?? message
      );
      return;
    }

    const authStateBootstrapTimedOut =
      this.isAuthStateBootstrapTimeoutError(message);
    if (
      inspection.marker?.state === 'validated' &&
      !authStateBootstrapTimedOut
    ) {
      // A generic Chromium/SDK initialization error is not proof that a
      // previously validated LocalAuth profile is corrupt. Quarantining it
      // after an infrastructure crash turns recovery into an unnecessary QR.
      // Explicit authentication failures and invalid/candidate sessions keep
      // their bounded destructive paths.
      this.logDebug('wwebjs.provider.validated_session_preserved', {
        trace_id: this.debugTraceId,
        layer: 'wwebjs',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.wwebjs,
        connection_attempt_id: this.connectionAttemptId,
        runtime_generation: this.runtimeGeneration,
        reason: message,
      });
      this.scheduleNextReconnectAttempt(false);
      return;
    }

    let providerState = 'INITIALIZE_ERROR';
    let restoreFailureReason = 'non_transient_initialize_error';
    let quarantineReason = 'initialize_error_restore_exhausted';
    let quarantineIncompleteReason =
      'initialize_error_session_quarantine_incomplete';
    if (authStateBootstrapTimedOut) {
      providerState = 'AUTH_STATE_BOOTSTRAP_TIMEOUT';
      restoreFailureReason = 'auth_state_bootstrap_timeout';
      quarantineReason = 'auth_state_bootstrap_timeout_restore_exhausted';
      quarantineIncompleteReason =
        'auth_state_bootstrap_timeout_quarantine_incomplete';
    }

    const restoreFailure = this.recordSessionRestoreFailure(
      providerState,
      restoreFailureReason
    );
    if (restoreFailure.failures < restoreFailure.maxAttempts) {
      this.scheduleNextReconnectAttempt(true);
      return;
    }

    this.sessionRestoreBlocked = true;
    const quarantine = this.quarantineCurrentSession(quarantineReason);
    let qrRequiredReason = quarantineIncompleteReason;
    if (quarantine.moved) {
      qrRequiredReason = quarantineReason;
    }
    this.publishQrRequiredState(
      qrRequiredReason,
      quarantine.error ?? message,
      restoreFailure.failures,
      restoreFailure.maxAttempts
    );
  }

  private isCurrentClientInitializationFailure(
    client: Client,
    attemptId: number,
    lifecycle: WwebjsClientInitializationLifecycle
  ): boolean {
    return (
      this.clientInitializationLifecycles.get(client) === lifecycle &&
      lifecycle.attemptId === attemptId &&
      lifecycle.cancellationRequested === false &&
      lifecycle.connectionInvocationGeneration ===
        this.connectionInvocationGeneration &&
      lifecycle.runtimeGeneration === this.runtimeGeneration &&
      lifecycle.lifecycleLeaseGeneration ===
        this.sessionLifecycleLeaseGeneration &&
      lifecycle.lifecycleOwnerToken ===
        this.sessionLifecycleLease?.ownerToken &&
      this.isActiveClientConnectionAttempt(client, attemptId)
    );
  }

  private isClientInitializationFailureFenceCurrent(
    client: Client,
    lifecycle: WwebjsClientInitializationLifecycle,
    initializeErrorToken: string,
    requireLifecycleOwner: boolean
  ): boolean {
    if (
      this.clientInitializationLifecycles.get(client) !== lifecycle ||
      lifecycle.initializeErrorToken !== initializeErrorToken ||
      lifecycle.connectionInvocationGeneration !==
        this.connectionInvocationGeneration ||
      lifecycle.runtimeGeneration !== this.runtimeGeneration ||
      lifecycle.lifecycleLeaseGeneration !==
        this.sessionLifecycleLeaseGeneration ||
      (this.client !== undefined && this.client !== client) ||
      (this.activeConnectionAttemptId !== undefined &&
        this.activeConnectionAttemptId !== lifecycle.attemptId)
    ) {
      return false;
    }

    return (
      !requireLifecycleOwner ||
      lifecycle.lifecycleOwnerToken === this.sessionLifecycleLease?.ownerToken
    );
  }

  private async handleInitializeError(
    message: string,
    client: Client,
    attemptId: number,
    lifecycle = this.clientInitializationLifecycles.get(client)
  ): Promise<void> {
    if (
      !lifecycle ||
      !this.isCurrentClientInitializationFailure(client, attemptId, lifecycle)
    ) {
      console.warn('[Wwebjs] Ignoring initialize error from stale client:', {
        message,
      });
      return;
    }

    // After the offline activation CAS, WWebJS is the sole protocol owner.
    // A Chromium/bootstrap error cannot prove that the durable PostgreSQL
    // revision is corrupt and must never fall through to the bounded
    // LocalAuth quarantine/QR path. Restart the same active revision; the
    // canonical activation marker remains durable until RemoteAuth finishes
    // its connected checkpoint.
    if (this.isActivePostgresSessionRevision()) {
      this.recoverActivePostgresSessionRevision(
        client,
        attemptId,
        'wwebjs_active_postgres_initialize_failed'
      );
      return;
    }

    const initializeErrorToken = randomUUID();
    lifecycle.initializeErrorToken = initializeErrorToken;
    this.invalidateClientConnectionAttempt(client);
    this.connecting = false;
    this.connectionEstablished = false;
    this.activeConnectionAttemptId = undefined;
    this.currentPromise = undefined;
    this.clearConnectionStateProbe();
    this.clearDisconnectRetryTimer();
    this.queueTeardown(
      `initialize_error:${attemptId}`,
      async () => {
        const terminated = await this.destroyClientWithTimeout(
          client,
          'initialize_error'
        );
        if (!terminated) {
          return false;
        }

        if (this.client === client) {
          this.client = undefined;
        }
        if (
          !this.isClientInitializationFailureFenceCurrent(
            client,
            lifecycle,
            initializeErrorToken,
            true
          )
        ) {
          return true;
        }
        this.clearChromiumProfileLock();
        return true;
      },
      { lifecycleOwnerToken: lifecycle.lifecycleOwnerToken }
    );
    const providerRuntimeTransition = this.acquireProviderRuntimeTransition();

    console.error('[Wwebjs] client.initialize() failed:', message);
    this.setStatus(Status.disconnected, ECodeMessage.connectionLost);
    const failurePayload = this.state(undefined, undefined, {
      status: Status.disconnected,
      code: ECodeMessage.connectionLost,
      worker_status_id: EWorkerStatus.disponible,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      provider_state: 'initialize_error',
      degraded_reason: message,
      error: message,
    });
    this.pendingResolve?.(failurePayload);
    this.pendingResolve = undefined;
    const releaseProviderRuntimeTransition = await providerRuntimeTransition;
    try {
      if (
        !this.isClientInitializationFailureFenceCurrent(
          client,
          lifecycle,
          initializeErrorToken,
          false
        )
      ) {
        await this.waitForPendingTeardown();
        return;
      }

      const healthNotification = this.healthCheckService
        .notifyDisconnected(message, {
          detectedStatus: Status.disconnected,
          workerStatus: EWorkerStatus.disponible,
          providerState: 'initialize_error',
        })
        .catch((error) => {
          console.error(
            '[WwebjsConnection] Failed to publish initialize error health state',
            error
          );
        });
      await Promise.allSettled([
        this.publishSubWithCompletion(failurePayload, true),
        this.notifyWorkerStatusSafely(failurePayload, 'initialize_error'),
        healthNotification,
        this.waitForPendingTeardown(),
      ]);
      if (this.sessionLifecycleTerminationUnconfirmed) {
        return;
      }
      if (
        !this.isClientInitializationFailureFenceCurrent(
          client,
          lifecycle,
          initializeErrorToken,
          false
        )
      ) {
        return;
      }

      if (this.isChromiumProfileRecoveryBlockedError(message)) {
        this.scheduleNextReconnectAttempt(false);
      } else if (this.isChromiumProfileLockedError(message)) {
        try {
          await this.recoverChromiumProfileBeforeLaunch();
          this.reconnectAfterProfileUnlock();
        } catch {
          this.scheduleNextReconnectAttempt(false);
        }
      } else if (this.isTransientInitializeError(message)) {
        this.reconnectAfterTransientInitializeError();
      } else {
        this.handleNonTransientInitializeError(message);
      }

      await this.saveLogWppConnection({
        worker_id: getWorker(),
        status: Status.disconnected,
        code: ECodeMessage.connectionLost,
        message,
        date: new Date(),
      });
    } finally {
      releaseProviderRuntimeTransition();
    }
  }

  private resolveQrAttemptTimeout(
    startedAtMs: number,
    reason: 'qr_event_timeout' | 'connection_attempt_guard_timeout'
  ): IBaileysConnectionState {
    const elapsedMs = Date.now() - startedAtMs;
    this.invalidateClientConnectionAttempt();
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
    const clientToDestroy = this.client;
    this.queueTeardown(reason, async () => {
      if (!clientToDestroy) {
        return true;
      }

      const terminated = await this.destroyClientWithTimeout(
        clientToDestroy,
        reason
      );
      if (!terminated) {
        return false;
      }
      if (this.client === clientToDestroy) {
        this.client = undefined;
      }
      this.clearChromiumProfileLock();
      return true;
    });
    this.incomingMessageService.unbind();
    void this.waitForPendingTeardown().then(() => {
      if (!this.sessionLifecycleTerminationUnconfirmed) {
        this.scheduleNextReconnectAttempt(true, true);
      }
    });

    return this.withConnectionMetadata(payload);
  }

  private createAndWaitClient(
    attemptId: number,
    secureImportRestore = false,
    runtimeFenceConnectionAuthorization = this
      .runtimeFenceConnectionAuthorization
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
        resolve(this.attachConnectionMetadata(state));
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

        if (!this.shouldResolveQrAttemptTimeoutAsFailure()) {
          return;
        }

        const payload = this.resolveQrAttemptTimeout(
          startedAtMs,
          'qr_event_timeout'
        );
        settle(payload);
      }, firstQrTimeoutMs);

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
      let authStrategy;
      if (usesPostgresSessionStorage()) {
        const postgresStore = this.getPostgresSessionStore();
        postgresStore.logger.log(
          'browser.web_version_policy',
          {
            web_version_source: 'live_debug_version',
            web_cache_type: 'none',
            web_version_integrity_pinned: false,
            private_module_abi_preflight: true,
            noise_metadata_bootstrap_policy:
              'handoff_from_baileys_or_whatsmeow_only',
          },
          { force: true }
        );
        const remoteAuthOptions = {
          clientId: getWorker(),
          dataPath: authPath,
          // RemoteAuth consumes the library-native instance. Underchat owns
          // only worker lifecycle orchestration; codecs, SQL, lease fencing,
          // profile streaming and handoff hydration stay inside WWebJS.
          store: postgresStore.getNativeStore(),
          backupSyncIntervalMs: WWEBJS_REMOTE_AUTH_CHECKPOINT_INTERVAL_MS,
          initialSyncDelayMs: WWEBJS_REMOTE_AUTH_INITIAL_CHECKPOINT_DELAY_MS,
          identityResolver: resolveWwebjsCanonicalCompanionIdentity,
          requireFingerprintVerification: true,
          // The library narrows this opt-in after store.open() to a staging
          // handoff whose recorded source is Baileys or WhatsMeow. Pairing and
          // ordinary active revisions are always denied.
          allowNoiseMetadataBootstrap: true,
        };
        authStrategy = new RemoteAuth(
          remoteAuthOptions as unknown as ConstructorParameters<
            typeof RemoteAuth
          >[0]
        );
      } else {
        authStrategy = new LocalAuth({
          clientId: getWorker(),
          dataPath: authPath,
        });
      }
      const clientOptions: WwebjsClientOptions = {
        authStrategy,
        qrMaxRetries: MAX_QR_GENERATIONS,
        authTimeoutMs: secureImportRestore
          ? WWEBJS_SECURE_IMPORT_AUTH_TIMEOUT_MS
          : WWEBJS_AUTH_TIMEOUT_MS,
        puppeteer: puppeteerOpts,
        userAgent,
        emitHistoricalEvents: isHistoryReconciliationEnabled(),
        resolveCiphertextMessages: true,
        ciphertextResolutionDelaysMs: [
          2000, 5000, 10000, 20000, 30000, 45000, 60000, 90000, 120000,
        ],
      };

      if (usesPostgresSessionStorage()) {
        // Fetch the current WhatsApp Web build. RemoteAuth binds the actual
        // window.Debug.VERSION only after the private-module ABI preflight.
        // An integrity-pinned cache remains an explicit, separate opt-in.
        clientOptions.webVersionCache = { type: 'none' };
      } else {
        // A persisted LocalAuth profile also persists WhatsApp's service
        // worker. That worker can advance the Web build after initial pairing,
        // so forcing the package's older bundled HTML on the next launch makes
        // an otherwise valid volume fail with wwebjs_web_version_mismatch.
        // Keep the profile and load its current/live build without weakening
        // the default integrity-pinned policy for other library consumers.
        clientOptions.webVersionCache = { type: 'none' };
        this.logDebug('wwebjs.provider.web_version_policy', {
          trace_id: this.debugTraceId,
          layer: 'wwebjs',
          worker_id: getWorker(),
          account_id: getAccount(),
          worker_type_id: EWorkerType.wwebjs,
          connection_attempt_id: this.connectionAttemptId,
          runtime_generation: this.runtimeGeneration,
          attempt: attemptId,
          stage: 'client_construct',
          session_storage: EWorkerSessionStorage.legacy_volume,
          web_version_source: 'live_profile_compatible',
          web_cache_type: 'none',
          web_version_integrity_pinned: false,
        });
      }

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

      this.logDebug('wwebjs.provider.client_constructing', {
        trace_id: this.debugTraceId,
        layer: 'wwebjs',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.wwebjs,
        connection_attempt_id: this.connectionAttemptId,
        runtime_generation: this.runtimeGeneration,
        attempt: attemptId,
        stage: 'client_construct',
        postgres_session: usesPostgresSessionStorage(),
        secure_import_restore: secureImportRestore,
      });
      const client = new ClientCtor(
        clientOptions as ConstructorParameters<typeof ClientCtor>[0]
      );

      this.logDebug('wwebjs.provider.client_constructed', {
        trace_id: this.debugTraceId,
        layer: 'wwebjs',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.wwebjs,
        connection_attempt_id: this.connectionAttemptId,
        runtime_generation: this.runtimeGeneration,
        attempt: attemptId,
        stage: 'client_construct',
      });

      this.browserRuntimeClients.add(client);
      this.clientConnectionAttemptIds.set(client, attemptId);
      this.client = client;
      this.bindNativeConnectionStatus(client);
      this.incomingMessageService.bindTo(
        client,
        runtimeFenceConnectionAuthorization
      );

      client.on('code', (code: string) => {
        if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
          return;
        }

        if (this.isPostgresRestorePairingForbidden(secureImportRestore)) {
          void this.rejectUnexpectedPostgresRestorePairing(
            client,
            attemptId,
            'code'
          );
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
          connection_attempt_id: this.connectionAttemptId,
          debug_trace_id: this.debugTraceId,
        };

        this.publishSub(payload, true);
        void this.notifyWorkerStatusSafely(payload, 'pairing_code');
        this.pendingResolve?.(payload);
        this.pendingResolve = undefined;
      });

      client.on('qr', async (qr: string) => {
        if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
          return;
        }

        if (this.isPostgresRestorePairingForbidden(secureImportRestore)) {
          await this.rejectUnexpectedPostgresRestorePairing(
            client,
            attemptId,
            'qr'
          );
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

        this.logDebug('wwebjs.provider.qr_event', {
          trace_id: this.debugTraceId,
          layer: 'wwebjs',
          worker_id: getWorker(),
          account_id: getAccount(),
          worker_type_id: EWorkerType.wwebjs,
          connection_attempt_id: this.connectionAttemptId,
          status: this.status,
          code: this.code,
          attempt: this.qrGenerationCount,
          max_attempts: MAX_QR_GENERATIONS,
          time_to_first_qr_ms: timeToFirstQrMs,
        });

        if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
          return;
        }
        let img: string;
        try {
          img = await this.withTimeout(
            QRCode.toDataURL(qr),
            QR_DATA_URL_GENERATION_TIMEOUT_MS,
            `QR data URL generation timeout after ${QR_DATA_URL_GENERATION_TIMEOUT_MS}ms`
          );
          this.logDebug('wwebjs.provider.qr_dataurl_generated', {
            trace_id: this.debugTraceId,
            layer: 'wwebjs',
            worker_id: getWorker(),
            account_id: getAccount(),
            worker_type_id: EWorkerType.wwebjs,
            connection_attempt_id: this.connectionAttemptId,
            status: this.status,
            code: this.code,
            duration_ms: Date.now() - Date.parse(qrGeneratedAt),
            time_to_first_qr_ms: timeToFirstQrMs,
          });
        } catch (error) {
          if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
            return;
          }
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
              debug_trace_id: this.debugTraceId,
            });
            this.logDebug('wwebjs.provider.qr_dataurl_failed', {
              trace_id: this.debugTraceId,
              layer: 'wwebjs',
              worker_id: getWorker(),
              account_id: getAccount(),
              worker_type_id: EWorkerType.wwebjs,
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
            this.pendingResolve?.(payload);
            this.pendingResolve = undefined;
            return;
          }
        }
        if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
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
          debug_trace_id: this.debugTraceId,
          qr_generated_at: qrGeneratedAt,
          time_to_first_qr_ms: timeToFirstQrMs,
        };

        this.publishSub(payload, true);
        void this.notifyWorkerStatusSafely(payload, 'qr');
        this.retryCount = 0;

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
        this.scheduleQrRefresh(client, attemptId);
      });

      client.on('authenticated', () => {
        if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
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

        this.clearQrRefreshTimers();
        this.qrReadSessionActive = false;
        this.qrReadSessionLocked = true;
        this.qrHash = undefined;
        this.setStatus(Status.connecting, ECodeMessage.pairingInProgress);

        this.logDebug('wwebjs.provider.authenticated', {
          trace_id: this.debugTraceId,
          layer: 'wwebjs',
          worker_id: getWorker(),
          account_id: getAccount(),
          worker_type_id: EWorkerType.wwebjs,
          connection_attempt_id: this.connectionAttemptId,
          runtime_generation: this.runtimeGeneration,
          attempt: attemptId,
          stage: 'provider_authenticated',
        });

        const payload: IBaileysConnectionState = {
          status: this.status,
          code: this.code,
          worker_id: getWorker(),
          account_id: getAccount(),
          is_new_login: true,
          worker_status_id: EWorkerStatus.disponible,
          connection_attempt_id: this.connectionAttemptId,
          debug_trace_id: this.debugTraceId,
        };

        this.publishSub(payload, true);
        void this.notifyWorkerStatusSafely(payload, 'pairing_in_progress');
        this.startConnectionStateProbe(
          client,
          attemptId,
          proxy,
          secureImportRestore
        );
      });

      client.on('ready', () => {
        if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
          return;
        }

        this.logDebug('wwebjs.provider.ready_event', {
          trace_id: this.debugTraceId,
          layer: 'wwebjs',
          worker_id: getWorker(),
          account_id: getAccount(),
          worker_type_id: EWorkerType.wwebjs,
          connection_attempt_id: this.connectionAttemptId,
          runtime_generation: this.runtimeGeneration,
          attempt: attemptId,
          stage: 'provider_ready',
        });

        const initialization = this.clientInitializationLifecycles.get(client);
        if (
          initialization?.attemptId === attemptId &&
          initialization.initializeState === 'pending' &&
          initialization.cancellationRequested === false
        ) {
          /*
           * The SDK emits `ready` immediately before initialize() settles.
           * Defer the health/Kafka confirmation to the existing state probe
           * so RuntimeHealth never observes a false client_initializing
           * regression and the secure-import timeout remains attached.
           */
          this.startConnectionStateProbe(
            client,
            attemptId,
            proxy,
            secureImportRestore,
            true
          );
          return;
        }

        void this.confirmReadyAndMarkConnected(
          client,
          attemptId,
          proxy,
          'ready'
        );
      });

      client.on('remote_session_saved', () => {
        if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
          return;
        }
        this.clientsWithDurableRemoteCheckpoint.add(client);
        this.postgresSessionKnown = true;
      });

      client.on('disconnected', (reason: string) => {
        if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
          return;
        }

        if (
          usesPostgresSessionStorage() &&
          String(reason).trim().toLowerCase() === 'whatsapp_session_lease_lost'
        ) {
          this.handlePostgresSessionLeaseLost(
            Object.assign(new Error('wwebjs_session_lease_lost'), {
              code: 'whatsapp_session_lease_lost',
            })
          );
        }
        const statusCode = this.mapDisconnectReason(reason);
        if (
          this.canContinueQrReadSession() &&
          !this.isTerminalSessionDisconnectCode(statusCode)
        ) {
          void this.recoverQrReadSessionAfterAuthFailure(
            client,
            workerErrorFailureReason('wwebjs_qr_client_disconnected', reason)
          );
          return;
        }

        this.invalidateClientConnectionAttempt(client);
        this.stopProviderRuntime('provider disconnect');
        this.connectionEstablished = false;
        this.clearConnectionStateProbe();

        if (
          this.isQrReadSessionInProgress() &&
          this.qrGenerationCount >= MAX_QR_GENERATIONS
        ) {
          this.handleQrGenerationLimitReached();
          return;
        }

        this.healthCheckService.stop();

        const isMismatchedStatus =
          statusCode === ECodeMessage.loggedOut ||
          statusCode === ECodeMessage.multideviceMismatch ||
          statusCode === ECodeMessage.badSession ||
          statusCode === ECodeMessage.connectionReplaced;
        const allowActiveQrLifecycle =
          !isMismatchedStatus && this.canContinueQrReadSession();
        const shouldRetryAfterDisconnect =
          this.shouldScheduleRetryAfterDisconnect(allowActiveQrLifecycle);

        if (isMismatchedStatus) {
          this.setStatus(Status.disconnected, statusCode);
        } else {
          this.setStatus(Status.connecting, ECodeMessage.awaitConnection);
          void this.healthCheckService.notifyDisconnected(reason, {
            detectedStatus: Status.connecting,
            workerStatus: EWorkerStatus.disponible,
            providerState: shouldRetryAfterDisconnect
              ? 'reconnecting'
              : 'disponible',
            publishStatus: false,
          });
        }

        const workerStatusId = isMismatchedStatus
          ? EWorkerStatus.mismatched
          : EWorkerStatus.disponible;

        const payload: IBaileysConnectionState = {
          status: this.status,
          worker_id: getWorker(),
          account_id: getAccount(),
          code: this.code,
          phone: this.getClientPhone(client),
          worker_status_id: workerStatusId,
          connection_attempt_id: this.connectionAttemptId,
          debug_trace_id: this.debugTraceId,
          session_ready: false,
          can_send: false,
          can_receive_runtime: false,
          authenticated: false,
          provider_state: isMismatchedStatus ? 'disconnected' : 'reconnecting',
          degraded_reason:
            reason ??
            (isMismatchedStatus ? 'terminal_disconnect' : 'connection_closed'),
        };

        if (isMismatchedStatus) {
          this.publishSub(payload, true);
        } else {
          this.publishTelemetry(payload);
        }

        this.saveLogWppConnection({
          worker_id: getWorker(),
          status: this.status,
          code: this.code?.toString(),
          message: reason ?? 'Wwebjs disconnected',
          date: new Date(),
        });

        if (isMismatchedStatus) {
          this.cancelTransientDisconnectStatus();
          void this.notifyWorkerStatusSafely(payload, 'disconnected');
        } else {
          this.scheduleTransientDisconnectStatus(payload, 'disconnected');
        }

        if (isMismatchedStatus) {
          this.updateWorkerMismatchedStatus();
        }

        if (statusCode === ECodeMessage.loggedOut) {
          this.postgresSessionKnown = false;
          const logoutPayload: IBaileysConnectionState = {
            status: this.status,
            worker_id: getWorker(),
            code: statusCode,
            disconnected_user: true,
            account_id: getAccount(),
            worker_status_id: EWorkerStatus.mismatched,
            connection_attempt_id: this.connectionAttemptId,
            debug_trace_id: this.debugTraceId,
          };

          this.publishSub(logoutPayload, true);
          void this.notifyWorkerStatusSafely(logoutPayload, 'logged_out');
        }

        this.pendingResolve?.(this.state());
        this.pendingResolve = undefined;

        this.incomingMessageService.unbind();
        this.client = undefined;
        this.queueTeardown('provider_disconnected', async () => {
          const terminated = await this.destroyClientWithTimeout(
            client,
            'provider_disconnected'
          );
          if (!terminated) {
            return false;
          }

          this.clearChromiumProfileLock();
          if (statusCode === ECodeMessage.loggedOut) {
            this.clearFolder();
          }
          return true;
        });

        void this.waitForPendingTeardown().then(() =>
          this.scheduleReconnectAfterProviderDisconnect(
            statusCode,
            allowActiveQrLifecycle
          )
        );
      });

      client.on('auth_failure', async (reason?: string) => {
        if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
          return;
        }

        const errorCode =
          typeof reason === 'string' &&
          /^wwebjs_[a-z0-9_]+$/u.test(reason.trim())
            ? reason.trim()
            : 'wwebjs_auth_failure';
        if (this.isQrReadSessionInProgress()) {
          await this.recoverQrReadSessionAfterAuthFailure(client, errorCode);
          return;
        }
        if (this.isActivePostgresSessionRevision()) {
          this.recoverActivePostgresSessionRevision(
            client,
            attemptId,
            errorCode
          );
          return;
        }

        this.invalidateClientConnectionAttempt(client);
        this.sessionRestoreBlocked = true;
        this.connecting = false;
        this.activeConnectionAttemptId = undefined;
        this.currentPromise = undefined;
        this.setStatus(Status.disconnected, ECodeMessage.badSession);
        this.clearConnectionStateProbe();
        const payload: IBaileysConnectionState = {
          status: this.status,
          worker_id: getWorker(),
          account_id: getAccount(),
          code: this.code,
          phone: this.getClientPhone(client),
          worker_status_id: EWorkerStatus.mismatched,
          connection_attempt_id: this.connectionAttemptId,
          debug_trace_id: this.debugTraceId,
          session_ready: false,
          can_send: false,
          can_receive_runtime: false,
          authenticated: false,
          provider_state: 'auth_failure',
          degraded_reason: 'auth_failure',
        };
        this.publishSub(payload, true);
        void this.notifyWorkerStatusSafely(payload, 'auth_failure');
        this.pendingResolve?.(this.state());
        this.pendingResolve = undefined;
        this.queueTeardown('auth_failure', async () => {
          const terminated = await this.destroyClientWithTimeout(
            client,
            'auth_failure'
          );
          if (!terminated) {
            return false;
          }
          if (this.client === client) {
            this.client = undefined;
          }
          this.clearChromiumProfileLock();
          const quarantine = this.quarantineCurrentSession(
            'provider_auth_failure'
          );
          this.publishQrRequiredState(
            quarantine.moved
              ? 'provider_auth_failure_session_quarantined'
              : 'provider_auth_failure_session_quarantine_incomplete',
            quarantine.error
          );
          return true;
        });
        this.incomingMessageService.unbind();
      });

      client.on('chat_state', (state) => {
        if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
          return;
        }

        this.handleChatState(state);
      });

      const initializePromise = Promise.resolve().then(async () => {
        let lifecycle = this.clientInitializationLifecycles.get(client);
        if (
          !lifecycle ||
          lifecycle.cancellationRequested ||
          !this.isActiveClientConnectionAttempt(client, attemptId)
        ) {
          throw new Error('wwebjs_client_initialize_cancelled_before_launch');
        }

        this.logDebug('wwebjs.provider.chromium_profile_recovery_started', {
          trace_id: this.debugTraceId,
          layer: 'wwebjs',
          worker_id: getWorker(),
          account_id: getAccount(),
          worker_type_id: EWorkerType.wwebjs,
          connection_attempt_id: this.connectionAttemptId,
          runtime_generation: this.runtimeGeneration,
          attempt: attemptId,
          stage: 'chromium_profile_recovery',
        });
        await this.recoverChromiumProfileBeforeLaunch();
        this.logDebug('wwebjs.provider.chromium_profile_recovery_completed', {
          trace_id: this.debugTraceId,
          layer: 'wwebjs',
          worker_id: getWorker(),
          account_id: getAccount(),
          worker_type_id: EWorkerType.wwebjs,
          connection_attempt_id: this.connectionAttemptId,
          runtime_generation: this.runtimeGeneration,
          attempt: attemptId,
          stage: 'chromium_profile_recovery',
        });
        lifecycle = this.clientInitializationLifecycles.get(client);
        if (
          !lifecycle ||
          lifecycle.cancellationRequested ||
          !this.isActiveClientConnectionAttempt(client, attemptId)
        ) {
          throw new Error(
            'wwebjs_client_initialize_cancelled_after_lock_recovery'
          );
        }

        this.logDebug('wwebjs.provider.chromium_initialize_invoked', {
          trace_id: this.debugTraceId,
          layer: 'wwebjs',
          worker_id: getWorker(),
          account_id: getAccount(),
          worker_type_id: EWorkerType.wwebjs,
          connection_attempt_id: this.connectionAttemptId,
          runtime_generation: this.runtimeGeneration,
          attempt: attemptId,
          stage: 'chromium_initialize',
        });
        return runWithWwebjsBrowserLaunchOwner(
          {
            registerBrowserProcess: (ownedBrowserProcess) =>
              this.registerOwnedBrowserProcess(
                client,
                attemptId,
                ownedBrowserProcess
              ),
            browserProcessIdentityCaptured: (ownedBrowserProcess) =>
              this.handleOwnedBrowserProcessIdentityCaptured(
                client,
                attemptId,
                ownedBrowserProcess
              ),
          },
          () => client.initialize()
        );
      });
      this.trackClientInitialization(
        client,
        attemptId,
        initializePromise,
        secureImportRestore
          ? WWEBJS_SECURE_IMPORT_INITIALIZE_WATCHDOG_TIMEOUT_MS
          : WWEBJS_CLIENT_INITIALIZE_WATCHDOG_TIMEOUT_MS
      );
      this.startConnectionStateProbe(
        client,
        attemptId,
        proxy,
        secureImportRestore
      );
    });
  }

  private shouldResolveQrAttemptTimeoutAsFailure(): boolean {
    return this.qrReadSessionActive;
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
    return this.invokeProviderLifecycleOperation(
      client,
      'state_probe',
      async () => {
        const state = await client.getState();
        return state ?? undefined;
      },
      timeoutMs,
      true
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

  private async handlePersistentUnpaired(
    client: Client,
    attemptId: number,
    providerState: 'UNPAIRED' | 'UNPAIRED_IDLE'
  ): Promise<void> {
    if (
      !this.isActiveClientConnectionAttempt(client, attemptId) ||
      this.qrReadSessionActive ||
      this.qrReadSessionLocked
    ) {
      return;
    }

    if (this.isActivePostgresSessionRevision()) {
      this.recoverActivePostgresSessionRevision(
        client,
        attemptId,
        'wwebjs_active_postgres_persistent_unpaired'
      );
      return;
    }

    const restoreFailure = this.recordSessionRestoreFailure(
      providerState,
      'persistent_unpaired'
    );
    const exhausted = restoreFailure.failures >= restoreFailure.maxAttempts;
    if (exhausted) {
      this.sessionRestoreBlocked = true;
    }

    this.logDebug('wwebjs.provider.persistent_unpaired', {
      trace_id: this.debugTraceId,
      layer: 'wwebjs',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.wwebjs,
      connection_attempt_id: this.connectionAttemptId,
      authorized_connection_epoch: this.runtimeFenceConnectionAuthorization
        ?.connection_attempt_id
        ? this.runtimeFenceConnectionAuthorization.connection_epoch
        : undefined,
      runtime_generation: this.runtimeGeneration,
      session_volume_name: wwebjsEnvironment.sessionVolumeName,
      provider_state: providerState,
      restore_failures: restoreFailure.failures,
      max_restore_attempts: restoreFailure.maxAttempts,
      incomplete_activation_detected:
        restoreFailure.marker?.incomplete_activation_detected === true,
      exhausted,
    });

    this.clearConnectionStateProbe();
    this.cancelKafkaReadinessRetry();
    this.invalidateClientConnectionAttempt(client);
    this.connectionEstablished = false;
    this.connecting = false;
    this.activeConnectionAttemptId = undefined;
    this.currentPromise = undefined;
    if (this.client === client) {
      this.client = undefined;
    }
    this.incomingMessageService.unbind();
    this.setStatus(
      exhausted ? Status.disconnected : Status.connecting,
      exhausted ? ECodeMessage.badSession : ECodeMessage.awaitConnection
    );

    const reason = exhausted
      ? 'stale_session_restore_exhausted'
      : 'persistent_unpaired_restore_retry';
    const payload = this.state(undefined, undefined, {
      status: exhausted ? Status.disconnected : Status.connecting,
      code: exhausted ? ECodeMessage.badSession : ECodeMessage.awaitConnection,
      worker_status_id: EWorkerStatus.disponible,
      reason,
      attempt: restoreFailure.failures,
      max_attempts: restoreFailure.maxAttempts,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      provider_state: exhausted ? 'QR_REQUIRED' : providerState,
      degraded_reason: reason,
    });
    this.publishSub(payload, true);
    void this.notifyWorkerStatusSafely(payload, reason);
    this.resolvePendingState(payload);

    this.queueTeardown('persistent_unpaired', async () => {
      const terminated = await this.destroyClientWithTimeout(
        client,
        'persistent_unpaired'
      );
      if (!terminated) {
        return false;
      }
      this.clearChromiumProfileLock();
      return true;
    });
    await this.waitForPendingTeardown();
    if (this.sessionLifecycleTerminationUnconfirmed) {
      return;
    }

    if (exhausted) {
      this.clearDisconnectRetryTimer();
      this.retryCount = 0;
      this.resetQrReadSession();
      this.qrReadSessionLocked = false;
      const quarantine = this.quarantineCurrentSession(
        'persistent_unpaired_restore_exhausted'
      );
      if (!quarantine.moved) {
        this.publishQrRequiredState(
          'stale_session_quarantine_incomplete',
          quarantine.error,
          restoreFailure.failures,
          restoreFailure.maxAttempts
        );
      }
      return;
    }

    this.scheduleNextReconnectAttempt(true);
  }

  private startConnectionStateProbe(
    client: Client,
    attemptId: number,
    proxy: ReturnType<typeof readProxyConfig>,
    secureImportRestore = false,
    readyObserved = false
  ): void {
    this.cancelKafkaReadinessRetry();
    this.clearConnectionStateProbe();

    const initialization = this.clientInitializationLifecycles.get(client);
    const initialProbeGate = this.getClientProviderProbeGate(client);
    const initialProbeAllowed =
      initialProbeGate === true ||
      (initialProbeGate !== false && initialProbeGate.allowed);
    const initiallyCheckpointDeferred =
      initialProbeGate !== true &&
      initialProbeGate !== false &&
      initialProbeGate.state === 'canonical_activation_checkpoint';
    if (
      initialization?.attemptId === attemptId &&
      !initialProbeAllowed &&
      !initiallyCheckpointDeferred
    ) {
      if (
        initialization.initializeState === 'pending' &&
        initialization.cancellationRequested === false
      ) {
        initialization.deferredConnectionStateProbe = {
          proxy,
          secureImportRestore,
          readyObserved,
        };
        this.logDebug('wwebjs.provider.connection_state_probe_deferred', {
          trace_id: this.debugTraceId,
          layer: 'wwebjs',
          worker_id: getWorker(),
          account_id: getAccount(),
          worker_type_id: EWorkerType.wwebjs,
          connection_attempt_id: this.connectionAttemptId,
          runtime_generation: this.runtimeGeneration,
          attempt: attemptId,
          reason: 'client_initialize_pending',
        });
      }
      return;
    }

    const startedAt = Date.now();
    const nextProbeDelayMs = (): number =>
      readyObserved &&
      Date.now() - startedAt < CONNECTION_STATE_READY_EVENT_FAST_WINDOW_MS
        ? CONNECTION_STATE_READY_EVENT_RECONCILE_INTERVAL_MS
        : CONNECTION_STATE_RECONCILE_INTERVAL_MS;
    const scheduleProbe = (): void => {
      this.connectionStateProbeTimer = setTimeout(() => {
        void probe();
      }, nextProbeDelayMs());
    };
    const reconcileTimeoutMs = secureImportRestore
      ? WWEBJS_SECURE_IMPORT_GUARD_TIMEOUT_MS
      : CONNECTION_STATE_RECONCILE_TIMEOUT_MS;
    const sessionRestoreProbeEnabled = this.hasSession();
    let unpairedSinceMs: number | undefined;
    let checkpointDeferredDurationMs = 0;
    let checkpointDeferralStartedAt = initiallyCheckpointDeferred
      ? startedAt
      : undefined;
    const beginCheckpointDeferral = (): void => {
      checkpointDeferralStartedAt ??= Date.now();
      unpairedSinceMs = undefined;
    };
    const endCheckpointDeferral = (): void => {
      if (checkpointDeferralStartedAt === undefined) {
        return;
      }
      checkpointDeferredDurationMs += Date.now() - checkpointDeferralStartedAt;
      checkpointDeferralStartedAt = undefined;
    };
    const logProbeDeferred = (reason: string): void => {
      this.logDebug('wwebjs.provider.connection_state_probe_deferred', {
        trace_id: this.debugTraceId,
        layer: 'wwebjs',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.wwebjs,
        connection_attempt_id: this.connectionAttemptId,
        runtime_generation: this.runtimeGeneration,
        attempt: attemptId,
        reason,
      });
    };
    const probe = async (): Promise<void> => {
      if (
        !this.isActiveClientConnectionAttempt(client, attemptId) ||
        this.status !== Status.connecting ||
        this.connectionEstablished
      ) {
        this.clearConnectionStateProbe();
        return;
      }

      const tickProbeGate = this.getClientProviderProbeGate(client);
      const tickProbeAllowed =
        tickProbeGate === true ||
        (tickProbeGate !== false && tickProbeGate.allowed);
      const checkpointState =
        this.getCanonicalActivationCheckpointState(client);
      const deferredProviderCall =
        this.canonicalCheckpointDeferredProviderCalls.get(client);
      const checkpointGateActive =
        !tickProbeAllowed &&
        tickProbeGate !== false &&
        tickProbeGate.state === 'canonical_activation_checkpoint';
      if (checkpointState.inProgress || checkpointGateActive) {
        if (deferredProviderCall) {
          deferredProviderCall.checkpointGeneration =
            checkpointState.generation;
          deferredProviderCall.postCheckpointDeadlineMs = undefined;
        }
        beginCheckpointDeferral();
        logProbeDeferred('canonical_activation_checkpoint');
        scheduleProbe();
        return;
      }
      if (deferredProviderCall) {
        if (
          checkpointState.generation !== undefined &&
          checkpointState.generation !==
            deferredProviderCall.checkpointGeneration
        ) {
          deferredProviderCall.checkpointGeneration =
            checkpointState.generation;
          deferredProviderCall.postCheckpointDeadlineMs = undefined;
        }
        deferredProviderCall.postCheckpointDeadlineMs ??=
          Date.now() + CANONICAL_CHECKPOINT_PROVIDER_DRAIN_GRACE_MS;
        if (Date.now() < deferredProviderCall.postCheckpointDeadlineMs) {
          beginCheckpointDeferral();
          logProbeDeferred('canonical_checkpoint_provider_drain');
          scheduleProbe();
          return;
        }
        if (
          this.canonicalCheckpointDeferredProviderCalls.get(client)?.token ===
          deferredProviderCall.token
        ) {
          this.canonicalCheckpointDeferredProviderCalls.delete(client);
        }
        this.providerLifecycleInvocationFence.markStalled(client);
        await this.recoverFromStalledConnectionStateProbe(
          client,
          attemptId,
          new ProviderInvocationInFlightError('stalled')
        );
        return;
      }
      if (!tickProbeAllowed) {
        this.clearConnectionStateProbe();
        return;
      }
      endCheckpointDeferral();

      let waState: string | undefined;
      try {
        waState = await this.getClientStateWithTimeout(client);
      } catch (error) {
        if (error instanceof CanonicalActivationCheckpointProbeDeferredError) {
          checkpointDeferredDurationMs += error.deferredDurationMs;
          if (
            this.getCanonicalActivationCheckpointState(client).inProgress ||
            this.canonicalCheckpointDeferredProviderCalls.has(client)
          ) {
            beginCheckpointDeferral();
          }
          logProbeDeferred('canonical_activation_checkpoint');
          scheduleProbe();
          return;
        } else if (isProviderInvocationCapacityError(error)) {
          // Capacity is temporary admission backpressure caused by other
          // healthy SDK operations. It must not tear Chromium down or rotate
          // the runtime generation; the next bounded probe will retry.
          logProbeDeferred('provider_capacity_saturated');
        } else if (
          error instanceof ProviderAuxiliaryInvocationTimeoutError ||
          error instanceof ProviderInvocationInFlightError
        ) {
          await this.recoverFromStalledConnectionStateProbe(
            client,
            attemptId,
            error
          );
          return;
        }
      }

      if (
        !this.isActiveClientConnectionAttempt(client, attemptId) ||
        this.status !== Status.connecting ||
        this.connectionEstablished
      ) {
        this.clearConnectionStateProbe();
        return;
      }

      const nowMs = Date.now();
      const activeCheckpointDeferralMs =
        checkpointDeferralStartedAt === undefined
          ? 0
          : nowMs - checkpointDeferralStartedAt;
      const elapsedMs =
        nowMs -
        startedAt -
        checkpointDeferredDurationMs -
        activeCheckpointDeferralMs;
      if (
        sessionRestoreProbeEnabled &&
        (waState === 'UNPAIRED' || waState === 'UNPAIRED_IDLE') &&
        !this.qrReadSessionActive &&
        !this.qrReadSessionLocked
      ) {
        unpairedSinceMs ??= nowMs;
        if (nowMs - unpairedSinceMs >= WWEBJS_UNPAIRED_PERSISTENCE_MS) {
          this.clearConnectionStateProbe();
          await this.handlePersistentUnpaired(client, attemptId, waState);
          return;
        }
      } else if (waState !== undefined) {
        unpairedSinceMs = undefined;
      }

      if (
        waState === 'CONNECTED' &&
        this.getClientIdentityJid(client) &&
        (readyObserved || elapsedMs >= CONNECTION_STATE_READY_GRACE_MS) &&
        (await this.ensureClientEventBridgeReady(client))
      ) {
        if (
          this.isActiveClientConnectionAttempt(client, attemptId) &&
          this.status === Status.connecting &&
          !this.connectionEstablished
        ) {
          const marked = await this.confirmReadyAndMarkConnected(
            client,
            attemptId,
            proxy,
            'state_probe'
          );

          if (marked) {
            return;
          }

          // Session/browser readiness succeeded and only the Kafka/notification
          // barrier is pending. From this point onward the Kafka-only retry owns
          // reconciliation; the state probe must not reach its destructive
          // timeout and recreate an otherwise healthy WhatsApp client.
          if (this.hasKafkaReadinessRetryFor(client, attemptId)) {
            this.clearConnectionStateProbe();
            return;
          }
        }
      }

      if (this.isQrReadSessionInProgress()) {
        // The QR lifecycle owns its own five-generation deadline. The generic
        // connection probe must not destroy Chromium at 120 seconds while a
        // current QR is still readable or waiting for its explicit refresh.
        scheduleProbe();
        return;
      }

      if (elapsedMs >= reconcileTimeoutMs) {
        this.clearConnectionStateProbe();

        const allowActiveQrLifecycle = this.canContinueQrReadSession();
        if (this.shouldScheduleRetryAfterDisconnect(allowActiveQrLifecycle)) {
          this.invalidateClientConnectionAttempt(client);
          this.setStatus(Status.disconnected, ECodeMessage.connectionLost);
          this.pendingResolve?.(this.state());
          this.pendingResolve = undefined;
          this.queueTeardown('connection_state_probe_timeout', async () => {
            const terminated = await this.destroyClientWithTimeout(
              client,
              'connection_state_probe_timeout'
            );
            if (!terminated) {
              return false;
            }
            if (this.client === client) {
              this.client = undefined;
            }
            this.clearChromiumProfileLock();
            return true;
          });
          await this.waitForPendingTeardown();
          if (this.sessionLifecycleTerminationUnconfirmed) {
            return;
          }
          if (!allowActiveQrLifecycle) {
            this.resetQrReadSession();
            this.qrReadSessionLocked = false;
          }
          if (allowActiveQrLifecycle) {
            this.scheduleNextReconnectAttempt(true, true);
          } else {
            this.scheduleNextReconnectAttempt(true);
          }
        }

        return;
      }

      scheduleProbe();
    };

    scheduleProbe();
  }

  private async recoverFromStalledConnectionStateProbe(
    client: Client,
    attemptId: number,
    error: unknown
  ): Promise<void> {
    if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
      return;
    }

    this.clearConnectionStateProbe();
    this.invalidateClientConnectionAttempt(client);
    this.setStatus(Status.disconnected, ECodeMessage.connectionLost);
    this.pendingResolve?.(this.state());
    this.pendingResolve = undefined;
    this.logDebug('wwebjs.provider.connection_state_probe_stalled', {
      trace_id: this.debugTraceId,
      layer: 'wwebjs',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.wwebjs,
      connection_attempt_id: this.connectionAttemptId,
      runtime_generation: this.runtimeGeneration,
      reason: getErrorMessage(error),
    });

    this.queueTeardown('connection_state_probe_stalled', async () => {
      const terminated =
        await this.forceTerminateClientRuntimeWithoutSdkOverlap(
          client,
          'connection_state_probe_stalled'
        );
      if (!terminated) {
        return false;
      }
      if (this.client === client) {
        this.client = undefined;
      }
      this.clearChromiumProfileLock();
      return true;
    });
    await this.waitForPendingTeardown();
    if (this.sessionLifecycleTerminationUnconfirmed) {
      return;
    }

    this.resetQrReadSession();
    this.qrReadSessionLocked = false;
    this.scheduleNextReconnectAttempt(true);
  }

  private confirmReadyAndMarkConnected(
    client: Client,
    attemptId: number,
    proxy: ReturnType<typeof readProxyConfig>,
    source: WwebjsReadyConfirmationSource
  ): Promise<boolean> {
    if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
      return Promise.resolve(false);
    }

    if (
      usesPostgresSessionStorage() &&
      !this.clientsWithDurableRemoteCheckpoint.has(client)
    ) {
      return Promise.resolve(false);
    }

    if (
      this.connectionEstablished &&
      this.status === Status.connected &&
      this.centralOnlineAcknowledged
    ) {
      return Promise.resolve(true);
    }

    const existingFlight = this.clientReadyConfirmationFlights.get(client);
    if (existingFlight?.attemptId === attemptId) {
      return existingFlight.promise;
    }

    const promise = this.runReadyConfirmation(client, attemptId, proxy, source);
    const flight = { attemptId, promise };
    this.clientReadyConfirmationFlights.set(client, flight);
    const clearFlight = (): void => {
      if (this.clientReadyConfirmationFlights.get(client) === flight) {
        this.clientReadyConfirmationFlights.delete(client);
      }
    };
    void promise.then(clearFlight, clearFlight);
    return promise;
  }

  private async runReadyConfirmation(
    client: Client,
    attemptId: number,
    proxy: ReturnType<typeof readProxyConfig>,
    source: WwebjsReadyConfirmationSource
  ): Promise<boolean> {
    if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
      return false;
    }

    // Native readiness proves that the transient transport disconnect
    // recovered. Keep the central status unchanged while the fresh Kafka
    // assignment seeks to the end; strong readiness publishes ONLINE below.
    this.cancelTransientDisconnectStatus();
    const releaseProviderRuntimeTransition =
      await this.acquireProviderRuntimeTransition();
    try {
      if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
        return false;
      }
      try {
        await this.recoverProviderRuntimeStopIfNeeded();
      } catch (error) {
        console.error(
          '[WwebjsConnection] Ready confirmation blocked by Kafka consumer stop failure',
          error
        );
        if (this.isActiveClientConnectionAttempt(client, attemptId)) {
          this.setStatus(Status.connecting, ECodeMessage.awaitConnection, true);
          this.connectionEstablished = false;
          this.scheduleKafkaReadinessRetry(client, attemptId, proxy);
        }
        return false;
      }
      if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
        return false;
      }
      if (
        this.connectionEstablished &&
        this.status === Status.connected &&
        this.centralOnlineAcknowledged
      ) {
        return true;
      }

      let readiness = await this.healthCheckService.verifyCurrentSession();
      if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
        return false;
      }

      if (!readiness.session_ready) {
        if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
          return false;
        }

        this.setStatus(Status.connecting, ECodeMessage.awaitConnection);
        this.connectionEstablished = false;
        if (source !== 'state_probe') {
          this.startConnectionStateProbe(
            client,
            attemptId,
            proxy,
            false,
            source === 'ready' || source === 'native_reconnect'
          );
        }
        console.warn(
          '[WwebjsConnection] Session readiness verification failed',
          {
            source,
            reason:
              readiness.degraded_reason ??
              readiness.reason ??
              'session_not_ready',
            provider_state: readiness.provider_state,
            session_ready: readiness.session_ready,
            can_send: readiness.can_send,
            can_receive_runtime: readiness.can_receive_runtime,
            authenticated: readiness.authenticated,
          }
        );
        const payload: IBaileysConnectionState = {
          status: this.status,
          worker_id: getWorker(),
          account_id: getAccount(),
          code: this.code,
          phone: this.getClientPhone(client),
          worker_status_id: EWorkerStatus.disponible,
          connection_attempt_id: this.connectionAttemptId,
          runtime_generation: this.runtimeGeneration,
          debug_trace_id: this.debugTraceId,
          session_ready: false,
          can_send: readiness.can_send,
          can_receive_runtime: readiness.can_receive_runtime,
          authenticated: readiness.authenticated,
          provider_state: readiness.provider_state,
          degraded_reason:
            readiness.degraded_reason ??
            readiness.reason ??
            'session_not_ready',
          last_probe_at: readiness.last_probe_at,
          probe_latency_ms: readiness.probe_latency_ms,
        };

        this.publishSub(payload, true);
        this.healthCheckService.markStatusPublished(readiness);
        void this.notifyWorkerStatusSafely(
          payload,
          `${source}_verification_failed`
        );
        this.resolvePendingState(payload);
        return false;
      }

      if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
        return false;
      }

      let runtimeActivation: WwebjsProviderRuntimeActivation | undefined;
      let kafkaConsumersStarted = false;
      try {
        runtimeActivation = this.claimValidatedProviderRuntimeActivation(
          client,
          attemptId
        );
        if (!(await this.incomingMessageService.prepareConnectionFence())) {
          throw new Error('whatsapp_runtime_fence_activation_failed');
        }
        if (!this.isActiveProviderRuntimeActivation(runtimeActivation)) {
          await this.stopProviderRuntimeActivationIfOwned(
            runtimeActivation,
            'stale ready runtime fence'
          );
          return false;
        }
        await emitWorkerProviderRuntimeState('wwebjs', true);
        kafkaConsumersStarted = true;
        if (!this.isActiveProviderRuntimeActivation(runtimeActivation)) {
          await this.stopProviderRuntimeActivationIfOwned(
            runtimeActivation,
            'stale ready confirmation'
          );
          return false;
        }
        readiness = await this.healthCheckService.verifyCurrentSession();
        if (!this.isActiveProviderRuntimeActivation(runtimeActivation)) {
          await this.stopProviderRuntimeActivationIfOwned(
            runtimeActivation,
            'stale readiness verification'
          );
          return false;
        }
        if (
          readiness.session_ready !== true ||
          readiness.can_send !== true ||
          readiness.can_receive_runtime !== true ||
          readiness.authenticated !== true
        ) {
          throw new Error(
            readiness.degraded_reason ??
              readiness.reason ??
              'provider_became_unavailable_during_consumer_startup'
          );
        }

        if (!(await this.incomingMessageService.markConnectionReady())) {
          throw new Error('whatsapp_runtime_fence_activation_failed');
        }
      } catch (error) {
        if (!runtimeActivation) {
          await this.handleSessionActivationValidationFailure(
            client,
            attemptId,
            getErrorMessage(error)
          );
          return false;
        }
        const preserveProviderRuntime = isKafkaConsumerReadinessPending(error);
        if (!preserveProviderRuntime) {
          this.incomingMessageService.markConnectionUnavailable(client);
        }
        if (!this.isActiveProviderRuntimeActivation(runtimeActivation)) {
          await this.stopProviderRuntimeActivationIfOwned(
            runtimeActivation,
            'stale Kafka consumer startup'
          );
          return false;
        }
        if (!preserveProviderRuntime) {
          await this.stopProviderRuntimeActivationIfOwned(
            runtimeActivation,
            kafkaConsumersStarted
              ? 'provider readiness failure after Kafka startup'
              : 'Kafka consumer startup failure'
          );
        }
        if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
          return false;
        }
        this.setStatus(Status.connecting, ECodeMessage.awaitConnection, true);
        this.connectionEstablished = false;
        if (kafkaConsumersStarted) {
          if (source !== 'state_probe') {
            this.startConnectionStateProbe(client, attemptId, proxy);
          }
        } else {
          this.scheduleKafkaReadinessRetry(client, attemptId, proxy);
        }
        const degradedReason = getErrorMessage(error);
        const unavailablePayload: IBaileysConnectionState = {
          status: this.status,
          worker_id: getWorker(),
          account_id: getAccount(),
          code: this.code,
          phone: this.getClientPhone(client),
          worker_status_id: EWorkerStatus.disponible,
          connection_attempt_id: this.connectionAttemptId,
          runtime_generation: this.runtimeGeneration,
          debug_trace_id: this.debugTraceId,
          session_ready: false,
          can_send: false,
          can_receive_runtime: readiness.can_receive_runtime,
          authenticated: readiness.authenticated,
          provider_state: preserveProviderRuntime
            ? 'kafka_consumers_not_ready'
            : kafkaConsumersStarted
              ? (readiness.provider_state ?? 'provider_not_ready')
              : 'kafka_consumers_not_ready',
          degraded_reason: degradedReason,
          last_probe_at: readiness.last_probe_at,
          probe_latency_ms: readiness.probe_latency_ms,
        };
        this.publishSub(unavailablePayload, true);
        if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
          return false;
        }
        await this.notifyWorkerStatusSafely(
          unavailablePayload,
          kafkaConsumersStarted
            ? `${source}_provider_readiness_failed`
            : `${source}_kafka_consumers_failed`
        );
        if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
          return false;
        }
        this.resolvePendingState(unavailablePayload);
        return false;
      }

      if (!this.isActiveProviderRuntimeActivation(runtimeActivation)) {
        this.incomingMessageService.markConnectionUnavailable(client);
        await this.stopProviderRuntimeActivationIfOwned(
          runtimeActivation,
          'stale ready status publication'
        );
        return false;
      }
      const phone = this.getClientPhone(client);

      const payload: IBaileysConnectionState = {
        status: Status.connected,
        worker_id: getWorker(),
        account_id: getAccount(),
        code: ECodeMessage.connectionEstablished,
        phone,
        worker_status_id: EWorkerStatus.online,
        connection_attempt_id: this.connectionAttemptId,
        runtime_generation: this.runtimeGeneration,
        debug_trace_id: this.debugTraceId,
        session_ready: readiness.session_ready,
        can_send: readiness.can_send,
        can_receive_runtime: readiness.can_receive_runtime,
        authenticated: readiness.authenticated,
        provider_state: readiness.provider_state,
        degraded_reason: readiness.degraded_reason,
        last_probe_at: readiness.last_probe_at,
        probe_latency_ms: readiness.probe_latency_ms,
      };

      return await this.finalizeReadyStatusNotification({
        client,
        attemptId,
        proxy,
        source,
        runtimeActivation,
        readiness,
        payload,
      });
    } finally {
      releaseProviderRuntimeTransition();
    }
  }

  private async finalizeReadyStatusNotification({
    client,
    attemptId,
    proxy,
    source,
    runtimeActivation,
    readiness,
    payload,
  }: WwebjsReadyStatusFinalizationInput): Promise<boolean> {
    if (!this.isActiveProviderRuntimeActivation(runtimeActivation)) {
      this.incomingMessageService.markConnectionUnavailable(client);
      await this.stopProviderRuntimeActivationIfOwned(
        runtimeActivation,
        'stale ready status notification'
      );
      return false;
    }
    if (!this.isCurrentNativeConnectionOnline(client)) {
      this.setCentralOnlineAcknowledged(false);
      return false;
    }

    const notification = await this.notifyWorkerStatusSafely(payload, source);
    if (!this.isActiveProviderRuntimeActivation(runtimeActivation)) {
      await this.stopProviderRuntimeActivationIfOwned(
        runtimeActivation,
        'stale ready notification completion'
      );
      return false;
    }
    if (!this.isCurrentNativeConnectionOnline(client)) {
      this.setCentralOnlineAcknowledged(false);
      return false;
    }

    if (notification.outcome !== 'accepted') {
      return this.handleReadyStatusNotificationFailure({
        client,
        attemptId,
        proxy,
        runtimeActivation,
        notification,
        payload,
      });
    }

    this.clearConnectionStateProbe();
    this.cancelKafkaReadinessRetry();
    this.resetQrReadSession();
    this.qrReadSessionLocked = false;
    this.qrHash = undefined;
    this.retryCount = 0;
    this.clearDisconnectRetryTimer();
    this.setStatus(Status.connected, ECodeMessage.connectionEstablished);
    this.connectionEstablished = true;
    this.setCentralOnlineAcknowledged(true, {
      client,
      attemptId,
      payload,
    });
    this.healthCheckService.markStatusPublished(readiness);
    this.publishSub(payload, true);
    void this.logConnectionIpInLocal(client, proxy);
    this.healthCheckService.start(HEALTH_CHECK_INTERVAL_MS);
    this.resolvePendingState(payload);
    return true;
  }

  private async handleReadyStatusNotificationFailure({
    client,
    attemptId,
    proxy,
    runtimeActivation,
    notification,
    payload,
  }: Omit<WwebjsReadyStatusFinalizationInput, 'source' | 'readiness'> & {
    notification: Exclude<
      WorkerStatusNotificationResult,
      { outcome: 'accepted' }
    >;
  }): Promise<boolean> {
    if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
      return false;
    }

    const isRecoverableFailure =
      notification.outcome === 'failed' &&
      notification.classification === 'recoverable';
    const notificationReason =
      notification.outcome === 'failed'
        ? notification.reason
        : 'unexpected_worker_status_deferral';
    if (!isRecoverableFailure) {
      this.clearConnectionStateProbe();
      this.cancelKafkaReadinessRetry();
      this.incomingMessageService.markConnectionUnavailable(client);
      await this.stopProviderRuntimeActivationIfOwned(
        runtimeActivation,
        'terminal online status rejection'
      );
      this.healthCheckService.stop();
    }
    if (!this.isActiveClientConnectionAttempt(client, attemptId)) {
      return false;
    }

    this.setStatus(Status.connecting, ECodeMessage.awaitConnection, true);
    this.connectionEstablished = false;
    if (isRecoverableFailure) {
      this.scheduleKafkaReadinessRetry(client, attemptId, proxy);
    }
    console.warn(
      '[WwebjsConnection] Connection remains pending because NotifyWorkerStatus failed',
      {
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        connection_attempt_id: payload.connection_attempt_id,
        classification: isRecoverableFailure ? 'recoverable' : 'terminal',
        error: notificationReason,
      }
    );
    return false;
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
      this.clearQrRefreshTimers();
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
    this.clearQrRefreshTimers();
    this.qrReadSessionActive = false;
    this.qrGenerationCount = 0;
  }

  private clearQrRefreshTimers(): void {
    this.qrRefreshGeneration += 1;
    if (this.qrRefreshTimer) {
      clearTimeout(this.qrRefreshTimer);
      this.qrRefreshTimer = undefined;
    }
    if (this.qrRefreshEventTimer) {
      clearTimeout(this.qrRefreshEventTimer);
      this.qrRefreshEventTimer = undefined;
    }
  }

  private isCurrentQrRefresh(
    client: Client,
    attemptId: number,
    generation: number
  ): boolean {
    return (
      generation === this.qrRefreshGeneration &&
      this.isActiveClientConnectionAttempt(client, attemptId) &&
      this.isQrReadSessionInProgress()
    );
  }

  private scheduleQrRefresh(
    client: Client,
    attemptId: number,
    delayMs = QR_REFRESH_INTERVAL_MS
  ): void {
    this.clearQrRefreshTimers();
    if (
      !this.isActiveClientConnectionAttempt(client, attemptId) ||
      !this.isQrReadSessionInProgress()
    ) {
      return;
    }

    const generation = this.qrRefreshGeneration;
    const qrCount = this.qrGenerationCount;
    this.qrRefreshTimer = setTimeout(() => {
      this.qrRefreshTimer = undefined;
      if (!this.isCurrentQrRefresh(client, attemptId, generation)) {
        return;
      }
      if (qrCount >= MAX_QR_GENERATIONS) {
        this.handleQrGenerationLimitReached();
        return;
      }
      void this.refreshQrCode(client, attemptId, generation, qrCount);
    }, delayMs);
    this.qrRefreshTimer.unref?.();
  }

  private async refreshQrCode(
    client: Client,
    attemptId: number,
    generation: number,
    qrCount: number
  ): Promise<void> {
    try {
      const refreshed = await this.invokeProviderLifecycleOperation(
        client,
        'qr_refresh',
        async () => {
          const page = (client as WwebjsClientInternals).pupPage;
          if (!page) return false;
          return page.evaluate(async () => {
            const runtime = globalThis as typeof globalThis & {
              require?: (moduleName: string) => {
                Cmd?: { refreshQR?: () => unknown };
              };
            };
            try {
              const refresh = runtime.require?.('WAWebCmd')?.Cmd?.refreshQR;
              if (typeof refresh !== 'function') return false;
              await Promise.resolve(refresh());
              return true;
            } catch {
              return false;
            }
          });
        },
        CONNECTION_PAGE_CHECK_TIMEOUT_MS,
        true
      );
      if (!refreshed) {
        throw new Error('wwebjs_qr_refresh_unavailable');
      }
    } catch (error) {
      if (!this.isCurrentQrRefresh(client, attemptId, generation)) {
        return;
      }
      if (
        error instanceof CanonicalActivationCheckpointProbeDeferredError ||
        isProviderInvocationCapacityError(error)
      ) {
        this.scheduleQrRefresh(client, attemptId, QR_REFRESH_CAPACITY_RETRY_MS);
        return;
      }
      await this.recoverQrReadSessionAfterAuthFailure(
        client,
        workerErrorFailureReason('wwebjs_qr_refresh_failed', error)
      );
      return;
    }

    if (!this.isCurrentQrRefresh(client, attemptId, generation)) {
      return;
    }
    this.qrRefreshEventTimer = setTimeout(() => {
      this.qrRefreshEventTimer = undefined;
      if (
        !this.isCurrentQrRefresh(client, attemptId, generation) ||
        this.qrGenerationCount !== qrCount
      ) {
        return;
      }
      void this.recoverQrReadSessionAfterAuthFailure(
        client,
        'wwebjs_qr_refresh_event_timeout'
      );
    }, QR_REFRESH_EVENT_TIMEOUT_MS);
    this.qrRefreshEventTimer.unref?.();
  }

  private isQrReadSessionInProgress(): boolean {
    return (
      this.typeConnection === EBaileysConnectionType.qrcode &&
      this.qrReadSessionActive &&
      !this.qrReadSessionLocked
    );
  }

  private canContinueQrReadSession(): boolean {
    return (
      this.isQrReadSessionInProgress() &&
      this.qrGenerationCount < MAX_QR_GENERATIONS
    );
  }

  private shouldScheduleRetryAfterDisconnect(
    allowActiveQrLifecycle = this.canContinueQrReadSession()
  ): boolean {
    if (
      this.postgresLeaseRecoveryRequired &&
      this.postgresLeaseRecoveryResumeGeneration !==
        this.postgresLeaseRecoveryGeneration
    ) {
      return false;
    }
    if (
      this.userRequestedDisconnect ||
      this.sessionLifecycleTerminationUnconfirmed
    ) {
      return false;
    }

    if (!this.initialConnection && !allowActiveQrLifecycle) {
      return false;
    }

    if (!this.hasSession() && !allowActiveQrLifecycle) {
      return false;
    }

    return true;
  }

  private handlePostgresSessionLeaseLost(error: Error): void {
    if (
      this.userRequestedDisconnect ||
      this.providerHandoffKey ||
      this.isTerminalSessionDisconnectCode(this.code)
    ) {
      this.clearDisconnectRetryTimer();
      return;
    }
    const duplicateSignalForCurrentLoss =
      this.postgresLeaseRecoveryRequired &&
      this.postgresLeaseRecoveryResumeGeneration === undefined;
    if (!duplicateSignalForCurrentLoss) {
      this.postgresLeaseRecoveryRequired = true;
      this.postgresLeaseRecoveryGeneration += 1;
      this.postgresLeaseRecoveryResumeGeneration = undefined;
    }
    this.setCentralOnlineAcknowledged(false);
    this.connectionEstablished = false;
    this.clearDisconnectRetryTimer();
    this.clearConnectionStateProbe();
    this.cancelKafkaReadinessRetry();
    this.incomingMessageService.unbind();
    if (duplicateSignalForCurrentLoss) return;

    const listeners = [...this.postgresSessionLeaseLostListeners];
    void Promise.allSettled(
      listeners.map((listener) => Promise.resolve(listener(error)))
    ).then((outcomes) => {
      outcomes.forEach((outcome) => {
        if (outcome.status === 'rejected') {
          console.error(
            '[WwebjsConnection] Session lease-loss handler failed',
            {
              ...workerErrorDiagnostics(outcome.reason),
            }
          );
        }
      });
    });
  }

  private async recoverQrReadSessionAfterAuthFailure(
    client: Client,
    reason: string
  ): Promise<void> {
    this.clearQrRefreshTimers();
    if (this.qrGenerationCount >= MAX_QR_GENERATIONS) {
      this.handleQrGenerationLimitReached();
      return;
    }

    this.invalidateClientConnectionAttempt(client);
    this.connectionEstablished = false;
    this.connecting = false;
    this.currentPromise = undefined;
    this.activeConnectionAttemptId = undefined;
    this.clearConnectionStateProbe();
    this.setStatus(Status.connecting, ECodeMessage.awaitingReadQrCode);
    const payload = this.state(undefined, undefined, {
      qr_pending: true,
      reason,
      attempt: this.qrGenerationCount,
      max_attempts: MAX_QR_GENERATIONS,
      worker_status_id: EWorkerStatus.disponible,
    });
    this.publishTelemetry(payload);
    this.pendingResolve?.(payload);
    this.pendingResolve = undefined;
    this.incomingMessageService.unbind();
    if (this.client === client) {
      this.client = undefined;
    }
    this.queueTeardown('qr_auth_failure', async () => {
      const terminated = await this.destroyClientWithTimeout(
        client,
        'qr_auth_failure'
      );
      if (terminated) {
        this.clearChromiumProfileLock();
      }
      return terminated;
    });
    await this.waitForPendingTeardown();
    if (!this.sessionLifecycleTerminationUnconfirmed) {
      this.scheduleNextReconnectAttempt(false, true);
    }
  }

  private isTerminalSessionDisconnectCode(code: ECodeMessage): boolean {
    return [
      ECodeMessage.loggedOut,
      ECodeMessage.multideviceMismatch,
      ECodeMessage.connectionReplaced,
      ECodeMessage.badSession,
    ].includes(code);
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
      connection_attempt_id: this.connectionAttemptId,
      debug_trace_id: this.debugTraceId,
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

  private cancelAttempt(
    skipDestroy = false,
    providerRuntimeAlreadyStopped = false
  ): void {
    this.invalidatePendingConnectionInvocations();
    this.clearQrRefreshTimers();
    this.clearConnectionStateProbe();
    this.invalidateClientConnectionAttempt();
    this.pendingResolve?.(this.state());
    this.pendingResolve = undefined;
    this.currentPromise = undefined;
    this.activeConnectionAttemptId = undefined;
    this.connecting = false;
    this.connectionEstablished = false;
    if (!providerRuntimeAlreadyStopped) {
      this.stopProviderRuntime('connection attempt cancellation');
    }
    this.clearDisconnectRetryTimer();
    this.incomingMessageService.unbind();

    if (!skipDestroy && this.client) {
      const clientToDestroy = this.client;
      this.client = undefined;

      this.queueTeardown('cancel_attempt', async () => {
        const terminated = await this.destroyClientWithTimeout(
          clientToDestroy,
          'cancel_attempt'
        );
        if (!terminated) {
          return false;
        }
        this.clearChromiumProfileLock();
        return true;
      });
    } else if (!skipDestroy) {
      this.releaseSessionLifecycleLease();
    }
  }

  private async terminateBrowserRuntimesBeforeProfileMutation(
    operation: string,
    preferredClient = this.client,
    forceLogoutPreferred = false,
    providerRuntimeAlreadyStopped = false
  ): Promise<boolean> {
    await this.waitForPendingTeardown();
    if (this.sessionLifecycleTerminationUnconfirmed) {
      return false;
    }

    const clients = new Set(this.browserRuntimeClients);
    if (preferredClient) {
      clients.add(preferredClient);
    }
    if (this.client) {
      clients.add(this.client);
    }

    const orderedClients = [...clients].filter(
      (client) => client !== preferredClient
    );
    if (preferredClient && clients.has(preferredClient)) {
      orderedClients.push(preferredClient);
    }

    for (const clientToDestroy of orderedClients) {
      const terminated = await this.safeDestroy(
        forceLogoutPreferred && clientToDestroy === preferredClient,
        clientToDestroy,
        providerRuntimeAlreadyStopped,
        false
      );
      if (!terminated) {
        this.markSessionLifecycleTerminationUnconfirmed(operation);
        return false;
      }
    }

    if (this.browserRuntimeClients.size > 0) {
      this.markSessionLifecycleTerminationUnconfirmed(
        `${operation}:tracked_browser_runtime_remains`
      );
      return false;
    }

    this.clearChromiumProfileLock();
    return true;
  }

  private async safeDestroy(
    forceLogout = false,
    clientToDestroy = this.client,
    providerRuntimeAlreadyStopped = false,
    clearProfileLockAfterTermination = true
  ): Promise<boolean> {
    this.clearDisconnectRetryTimer();
    this.clearConnectionStateProbe();

    if (!clientToDestroy) {
      return true;
    }

    let logoutProviderStalled = false;
    if (forceLogout) {
      try {
        await this.invokeProviderLifecycleOperation(
          clientToDestroy,
          'logout',
          () => clientToDestroy.logout()
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        logoutProviderStalled =
          error instanceof ProviderAuxiliaryInvocationTimeoutError ||
          error instanceof ProviderInvocationInFlightError;
        this.saveLogWppConnection({
          worker_id: getWorker(),
          status: Status.disconnected,
          code: ECodeMessage.connectionLost,
          message: logoutProviderStalled
            ? 'Logout provider operation stalled'
            : 'Error during logout',
          date: new Date(),
        });
      }
    }

    await this.flushNativeConnectionStatusPersistence(
      'safe_destroy_before_browser_termination'
    );

    let runtimeTerminated = false;
    try {
      runtimeTerminated = logoutProviderStalled
        ? await this.forceTerminateClientRuntimeWithoutSdkOverlap(
            clientToDestroy,
            'safe_destroy:logout_stalled'
          )
        : await this.destroyClientWithTimeout(clientToDestroy, 'safe_destroy');
    } catch {
      this.saveLogWppConnection({
        worker_id: getWorker(),
        status: Status.disconnected,
        code: ECodeMessage.connectionLost,
        message: 'Error during destroy',
        date: new Date(),
      });
    }

    if (!runtimeTerminated) {
      return false;
    }

    if (this.client === clientToDestroy) {
      this.client = undefined;
    }
    if (clearProfileLockAfterTermination) {
      this.clearChromiumProfileLock();
    }
    this.setStatus(
      Status.disconnected,
      forceLogout ? ECodeMessage.loggedOut : ECodeMessage.connectionLost,
      providerRuntimeAlreadyStopped
    );
    return true;
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

  private setStatus(
    s: Status,
    c?: ECodeMessage,
    providerRuntimeAlreadyStopped = false
  ): void {
    this.status = s;
    if (s !== Status.connected) {
      this.setCentralOnlineAcknowledged(false);
    }
    if (s !== Status.connected && !providerRuntimeAlreadyStopped) {
      this.stopProviderRuntime('status change');
    }
    if (c) {
      this.code = c;
      if (this.isTerminalSessionDisconnectCode(c)) {
        this.postgresSessionEvidenceGeneration += 1;
        this.postgresSessionKnown = false;
        this.postgresLeaseRecoveryRequired = false;
        this.postgresLeaseRecoveryGeneration += 1;
        this.postgresLeaseRecoveryResumeGeneration = undefined;
      }
    }
  }

  private getConfirmedOnlineState(
    client: Client,
    attemptId: number,
    connectionAttemptId: string | undefined,
    runtimeGeneration: number | undefined
  ): IBaileysConnectionState | undefined {
    const confirmation = this.confirmedOnlineState;
    if (
      !this.centralOnlineAcknowledged ||
      !this.connectionEstablished ||
      this.status !== Status.connected ||
      confirmation?.client !== client ||
      confirmation.attemptId !== attemptId ||
      confirmation.payload.connection_attempt_id !== connectionAttemptId ||
      confirmation.payload.runtime_generation !== runtimeGeneration
    ) {
      return undefined;
    }

    return { ...confirmation.payload };
  }

  private setCentralOnlineAcknowledged(
    acknowledged: boolean,
    confirmation?: WwebjsConfirmedOnlineState
  ): void {
    this.centralOnlineAcknowledged = acknowledged;
    this.confirmedOnlineState = acknowledged ? confirmation : undefined;
    setWorkerKafkaDispatchAuthorized(acknowledged);
  }

  private isCurrentNativeConnectionOnline(client: Client): boolean {
    if (!this.nativeConnectionStatusSource) {
      // Backward-compatible fallback for providers without the native status
      // extension. Strong readiness is still proven by the health check.
      return true;
    }

    const source = client as unknown as IWhatsappConnectionStatusEventSource;
    if (
      this.nativeConnectionStatusSource !== (source as unknown as object) ||
      typeof source.getConnectionStatus !== 'function'
    ) {
      return false;
    }

    try {
      this.acceptNativeConnectionStatus(
        source,
        source.getConnectionStatus(),
        false
      );
    } catch {
      return false;
    }

    return (
      this.nativeConnectionStatusSource === (source as unknown as object) &&
      isWhatsappConnectionOnline(this.nativeConnectionStatus)
    );
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
      session_storage: getWwebjsSessionStorage(),
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
      if (
        this.typeConnection === EBaileysConnectionType.qrcode &&
        this.qrReadSessionActive
      ) {
        result.attempt = extras.attempt ?? Math.max(this.qrGenerationCount, 1);
        result.max_attempts = extras.max_attempts ?? MAX_QR_GENERATIONS;
      } else {
        result.attempt = this.retryCount > 0 ? this.retryCount : 1;
        result.max_attempts = MAX_RETRIES;
      }
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
    const sessionStorage = getWwebjsSessionStorage();
    const activeFence =
      this.incomingMessageService.getActiveRuntimeFenceIdentity?.();
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
      payload.worker_type_id === EWorkerType.wwebjs &&
      payload.session_storage === sessionStorage &&
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
      worker_type_id: EWorkerType.wwebjs,
      session_storage: sessionStorage,
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

  private bindNativeConnectionStatus(client: Client): void {
    const source = client as unknown as IWhatsappConnectionStatusEventSource;
    this.nativeConnectionStatusSource = source as unknown as object;
    this.nativeConnectionStatusSourceId = randomUUID();
    this.nativeConnectionStatus = undefined;
    if (
      typeof source.getConnectionStatus !== 'function' ||
      typeof source.on !== 'function'
    ) {
      this.logDebug('wwebjs.provider.native_connection_status_unavailable', {
        trace_id: this.debugTraceId,
        layer: 'wwebjs',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.wwebjs,
        connection_attempt_id: this.connectionAttemptId,
        runtime_generation: this.runtimeGeneration,
      });
      return;
    }

    source.on('connection_status', (snapshot) => {
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
    source: IWhatsappConnectionStatusEventSource,
    value: unknown,
    publish: boolean
  ): void {
    if (this.nativeConnectionStatusSource !== (source as unknown as object)) {
      return;
    }
    const snapshot = normalizeWhatsappConnectionStatus(value, 'wwebjs');
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
      // status from the same client cannot revoke a newer ONLINE generation.
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

    this.logDebug('wwebjs.provider.native_connection_status', {
      trace_id: this.debugTraceId,
      layer: 'wwebjs',
      worker_id: getWorker(),
      account_id: getAccount(),
      worker_type_id: EWorkerType.wwebjs,
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
    if (isWhatsappConnectionOnline(snapshot)) {
      this.recoverCentralOnlineAcknowledgementAfterNativeReconnect(
        source,
        snapshot.sequence
      );
    }
  }

  private recoverCentralOnlineAcknowledgementAfterNativeReconnect(
    source: IWhatsappConnectionStatusEventSource,
    minimumSequence: number
  ): void {
    const client = this.client;
    const attemptId = client
      ? this.clientConnectionAttemptIds.get(client)
      : undefined;
    if (
      !client ||
      attemptId === undefined ||
      (client as unknown as object) !== (source as unknown as object) ||
      !this.connectionEstablished ||
      this.status !== Status.connected ||
      this.centralOnlineAcknowledged
    ) {
      return;
    }

    void (async () => {
      // Preserve the native outbox ordering: Balance must observe the fresh
      // ONLINE sequence before it can acknowledge and reopen dispatch.
      await this.flushNativeConnectionStatusPersistence('native_reconnect');
      const current = this.nativeConnectionStatus;
      if (
        !this.isActiveClientConnectionAttempt(client, attemptId) ||
        this.nativeConnectionStatusSource !== (source as unknown as object) ||
        !current ||
        current.sequence < minimumSequence ||
        !isWhatsappConnectionOnline(current) ||
        !this.connectionEstablished ||
        this.status !== Status.connected ||
        this.centralOnlineAcknowledged
      ) {
        return;
      }

      await this.confirmReadyAndMarkConnected(
        client,
        attemptId,
        readProxyConfig(),
        'native_reconnect'
      );
    })().catch((error) => {
      console.error(
        '[WwebjsConnection] Native reconnect acknowledgement recovery failed',
        workerErrorDiagnostics(error)
      );
    });
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
      ? this.postgresSessionStore?.getConnectionStatusLeaseProof()
      : undefined;
    if (requiresLeaseProof && !leaseProof) {
      this.logDebug(
        'wwebjs.provider.native_connection_status_persistence_rejected',
        {
          trace_id: this.debugTraceId,
          layer: 'wwebjs',
          worker_id: getWorker(),
          account_id: getAccount(),
          worker_type_id: EWorkerType.wwebjs,
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
      'wwebjs.provider.native_connection_status_persistence_pending',
      {
        trace_id: this.debugTraceId,
        layer: 'wwebjs',
        worker_id: getWorker(),
        account_id: getAccount(),
        worker_type_id: EWorkerType.wwebjs,
        runtime_generation: this.runtimeGeneration,
        reason: operation,
      }
    );
  }

  private logNativeConnectionStatusPersistenceFailure(
    failure: NativeConnectionStatusPersistenceFailure<WwebjsNativeConnectionStatusPersistencePayload>
  ): void {
    console.error('[WwebjsConnection] Native status persistence failed', {
      source_id: failure.item.sourceId,
      sequence: failure.item.sequence,
      status: failure.item.payload.state.connection_status?.status,
      retrying: failure.retrying,
      ...workerErrorDiagnostics(failure.error),
    });
  }

  private attachConnectionMetadata(
    payload: IBaileysConnectionState
  ): IBaileysConnectionState {
    Object.assign(payload, this.withConnectionMetadata(payload));
    return payload;
  }

  private publishSub(payload: IBaileysConnectionState, force = false): void {
    void this.publishSubWithCompletion(payload, force);
  }

  private async publishSubWithCompletion(
    payload: IBaileysConnectionState,
    force = false
  ): Promise<void> {
    const payloadWithConnectionMetadata = this.withConnectionMetadata(payload);
    this.logDebug('wwebjs.provider.status_staged', {
      trace_id: payloadWithConnectionMetadata.debug_trace_id,
      layer: 'wwebjs',
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
      console.error('[WwebjsConnection] Runtime telemetry failed', {
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
      this.logDebug('wwebjs.provider.central_status_deferred', {
        trace_id: payloadWithConnectionMetadata.debug_trace_id,
        layer: 'wwebjs',
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
      this.logDebug('wwebjs.provider.notify_status', {
        trace_id: payloadWithConnectionMetadata.debug_trace_id,
        layer: 'wwebjs',
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
        throw new Error('wwebjs_online_native_connection_status_unavailable');
      }
      if (claimsStrongOnline) {
        payloadWithConnectionMetadata.connection_status = currentNativeStatus;
      }
      const requiresLeaseProof =
        usesPostgresSessionStorage() &&
        claimsStrongOnline &&
        isWhatsappConnectionOnline(nativeStatus);
      const leaseProof = requiresLeaseProof
        ? this.postgresSessionStore?.getConnectionStatusLeaseProof()
        : undefined;
      if (requiresLeaseProof && !leaseProof) {
        throw new Error(
          'wwebjs_online_connection_status_lease_proof_unavailable'
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
      console.error('[WwebjsConnection] NotifyWorkerStatus failed', {
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
      phone: this.client ? this.getClientPhone(this.client) : undefined,
      worker_status_id: EWorkerStatus.mismatched,
      connection_attempt_id: this.connectionAttemptId,
      debug_trace_id: this.debugTraceId,
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
