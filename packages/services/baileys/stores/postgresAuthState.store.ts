import { randomUUID } from 'node:crypto';
import type {
  AuthenticationState,
  SignalDataTypeMap,
} from '@whiskeysockets/baileys';
import * as BaileysModule from '@whiskeysockets/baileys';
import type { Pool } from 'pg';
import { getWorkerPostgresPool } from '@core/services/workerPostgresPool';

export const BAILEYS_POSTGRES_RECORD_CODEC_VERSION = 1;
export const BAILEYS_POSTGRES_SESSION_FORMAT =
  'baileys-provider-record-protobuf-v1';
export const BAILEYS_POSTGRES_SESSION_API_VERSION = 3;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITIVE_BIGINT_PATTERN = /^[1-9][0-9]*$/;
const DEFAULT_LEASE_TTL_MS = 30_000;
const DEFAULT_RENEW_INTERVAL_MS = 5_000;
const DEFAULT_LEASE_SAFETY_MARGIN_MS = 5_000;
const PQ_STATE_ID = 'state';
const PQ_CODEC_VERSION = 1;
const PQ_ALGORITHM = 'ML-KEM-1024';
const PQ_MAX_KEY_ID_EXCLUSIVE = 16_777_215;
const PQ_PUBLIC_KEY_BYTES = 1_568;
const PQ_PRIVATE_KEY_BYTES = 3_168;
const PQ_SIGNATURE_BYTES = 64;

type NativeLogger = {
  level: string;
  child(bindings: Record<string, unknown>): NativeLogger;
  trace(object: unknown, message?: string): void;
  debug(object: unknown, message?: string): void;
  info(object: unknown, message?: string): void;
  warn(object: unknown, message?: string): void;
  error(object: unknown, message?: string): void;
};

type NativeImportRecord = {
  category: 'creds' | keyof SignalDataTypeMap | 'legacy-file';
  id: string;
  value: unknown;
};

type NativeStagedRevision = {
  revisionId: string;
  previousActiveRevisionId?: string;
  previousRevisionId?: string;
  expectedJid?: string;
  expectedLid?: string;
  expectedDeviceFingerprint?: string;
};

type NativeProviderHandoffInput = {
  handoffId: string;
  lifecycleOperationId: string;
  sourceRevisionId: string;
  targetProvider: 'wwebjs' | 'whatsmeow';
  traceId?: string;
};

type NativeProviderHandoffCheckpoint = {
  revisionId: string;
  checksumSha256: string;
  sizeBytes: number;
  recordCount: number;
  persistedAt: string;
  handoffId: string;
  lifecycleOperationId: string;
  targetProvider: 'wwebjs' | 'whatsmeow';
};
type NativeCheckpoint = Pick<
  NativeProviderHandoffCheckpoint,
  'revisionId' | 'checksumSha256' | 'sizeBytes' | 'recordCount' | 'persistedAt'
>;

export type BaileysPostQuantumServerRollbackProof = {
  protocol: 'delete_pq_prekeys_server_ack_v1';
  serverAcknowledged: true;
  localCleanupComplete: true;
  acknowledgedAtMs: number;
  responseValidated: true;
  uploadLifecycleFenced: true;
  uploadLifecycleFenceVersion: 1;
};

type BaileysPostQuantumRollbackMarkerBase = {
  handoffId: string;
  lifecycleOperationId: string;
  sourceRevisionId: string;
  targetProvider: 'wwebjs' | 'whatsmeow';
};

export type BaileysPostQuantumRollbackMarker =
  | (BaileysPostQuantumRollbackMarkerBase & {
      state: 'intent';
      uploadLifecycleFenced?: undefined;
      uploadLifecycleFenceVersion?: undefined;
    })
  | (BaileysPostQuantumRollbackMarkerBase & {
      state: 'acknowledged';
      uploadLifecycleFenced: true;
      uploadLifecycleFenceVersion: 1;
    });

type NativePostgresAuthState = {
  state: AuthenticationState;
  saveCreds(): Promise<void>;
  lease: {
    assertUsable(): void;
    snapshot?: {
      sessionId: string;
      ownerId: string;
      fencingToken: string;
    };
  };
  store: { revisionId: string };
  assertFence(): Promise<void>;
  hasRestorableSession(): boolean;
  hasPendingHandoff(): boolean;
  getRevisionInfo(): { revisionId: string; status: string };
  stageImport(
    records: readonly NativeImportRecord[],
    format: string
  ): Promise<NativeStagedRevision>;
  promoteStagedImport(candidate: NativeStagedRevision): Promise<void>;
  rollbackStagedImport(
    candidate: NativeStagedRevision,
    errorCode?: string
  ): Promise<void>;
  promotePendingHandoff(): Promise<boolean>;
  rollbackPendingHandoff(errorCode?: string): Promise<boolean>;
  clearSession(): Promise<void>;
  checkpoint(): Promise<NativeCheckpoint>;
  pauseWritesForHandoff(): void;
  resumeWrites(): void;
  authorizeProviderHandoff(input: NativeProviderHandoffInput): Promise<unknown>;
  beginPostQuantumServerRollback(
    input: NativeProviderHandoffInput
  ): Promise<void>;
  persistPostQuantumServerRollback(
    input: NativeProviderHandoffInput,
    proof: BaileysPostQuantumServerRollbackProof
  ): Promise<void>;
  getPendingPostQuantumServerRollback(): Promise<
    BaileysPostQuantumRollbackMarker | undefined
  >;
  completePostQuantumServerRollbackRecovery(
    marker: BaileysPostQuantumRollbackMarker
  ): Promise<void>;
  prepareProviderHandoff(
    input: NativeProviderHandoffInput
  ): Promise<NativeProviderHandoffCheckpoint>;
  closeForHandoff(): Promise<boolean>;
  close(): Promise<void>;
};

type NativePostgresModule = {
  BAILEYS_POSTGRES_RECORD_CODEC_VERSION?: unknown;
  BAILEYS_POSTGRES_SESSION_FORMAT?: unknown;
  BAILEYS_POSTGRES_SESSION_API_VERSION?: unknown;
  encodeBaileysPostgresRecord?: (value: unknown) => Promise<Uint8Array>;
  decodeBaileysPostgresRecord?: (payload: Uint8Array) => Promise<unknown>;
  usePostgresAuthState?: (options: {
    database: Pool;
    logger: NativeLogger;
    sessionId: string;
    ownerId: string;
    generation: number;
    epoch: string;
    capability: string;
    debug: boolean;
    ttlMs: number;
    renewIntervalMs: number;
    safetyMarginMs: number;
    autoRenew: boolean;
    revisionSource?: 'pairing' | 'legacy_volume_migration';
    storageMigrationId?: string;
    onLost(error: unknown): void | Promise<void>;
  }) => Promise<unknown>;
};

const nativePostgresModule = BaileysModule as unknown as NativePostgresModule;

export type BaileysPostgresAuthStateStoreOptions = {
  workerId: string;
  writerGeneration: number;
  writerEpoch: string;
  runtimeCapability: string;
  pool?: Pool;
  debugEnabled?: boolean;
  leaseTtlMs?: number;
  renewIntervalMs?: number;
  leaseSafetyMarginMs?: number;
  onLeaseLost?: (error: BaileysSessionFenceError) => void | Promise<void>;
};

export type BaileysAuthStateImportRecordInput = NativeImportRecord;

export type BaileysStagedSessionRevision = {
  revisionId: number;
  previousActiveRevisionId: number | null;
  previousRevisionId: number | null;
};

export type BaileysProviderHandoffPrepareInput = {
  accountId: string;
  handoffId: string;
  lifecycleOperationId: string;
  sourceRevisionId: number;
  targetProvider: 'wwebjs' | 'whatsmeow';
  debugTraceId?: string;
};

export type BaileysProviderHandoffCheckpoint = {
  revisionId: number;
  checksumSha256: string;
  sizeBytes: number;
  recordCount: number;
};

export class BaileysSessionFenceError extends Error {
  readonly code: string;
  readonly cause?: unknown;

  constructor(code: string, cause?: unknown) {
    super(code);
    this.name = 'BaileysSessionFenceError';
    this.code = code;
    this.cause = cause;
  }
}

export class BaileysCanonicalCodecError extends Error {
  readonly code: string;
  readonly cause?: unknown;

  constructor(code: string, cause?: unknown) {
    super(code);
    this.name = 'BaileysCanonicalCodecError';
    this.code = code;
    this.cause = cause;
  }
}

function nativeAbiError(detail: string): BaileysSessionFenceError {
  return new BaileysSessionFenceError(
    `baileys_native_postgres_session_abi_incompatible:${detail}`
  );
}

function requireNativeModule(): Required<
  Pick<
    NativePostgresModule,
    | 'encodeBaileysPostgresRecord'
    | 'decodeBaileysPostgresRecord'
    | 'usePostgresAuthState'
  >
> &
  NativePostgresModule {
  if (
    nativePostgresModule.BAILEYS_POSTGRES_SESSION_API_VERSION !==
      BAILEYS_POSTGRES_SESSION_API_VERSION ||
    nativePostgresModule.BAILEYS_POSTGRES_RECORD_CODEC_VERSION !==
      BAILEYS_POSTGRES_RECORD_CODEC_VERSION ||
    nativePostgresModule.BAILEYS_POSTGRES_SESSION_FORMAT !==
      BAILEYS_POSTGRES_SESSION_FORMAT ||
    typeof nativePostgresModule.encodeBaileysPostgresRecord !== 'function' ||
    typeof nativePostgresModule.decodeBaileysPostgresRecord !== 'function' ||
    typeof nativePostgresModule.usePostgresAuthState !== 'function'
  ) {
    throw nativeAbiError('module_exports');
  }
  return nativePostgresModule as Required<
    Pick<
      NativePostgresModule,
      | 'encodeBaileysPostgresRecord'
      | 'decodeBaileysPostgresRecord'
      | 'usePostgresAuthState'
    >
  > &
    NativePostgresModule;
}

const REQUIRED_NATIVE_METHODS = [
  'saveCreds',
  'assertFence',
  'hasRestorableSession',
  'hasPendingHandoff',
  'getRevisionInfo',
  'stageImport',
  'promoteStagedImport',
  'rollbackStagedImport',
  'promotePendingHandoff',
  'rollbackPendingHandoff',
  'clearSession',
  'checkpoint',
  'pauseWritesForHandoff',
  'resumeWrites',
  'authorizeProviderHandoff',
  'beginPostQuantumServerRollback',
  'persistPostQuantumServerRollback',
  'getPendingPostQuantumServerRollback',
  'completePostQuantumServerRollbackRecovery',
  'prepareProviderHandoff',
  'closeForHandoff',
  'close',
] as const;

function assertNativeAuthState(
  value: unknown
): asserts value is NativePostgresAuthState {
  if (!value || typeof value !== 'object') {
    throw nativeAbiError('factory_result');
  }
  const candidate = value as Record<string, unknown>;
  if (
    !candidate.state ||
    typeof candidate.state !== 'object' ||
    !candidate.lease ||
    typeof candidate.lease !== 'object' ||
    typeof (candidate.lease as Record<string, unknown>).assertUsable !==
      'function' ||
    !candidate.store ||
    typeof candidate.store !== 'object' ||
    !POSITIVE_BIGINT_PATTERN.test(
      String((candidate.store as Record<string, unknown>).revisionId ?? '')
    ) ||
    REQUIRED_NATIVE_METHODS.some(
      (method) => typeof candidate[method] !== 'function'
    )
  ) {
    throw nativeAbiError('lifecycle_methods');
  }
}

function mapNativeError(
  error: unknown,
  defaultCode: string,
  options: { deterministicRevisionInvalid?: boolean } = {}
): BaileysSessionFenceError | BaileysCanonicalCodecError {
  if (error instanceof BaileysCanonicalCodecError) return error;
  if (error instanceof BaileysSessionFenceError) return error;
  const nativeCode =
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
      ? error.code
      : defaultCode;
  if (
    nativeCode === 'CODEC_INCOMPATIBLE' ||
    nativeCode === 'PROJECTION_INVALID' ||
    nativeCode === 'SESSION_ISOLATION_VIOLATION' ||
    (nativeCode === 'REVISION_INVALID' &&
      options.deterministicRevisionInvalid === true)
  ) {
    return new BaileysCanonicalCodecError(nativeCode, error);
  }
  return new BaileysSessionFenceError(nativeCode, error);
}

function positiveSafeRevision(value: string, field: string): number {
  if (!POSITIVE_BIGINT_PATTERN.test(value)) {
    throw new BaileysSessionFenceError(
      `baileys_native_${field}_revision_invalid`
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new BaileysSessionFenceError(
      `baileys_native_${field}_revision_unsafe`
    );
  }
  return parsed;
}

function isExactBytes(value: unknown, length: number): value is Uint8Array {
  return value instanceof Uint8Array && value.byteLength === length;
}

async function assertNativePqBootstrapReady(
  native: NativePostgresAuthState
): Promise<void> {
  const keyStore = native.state.keys as unknown as {
    get(type: string, ids: string[]): Promise<Record<string, unknown>>;
  };
  const states = await keyStore.get('pq-pre-key-state', [PQ_STATE_ID]);
  if (!states || typeof states !== 'object' || Array.isArray(states)) {
    throw new BaileysSessionFenceError('baileys_pq_bootstrap_incomplete');
  }
  const state = states[PQ_STATE_ID];
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new BaileysSessionFenceError('baileys_pq_bootstrap_incomplete');
  }
  const value = state as Record<string, unknown>;
  const lastResortKeyId = value.lastResortKeyId;
  if (
    value.codecVersion !== PQ_CODEC_VERSION ||
    value.algorithm !== PQ_ALGORITHM ||
    value.migrated !== true ||
    !Number.isSafeInteger(lastResortKeyId) ||
    (lastResortKeyId as number) < 0 ||
    (lastResortKeyId as number) >= PQ_MAX_KEY_ID_EXCLUSIVE ||
    !Array.isArray(value.pendingPreKeyIds) ||
    value.pendingPreKeyIds.length !== 0
  ) {
    throw new BaileysSessionFenceError('baileys_pq_bootstrap_incomplete');
  }

  const keyId = (lastResortKeyId as number).toString();
  const lastResortKeys = await keyStore.get('pq-last-resort-key', [keyId]);
  if (
    !lastResortKeys ||
    typeof lastResortKeys !== 'object' ||
    Array.isArray(lastResortKeys)
  ) {
    throw new BaileysSessionFenceError('baileys_pq_bootstrap_incomplete');
  }
  const lastResort = lastResortKeys[keyId];
  if (
    !lastResort ||
    typeof lastResort !== 'object' ||
    Array.isArray(lastResort)
  ) {
    throw new BaileysSessionFenceError('baileys_pq_bootstrap_incomplete');
  }
  const key = lastResort as Record<string, unknown>;
  const keyPair = key.keyPair;
  if (!keyPair || typeof keyPair !== 'object' || Array.isArray(keyPair)) {
    throw new BaileysSessionFenceError('baileys_pq_bootstrap_incomplete');
  }
  const pair = keyPair as Record<string, unknown>;
  if (
    key.keyId !== lastResortKeyId ||
    key.sentToServer !== true ||
    !isExactBytes(pair.public, PQ_PUBLIC_KEY_BYTES) ||
    !isExactBytes(pair.private, PQ_PRIVATE_KEY_BYTES) ||
    !isExactBytes(key.signature, PQ_SIGNATURE_BYTES)
  ) {
    throw new BaileysSessionFenceError('baileys_pq_bootstrap_incomplete');
  }
}

function validateOptions(options: BaileysPostgresAuthStateStoreOptions): void {
  if (!UUID_PATTERN.test(options.workerId)) {
    throw new Error('WORKER_ID must be a UUID for PostgreSQL session storage');
  }
  if (
    !Number.isSafeInteger(options.writerGeneration) ||
    options.writerGeneration <= 0
  ) {
    throw new Error(
      'RUNTIME_GENERATION must be a positive integer for PostgreSQL session storage'
    );
  }
  if (!UUID_PATTERN.test(options.writerEpoch)) {
    throw new Error(
      'WORKER_WRITER_EPOCH must be a UUID for PostgreSQL session storage'
    );
  }
  if (
    options.runtimeCapability.length < 32 ||
    options.runtimeCapability.length > 512 ||
    options.runtimeCapability.includes('\0')
  ) {
    throw new Error(
      'WORKER_RUNTIME_CAPABILITY is invalid for PostgreSQL session storage'
    );
  }

  const ttl = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  const renew = options.renewIntervalMs ?? DEFAULT_RENEW_INTERVAL_MS;
  const safety = options.leaseSafetyMarginMs ?? DEFAULT_LEASE_SAFETY_MARGIN_MS;
  if (
    ttl < 5_000 ||
    ttl > 300_000 ||
    renew <= 0 ||
    safety < 0 ||
    ttl <= renew + safety
  ) {
    throw new Error('baileys_postgres_lease_timing_invalid');
  }
}

function nativeLogger(debugEnabled: boolean): NativeLogger {
  const write = (
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error',
    object: unknown,
    message?: string
  ) => {
    if (!debugEnabled && (level === 'trace' || level === 'debug')) return;
    const line = message
      ? `${message} ${JSON.stringify(object)}`
      : JSON.stringify(object);
    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  };
  const logger: NativeLogger = {
    level: debugEnabled ? 'trace' : 'info',
    child: () => logger,
    trace: (object, message) => write('trace', object, message),
    debug: (object, message) => write('debug', object, message),
    info: (object, message) => write('info', object, message),
    warn: (object, message) => write('warn', object, message),
    error: (object, message) => write('error', object, message),
  };
  return logger;
}

export async function encodeBaileysPostgresRecord(
  value: unknown
): Promise<Buffer> {
  try {
    return Buffer.from(
      await requireNativeModule().encodeBaileysPostgresRecord(value)
    );
  } catch (error) {
    throw mapNativeError(error, 'baileys_native_postgres_encode_failed');
  }
}

export async function decodeBaileysPostgresRecord(
  payload: Uint8Array
): Promise<unknown> {
  try {
    return await requireNativeModule().decodeBaileysPostgresRecord(payload);
  } catch (error) {
    throw mapNativeError(error, 'baileys_native_postgres_decode_failed');
  }
}

export class BaileysPostgresAuthStateStore {
  private readonly pool: Pool;
  private readonly debugEnabled: boolean;
  private readonly ownerId = randomUUID();
  private nativeState?: NativePostgresAuthState;
  private nativeStatePromise?: Promise<NativePostgresAuthState>;
  private closePromise?: Promise<void>;
  private closing = false;
  private readonly stagedCandidates = new Map<string, NativeStagedRevision>();

  constructor(private readonly options: BaileysPostgresAuthStateStoreOptions) {
    validateOptions(options);
    requireNativeModule();
    this.pool = options.pool ?? getWorkerPostgresPool();
    this.debugEnabled = options.debugEnabled ?? true;
  }

  static fromEnvironment(
    workerId: string,
    overrides: Pick<BaileysPostgresAuthStateStoreOptions, 'onLeaseLost'> = {}
  ): BaileysPostgresAuthStateStore {
    return new BaileysPostgresAuthStateStore({
      workerId,
      writerGeneration: Number(process.env.RUNTIME_GENERATION),
      writerEpoch: process.env.WORKER_WRITER_EPOCH?.trim() ?? '',
      runtimeCapability: process.env.WORKER_RUNTIME_CAPABILITY?.trim() ?? '',
      debugEnabled:
        process.env.WHATSAPP_SESSION_DEBUG_ENABLED?.trim().toLowerCase() !==
        'false',
      ...overrides,
    });
  }

  hasRestorableSessionCached(): boolean {
    return this.nativeState?.hasRestorableSession() ?? false;
  }

  hasPendingHandoff(): boolean {
    return this.nativeState?.hasPendingHandoff() ?? false;
  }

  getRevisionIdCached(): string | undefined {
    try {
      return this.nativeState?.getRevisionInfo().revisionId;
    } catch {
      return undefined;
    }
  }

  getRevisionInfoCached(): { revisionId: string; status: string } | undefined {
    try {
      return this.nativeState?.getRevisionInfo();
    } catch {
      return undefined;
    }
  }

  getConnectionStatusLeaseProof():
    { ownerId: string; fencingToken: string } | undefined {
    const lease = this.nativeState?.lease;
    if (!lease) return undefined;
    try {
      lease.assertUsable();
    } catch {
      return undefined;
    }
    const snapshot = lease.snapshot;
    if (
      !snapshot ||
      snapshot.sessionId !== this.options.workerId ||
      snapshot.ownerId !== this.ownerId ||
      !UUID_PATTERN.test(snapshot.ownerId) ||
      !POSITIVE_BIGINT_PATTERN.test(snapshot.fencingToken)
    ) {
      return undefined;
    }
    return {
      ownerId: snapshot.ownerId,
      fencingToken: snapshot.fencingToken,
    };
  }

  pauseWritesForHandoff(): void {
    const native = this.requireOpenedNative();
    try {
      native.pauseWritesForHandoff();
    } catch (error) {
      throw mapNativeError(error, 'baileys_native_pause_writes_failed');
    }
  }

  resumeWritesAfterFailedHandoff(): void {
    const native = this.requireOpenedNative();
    try {
      native.resumeWrites();
    } catch (error) {
      throw mapNativeError(error, 'baileys_native_resume_writes_failed');
    }
  }

  async authorizeHandoff(
    input: BaileysProviderHandoffPrepareInput
  ): Promise<void> {
    const nativeInput = this.nativeProviderHandoffInput(input);
    const native = await this.getNative();
    try {
      await native.authorizeProviderHandoff(nativeInput);
    } catch (error) {
      throw mapNativeError(error, 'baileys_native_authorize_handoff_failed');
    }
  }

  async beginPostQuantumServerRollback(
    input: BaileysProviderHandoffPrepareInput
  ): Promise<void> {
    const nativeInput = this.nativeProviderHandoffInput(input);
    const native = await this.getNative();
    try {
      await native.beginPostQuantumServerRollback(nativeInput);
    } catch (error) {
      throw mapNativeError(
        error,
        'baileys_native_pq_server_rollback_intent_failed'
      );
    }
  }

  async persistPostQuantumServerRollback(
    input: BaileysProviderHandoffPrepareInput,
    proof: BaileysPostQuantumServerRollbackProof
  ): Promise<void> {
    const nativeInput = this.nativeProviderHandoffInput(input);
    const native = await this.getNative();
    try {
      await native.persistPostQuantumServerRollback(nativeInput, proof);
    } catch (error) {
      throw mapNativeError(
        error,
        'baileys_native_pq_server_rollback_persist_failed'
      );
    }
  }

  async getPendingPostQuantumServerRollback(): Promise<
    BaileysPostQuantumRollbackMarker | undefined
  > {
    const native = await this.getNative();
    try {
      return await native.getPendingPostQuantumServerRollback();
    } catch (error) {
      throw mapNativeError(
        error,
        'baileys_native_pq_server_rollback_read_failed'
      );
    }
  }

  async checkpointPostQuantumRecovery(): Promise<void> {
    const native = await this.getNative();
    try {
      await native.checkpoint();
    } catch (error) {
      throw mapNativeError(
        error,
        'baileys_native_pq_source_recovery_checkpoint_failed'
      );
    }
  }

  async completePostQuantumServerRollbackRecovery(
    marker: BaileysPostQuantumRollbackMarker
  ): Promise<void> {
    const native = await this.getNative();
    try {
      await native.completePostQuantumServerRollbackRecovery(marker);
    } catch (error) {
      throw mapNativeError(
        error,
        'baileys_native_pq_source_recovery_finalize_failed'
      );
    }
  }

  async openForHandoff(): Promise<{ revisionId: number; status: string }> {
    const native = await this.getNative();
    try {
      await native.assertFence();
      const revision = native.getRevisionInfo();
      return {
        revisionId: positiveSafeRevision(revision.revisionId, 'open'),
        status: revision.status,
      };
    } catch (error) {
      throw mapNativeError(error, 'baileys_native_open_handoff_failed');
    }
  }

  async rollbackPendingHandoff(
    errorCode = 'candidate_validation_failed'
  ): Promise<boolean> {
    const native = await this.getNative();
    try {
      const rolledBack = await native.rollbackPendingHandoff(errorCode);
      if (rolledBack) this.stagedCandidates.clear();
      return rolledBack;
    } catch (error) {
      throw mapNativeError(error, 'baileys_native_pending_rollback_failed');
    }
  }

  async loadAuthenticationState(): Promise<{
    state: AuthenticationState;
    saveCreds: () => Promise<void>;
  }> {
    const native = await this.getNative();
    return { state: native.state, saveCreds: native.saveCreds };
  }

  async assertFence(): Promise<void> {
    const native = await this.getNative();
    try {
      await native.assertFence();
    } catch (error) {
      throw mapNativeError(error, 'baileys_native_fence_failed');
    }
  }

  async stageImport(
    records: readonly BaileysAuthStateImportRecordInput[],
    format: string
  ): Promise<BaileysStagedSessionRevision> {
    const native = await this.getNative();
    try {
      const candidate = await native.stageImport(records, format);
      this.stagedCandidates.set(candidate.revisionId, candidate);
      return {
        revisionId: positiveSafeRevision(candidate.revisionId, 'candidate'),
        previousActiveRevisionId: candidate.previousActiveRevisionId
          ? positiveSafeRevision(
              candidate.previousActiveRevisionId,
              'candidate_source'
            )
          : null,
        previousRevisionId: candidate.previousRevisionId
          ? positiveSafeRevision(
              candidate.previousRevisionId,
              'candidate_previous'
            )
          : null,
      };
    } catch (error) {
      throw mapNativeError(error, 'baileys_native_stage_import_failed');
    }
  }

  async promoteImport(candidate: BaileysStagedSessionRevision): Promise<void> {
    const native = await this.getNative();
    const nativeCandidate = this.nativeCandidate(candidate);
    try {
      await native.promoteStagedImport(nativeCandidate);
      this.stagedCandidates.delete(nativeCandidate.revisionId);
    } catch (error) {
      throw mapNativeError(error, 'baileys_native_promote_import_failed');
    }
  }

  async promoteStagedImportIfReady(): Promise<void> {
    const native = await this.getNative();
    const pendingHandoff = native.hasPendingHandoff();
    if (pendingHandoff) {
      try {
        await assertNativePqBootstrapReady(native);
      } catch (error) {
        const terminalError = new BaileysCanonicalCodecError(
          'baileys_pq_bootstrap_incomplete',
          error
        );
        try {
          const rolledBack = await native.rollbackPendingHandoff(
            'baileys_pq_bootstrap_incomplete'
          );
          if (!rolledBack) {
            throw new Error('baileys_pq_bootstrap_rollback_not_applied');
          }
          this.stagedCandidates.clear();
        } catch (rollbackError) {
          throw new BaileysCanonicalCodecError(
            'baileys_pq_bootstrap_rollback_rejected',
            new AggregateError(
              [terminalError, rollbackError],
              'Baileys PQ bootstrap validation and rollback both failed'
            )
          );
        }
        throw terminalError;
      }
    }

    try {
      if (await native.promotePendingHandoff()) {
        this.stagedCandidates.clear();
      }
    } catch (error) {
      throw mapNativeError(error, 'baileys_native_pending_promotion_failed');
    }
  }

  async rollbackImport(
    candidate: BaileysStagedSessionRevision,
    errorCode = 'candidate_validation_failed'
  ): Promise<void> {
    const native = await this.getNative();
    const nativeCandidate = this.nativeCandidate(candidate);
    try {
      await native.rollbackStagedImport(nativeCandidate, errorCode);
      this.stagedCandidates.delete(nativeCandidate.revisionId);
    } catch (error) {
      throw mapNativeError(error, 'baileys_native_rollback_import_failed');
    }
  }

  async clearSession(): Promise<void> {
    const native = await this.getNative();
    try {
      await native.clearSession();
      this.stagedCandidates.clear();
    } catch (error) {
      throw mapNativeError(error, 'baileys_native_clear_session_failed');
    }
  }

  async prepareHandoff(
    input: BaileysProviderHandoffPrepareInput
  ): Promise<BaileysProviderHandoffCheckpoint> {
    const nativeInput = this.nativeProviderHandoffInput(input);
    const native = await this.getNative();
    try {
      const checkpoint = await native.prepareProviderHandoff(nativeInput);
      return {
        revisionId: positiveSafeRevision(
          checkpoint.revisionId,
          'handoff_checkpoint'
        ),
        checksumSha256: checkpoint.checksumSha256,
        sizeBytes: checkpoint.sizeBytes,
        recordCount: checkpoint.recordCount,
      };
    } catch (error) {
      throw mapNativeError(error, 'baileys_native_prepare_handoff_failed');
    }
  }

  private nativeProviderHandoffInput(
    input: BaileysProviderHandoffPrepareInput
  ): NativeProviderHandoffInput {
    if (
      !UUID_PATTERN.test(input.accountId) ||
      !UUID_PATTERN.test(input.handoffId) ||
      !UUID_PATTERN.test(input.lifecycleOperationId) ||
      !Number.isSafeInteger(input.sourceRevisionId) ||
      input.sourceRevisionId <= 0
    ) {
      throw new BaileysSessionFenceError(
        'baileys_provider_handoff_input_invalid'
      );
    }
    return {
      handoffId: input.handoffId,
      lifecycleOperationId: input.lifecycleOperationId,
      sourceRevisionId: String(input.sourceRevisionId),
      targetProvider: input.targetProvider,
      traceId: input.debugTraceId,
    };
  }

  async closeForHandoff(): Promise<boolean> {
    const native = await this.getNative();
    try {
      return await native.closeForHandoff();
    } catch (error) {
      throw mapNativeError(error, 'baileys_native_handoff_close_failed');
    }
  }

  async close(): Promise<void> {
    this.closePromise ??= this.closeInternal();
    return this.closePromise;
  }

  private async closeInternal(): Promise<void> {
    this.closing = true;
    try {
      const native = this.nativeState ?? (await this.nativeStatePromise);
      if (native) {
        await native.close();
      }
    } catch (error) {
      throw mapNativeError(error, 'baileys_native_close_failed');
    } finally {
      this.nativeState = undefined;
      this.nativeStatePromise = undefined;
      this.stagedCandidates.clear();
    }
  }

  private async getNative(): Promise<NativePostgresAuthState> {
    if (this.closing) {
      throw new BaileysSessionFenceError('baileys_session_store_closed');
    }
    if (this.nativeState) return this.nativeState;
    const opening = this.nativeStatePromise ?? this.openNative();
    this.nativeStatePromise = opening;
    try {
      return await opening;
    } catch (error) {
      // Opening can legitimately fail while an explicit-disconnect tombstone
      // is waiting for the manager's next one-shot pairing authorization.
      // Do not cache that rejected Promise: the same live worker must be able
      // to retry after the authorized connection epoch is activated.
      if (this.nativeStatePromise === opening) {
        this.nativeStatePromise = undefined;
      }
      throw error;
    }
  }

  private async openNative(): Promise<NativePostgresAuthState> {
    try {
      const factory = requireNativeModule().usePostgresAuthState;
      const native = await factory({
        database: this.pool,
        logger: nativeLogger(this.debugEnabled),
        sessionId: this.options.workerId,
        ownerId: this.ownerId,
        generation: this.options.writerGeneration,
        epoch: this.options.writerEpoch,
        capability: this.options.runtimeCapability,
        debug: this.debugEnabled,
        ttlMs: this.options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS,
        renewIntervalMs:
          this.options.renewIntervalMs ?? DEFAULT_RENEW_INTERVAL_MS,
        safetyMarginMs:
          this.options.leaseSafetyMarginMs ?? DEFAULT_LEASE_SAFETY_MARGIN_MS,
        autoRenew: true,
        ...(process.env.SESSION_STORAGE_MIGRATION_ID?.trim()
          ? {
              revisionSource: 'legacy_volume_migration' as const,
              storageMigrationId:
                process.env.SESSION_STORAGE_MIGRATION_ID.trim(),
            }
          : {}),
        onLost: async (error) => {
          const mapped = mapNativeError(error, 'baileys_native_lease_lost');
          await this.options.onLeaseLost?.(
            mapped instanceof BaileysSessionFenceError
              ? mapped
              : new BaileysSessionFenceError(
                  'baileys_native_lease_lost',
                  mapped
                )
          );
        },
      });
      assertNativeAuthState(native);
      this.nativeState = native;
      return native;
    } catch (error) {
      this.nativeStatePromise = undefined;
      throw mapNativeError(error, 'baileys_native_session_open_failed', {
        deterministicRevisionInvalid: true,
      });
    }
  }

  private requireOpenedNative(): NativePostgresAuthState {
    if (!this.nativeState) {
      throw new BaileysSessionFenceError('baileys_native_session_not_open');
    }
    return this.nativeState;
  }

  private nativeCandidate(
    candidate: BaileysStagedSessionRevision
  ): NativeStagedRevision {
    const revisionId = String(candidate.revisionId);
    const staged = this.stagedCandidates.get(revisionId);
    if (
      !staged ||
      (staged.previousActiveRevisionId ?? null) !==
        (candidate.previousActiveRevisionId === null
          ? null
          : String(candidate.previousActiveRevisionId)) ||
      (staged.previousRevisionId ?? null) !==
        (candidate.previousRevisionId === null
          ? null
          : String(candidate.previousRevisionId))
    ) {
      throw new BaileysSessionFenceError(
        'baileys_session_import_candidate_stale'
      );
    }
    return staged;
  }
}
