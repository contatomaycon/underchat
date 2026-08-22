import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const SESSION_MARKER_VERSION = 1;
const SESSION_MARKER_FILE = '.underchat-session-state.json';
const RUNTIME_ACTIVATION_MARKER_FILE =
  '.underchat-runtime-activation-state.json';
const QUARANTINE_DIRECTORY = '.underchat-quarantine';
const SESSION_METADATA_LOCK_FILE = 'metadata.lock';
const SESSION_LIFECYCLE_LOCK_FILE = 'lifecycle.lock';
const MAX_MARKER_BYTES = 64 * 1024;
const DEFAULT_FLOCK_COMMAND = '/usr/bin/flock';
const FLOCK_BUSY_EXIT_CODE = 75;
const ACTIVATION_FENCED_ERROR = 'wwebjs_session_activation_fenced';
const INVALID_SESSION_MARKER_ERROR = 'wwebjs_session_marker_invalid';
const SESSION_METADATA_LOCK_BUSY_ERROR = 'wwebjs_session_metadata_lock_busy';
const SESSION_LIFECYCLE_LOCK_BUSY_ERROR = 'wwebjs_session_lifecycle_lock_busy';

export type WwebjsSessionMarkerState =
  'candidate' | 'validated' | 'quarantined';

export type WwebjsSessionCandidateSource =
  'legacy_profile' | 'secure_import' | 'provider_ready';

export interface WwebjsSessionGuardContext {
  sessionPath: string;
  runtimeRootPath: string;
  workerId: string;
  accountId: string;
  activationId: string;
  activationStartedAt?: string;
  runtimeGeneration?: number;
  sessionVolumeName?: string;
  quarantineRootPath?: string;
  lockRootPath: string;
}

export interface WwebjsSessionLifecycleLease {
  readonly lockPath: string;
  readonly ownerToken: string;
  readonly released: boolean;
  release(): void;
}

export interface WwebjsSessionMarker {
  version: 1;
  worker_id: string;
  account_id: string;
  state: WwebjsSessionMarkerState;
  source: WwebjsSessionCandidateSource;
  created_at: string;
  updated_at: string;
  runtime_generation?: number;
  session_volume_name?: string;
  restore_failures: number;
  incomplete_activation_detected?: boolean;
  last_provider_state?: string;
  last_failure_reason?: string;
  last_validated_at?: string;
  quarantined_at?: string;
  quarantine_reason?: string;
}

export interface WwebjsRuntimeActivationMarker {
  version: 1;
  activation_id: string;
  worker_id: string;
  account_id: string;
  state: 'activating' | 'ready';
  started_at: string;
  updated_at: string;
  runtime_generation?: number;
  session_volume_name?: string;
  ready_at?: string;
}

export interface WwebjsSessionInspection {
  exists: boolean;
  hasDurableAuthArtifacts: boolean;
  restorable: boolean;
  blockedReason?:
    | 'missing_session'
    | 'missing_auth_artifacts'
    | 'invalid_marker'
    | 'identity_mismatch'
    | 'quarantined'
    | 'restore_attempts_exhausted';
  marker?: WwebjsSessionMarker;
  runtimeActivation?: WwebjsRuntimeActivationMarker;
  invalidMarker: boolean;
  incompleteActivationDetected: boolean;
}

export interface WwebjsSessionQuarantineResult {
  blocked: boolean;
  moved: boolean;
  quarantinePath?: string;
  error?: string;
}

export interface WwebjsSessionQuarantinePurgeResult {
  purged: boolean;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isOptionalNonNegativeSafeInteger(value: unknown): boolean {
  return value === undefined || isNonNegativeSafeInteger(value);
}

function readJsonRecord(filePath: string): Record<string, unknown> | undefined {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_MARKER_BYTES) {
      return undefined;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readSessionMarker(
  sessionPath: string
): WwebjsSessionMarker | undefined {
  const value = readJsonRecord(path.join(sessionPath, SESSION_MARKER_FILE));
  const state = optionalString(value?.state);
  const source = optionalString(value?.source);
  const workerId = optionalString(value?.worker_id);
  const accountId = optionalString(value?.account_id);
  const createdAt = optionalString(value?.created_at);
  const updatedAt = optionalString(value?.updated_at);
  const restoreFailures = value?.restore_failures;

  if (
    value?.version !== SESSION_MARKER_VERSION ||
    !workerId ||
    !accountId ||
    !createdAt ||
    !updatedAt ||
    !['candidate', 'validated', 'quarantined'].includes(state ?? '') ||
    !['legacy_profile', 'secure_import', 'provider_ready'].includes(
      source ?? ''
    ) ||
    !isNonNegativeSafeInteger(restoreFailures) ||
    !isOptionalNonNegativeSafeInteger(value.runtime_generation)
  ) {
    return undefined;
  }

  return {
    version: SESSION_MARKER_VERSION,
    worker_id: workerId,
    account_id: accountId,
    state: state as WwebjsSessionMarkerState,
    source: source as WwebjsSessionCandidateSource,
    created_at: createdAt,
    updated_at: updatedAt,
    runtime_generation: optionalNumber(value.runtime_generation),
    session_volume_name: optionalString(value.session_volume_name),
    restore_failures: restoreFailures,
    incomplete_activation_detected:
      value.incomplete_activation_detected === true,
    last_provider_state: optionalString(value.last_provider_state),
    last_failure_reason: optionalString(value.last_failure_reason),
    last_validated_at: optionalString(value.last_validated_at),
    quarantined_at: optionalString(value.quarantined_at),
    quarantine_reason: optionalString(value.quarantine_reason),
  };
}

function sessionMarkerFileExists(sessionPath: string): boolean {
  try {
    return fs.statSync(path.join(sessionPath, SESSION_MARKER_FILE)).isFile();
  } catch {
    return false;
  }
}

function readRuntimeActivationMarker(
  runtimeRootPath: string
): WwebjsRuntimeActivationMarker | undefined {
  const value = readJsonRecord(
    path.join(runtimeRootPath, RUNTIME_ACTIVATION_MARKER_FILE)
  );
  const activationId = optionalString(value?.activation_id);
  const workerId = optionalString(value?.worker_id);
  const accountId = optionalString(value?.account_id);
  const state = optionalString(value?.state);
  const startedAt = optionalString(value?.started_at);
  const updatedAt = optionalString(value?.updated_at);

  if (
    value?.version !== SESSION_MARKER_VERSION ||
    !activationId ||
    !workerId ||
    !accountId ||
    !startedAt ||
    !updatedAt ||
    !['activating', 'ready'].includes(state ?? '') ||
    !isOptionalNonNegativeSafeInteger(value.runtime_generation)
  ) {
    return undefined;
  }

  return {
    version: SESSION_MARKER_VERSION,
    activation_id: activationId,
    worker_id: workerId,
    account_id: accountId,
    state: state as WwebjsRuntimeActivationMarker['state'],
    started_at: startedAt,
    updated_at: updatedAt,
    runtime_generation: optionalNumber(value.runtime_generation),
    session_volume_name: optionalString(value.session_volume_name),
    ready_at: optionalString(value.ready_at),
  };
}

function writeJsonAtomically(
  filePath: string,
  value: Record<string, unknown>
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;

  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {}
    throw error;
  }
}

function writeSessionMarker(
  sessionPath: string,
  marker: WwebjsSessionMarker
): void {
  writeJsonAtomically(
    path.join(sessionPath, SESSION_MARKER_FILE),
    marker as unknown as Record<string, unknown>
  );
}

function writeRuntimeActivationMarker(
  runtimeRootPath: string,
  marker: WwebjsRuntimeActivationMarker
): void {
  writeJsonAtomically(
    path.join(runtimeRootPath, RUNTIME_ACTIVATION_MARKER_FILE),
    marker as unknown as Record<string, unknown>
  );
}

function sanitizeWorkerSegment(workerId: string): string {
  return workerId.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'worker';
}

function getSessionLockRoot(context: WwebjsSessionGuardContext): string {
  const workerSegment = sanitizeWorkerSegment(context.workerId);
  const lockRoot = path.resolve(context.lockRootPath);
  const runtimeRoot = path.resolve(context.runtimeRootPath);
  const quarantineRoot = context.quarantineRootPath
    ? path.resolve(context.quarantineRootPath)
    : undefined;

  if (
    lockRoot === path.parse(lockRoot).root ||
    lockRoot === runtimeRoot ||
    lockRoot.startsWith(`${runtimeRoot}${path.sep}`) ||
    runtimeRoot.startsWith(`${lockRoot}${path.sep}`) ||
    (quarantineRoot !== undefined &&
      (lockRoot === quarantineRoot ||
        lockRoot.startsWith(`${quarantineRoot}${path.sep}`) ||
        quarantineRoot.startsWith(`${lockRoot}${path.sep}`))) ||
    path.basename(lockRoot) !== workerSegment ||
    path.basename(path.dirname(lockRoot)) !== 'wwebjs' ||
    path.basename(path.dirname(path.dirname(lockRoot))) !== '.underchat-locks'
  ) {
    throw activationFencedError('session_lock_root_unsafe');
  }

  fs.mkdirSync(lockRoot, { recursive: true, mode: 0o700 });
  return lockRoot;
}

interface KernelFileLock {
  readonly lockPath: string;
  readonly ownerToken: string;
  readonly released: boolean;
  release(): void;
}

function acquireKernelFileLock(
  lockPath: string,
  busyError: string,
  failureReason: string,
  waitSeconds = 0
): KernelFileLock {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(lockPath, 'a+', 0o600);
    const result = spawnSync(
      process.env.WWEBJS_FLOCK_COMMAND?.trim() || DEFAULT_FLOCK_COMMAND,
      [
        '--exclusive',
        waitSeconds > 0 ? `--wait=${waitSeconds}` : '--nonblock',
        `--conflict-exit-code=${FLOCK_BUSY_EXIT_CODE}`,
        '3',
      ],
      {
        stdio: ['ignore', 'ignore', 'pipe', descriptor],
        timeout: 5_000,
      }
    );

    if (result.status !== 0) {
      if (result.status === FLOCK_BUSY_EXIT_CODE) {
        throw new Error(busyError);
      }

      const spawnCode =
        result.error && 'code' in result.error
          ? String(result.error.code)
          : undefined;
      throw activationFencedError(
        spawnCode === 'ENOENT'
          ? `${failureReason}_backend_unavailable`
          : `${failureReason}_failed`
      );
    }
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {}
    }
    throw error;
  }

  if (descriptor === undefined) {
    throw activationFencedError(`${failureReason}_failed`);
  }

  const ownerToken = randomUUID();
  let released = false;
  return {
    lockPath,
    ownerToken,
    get released() {
      return released;
    },
    release() {
      if (released) {
        return;
      }
      released = true;
      try {
        fs.closeSync(descriptor);
      } catch {}
    },
  };
}

export function acquireWwebjsSessionMetadataLock(
  context: WwebjsSessionGuardContext
): WwebjsSessionLifecycleLease {
  const lockPath = path.join(
    getSessionLockRoot(context),
    SESSION_METADATA_LOCK_FILE
  );
  return acquireKernelFileLock(
    lockPath,
    SESSION_METADATA_LOCK_BUSY_ERROR,
    'session_metadata_lock',
    2
  );
}

export function acquireWwebjsSessionLifecycleLease(
  context: WwebjsSessionGuardContext
): WwebjsSessionLifecycleLease {
  const lockPath = path.join(
    getSessionLockRoot(context),
    SESSION_LIFECYCLE_LOCK_FILE
  );
  return acquireKernelFileLock(
    lockPath,
    SESSION_LIFECYCLE_LOCK_BUSY_ERROR,
    'session_lifecycle_lock'
  );
}

export function isWwebjsSessionLockBusy(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes(SESSION_METADATA_LOCK_BUSY_ERROR) ||
    message.includes(SESSION_LIFECYCLE_LOCK_BUSY_ERROR)
  );
}

function withRuntimeActivationLock<T>(
  context: WwebjsSessionGuardContext,
  operation: () => T
): T {
  const lease = acquireWwebjsSessionMetadataLock(context);
  try {
    return operation();
  } finally {
    lease.release();
  }
}

function activationFencedError(reason: string): Error {
  return new Error(`${ACTIVATION_FENCED_ERROR}:${reason}`);
}

function assertCurrentRuntimeActivation(
  context: WwebjsSessionGuardContext
): WwebjsRuntimeActivationMarker {
  const markerPath = path.join(
    context.runtimeRootPath,
    RUNTIME_ACTIVATION_MARKER_FILE
  );
  const marker = readRuntimeActivationMarker(context.runtimeRootPath);
  if (!marker) {
    const reason = fs.existsSync(markerPath)
      ? 'invalid_runtime_marker'
      : 'missing_runtime_marker';
    throw activationFencedError(reason);
  }
  if (
    marker.activation_id !== context.activationId ||
    marker.worker_id !== context.workerId ||
    marker.account_id !== context.accountId
  ) {
    throw activationFencedError('runtime_owner_changed');
  }
  if (
    marker.runtime_generation !== undefined &&
    context.runtimeGeneration !== undefined &&
    marker.runtime_generation !== context.runtimeGeneration
  ) {
    throw activationFencedError('runtime_generation_changed');
  }
  return marker;
}

function assertSessionMarkerValidOrMissing(sessionPath: string): void {
  if (sessionMarkerFileExists(sessionPath) && !readSessionMarker(sessionPath)) {
    throw new Error(INVALID_SESSION_MARKER_ERROR);
  }
}

function canClaimRuntimeActivation(
  existing: WwebjsRuntimeActivationMarker,
  context: WwebjsSessionGuardContext,
  startedAt: string
): boolean {
  if (
    existing.worker_id !== context.workerId ||
    existing.account_id !== context.accountId
  ) {
    return false;
  }

  const existingGeneration = existing.runtime_generation;
  const requestedGeneration = context.runtimeGeneration;
  if (
    existingGeneration !== undefined &&
    requestedGeneration !== undefined &&
    existingGeneration !== requestedGeneration
  ) {
    return requestedGeneration > existingGeneration;
  }
  if (existingGeneration !== undefined && requestedGeneration === undefined) {
    return false;
  }

  const existingStartedAtMs = Date.parse(existing.started_at);
  const requestedStartedAtMs = Date.parse(startedAt);
  return (
    Number.isFinite(existingStartedAtMs) &&
    Number.isFinite(requestedStartedAtMs) &&
    requestedStartedAtMs > existingStartedAtMs
  );
}

function isNonEmptyFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function directoryContainsDurableFile(
  directoryPath: string,
  depth = 0
): boolean {
  if (depth > 3) {
    return false;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    const normalizedName = entry.name.toLowerCase();
    if (
      entry.name === SESSION_MARKER_FILE ||
      entry.name.startsWith('Singleton') ||
      entry.name === 'LOCK' ||
      normalizedName.endsWith('.tmp') ||
      normalizedName.endsWith('.lock')
    ) {
      continue;
    }

    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isFile() && isNonEmptyFile(entryPath)) {
      return true;
    }
    if (
      entry.isDirectory() &&
      directoryContainsDurableFile(entryPath, depth + 1)
    ) {
      return true;
    }
  }

  return false;
}

export function hasWwebjsDurableAuthArtifacts(sessionPath: string): boolean {
  const defaultProfile = path.join(sessionPath, 'Default');
  const hasIndexedDb = directoryContainsDurableFile(
    path.join(defaultProfile, 'IndexedDB')
  );
  const hasCookies =
    isNonEmptyFile(path.join(defaultProfile, 'Cookies')) ||
    isNonEmptyFile(path.join(defaultProfile, 'Network', 'Cookies'));
  const hasLocalStorage = directoryContainsDurableFile(
    path.join(defaultProfile, 'Local Storage', 'leveldb')
  );

  return hasIndexedDb && (hasCookies || hasLocalStorage);
}

function sessionIdentityMatches(
  marker: WwebjsSessionMarker | undefined,
  context: WwebjsSessionGuardContext
): boolean {
  return (
    !marker ||
    (marker.worker_id === context.workerId &&
      marker.account_id === context.accountId)
  );
}

export function inspectWwebjsLocalAuthSession(
  context: WwebjsSessionGuardContext,
  maxRestoreAttempts: number
): WwebjsSessionInspection {
  let exists = false;
  try {
    exists = fs.statSync(context.sessionPath).isDirectory();
  } catch {}

  const marker = exists ? readSessionMarker(context.sessionPath) : undefined;
  const invalidMarker =
    exists && sessionMarkerFileExists(context.sessionPath) && !marker;
  const runtimeActivation = readRuntimeActivationMarker(
    context.runtimeRootPath
  );
  const hasDurableAuthArtifacts =
    exists && hasWwebjsDurableAuthArtifacts(context.sessionPath);
  const incompleteActivationDetected = Boolean(
    exists &&
    hasDurableAuthArtifacts &&
    marker?.state !== 'validated' &&
    runtimeActivation?.state === 'activating' &&
    runtimeActivation.activation_id !== context.activationId
  );

  if (!exists) {
    return {
      exists: false,
      hasDurableAuthArtifacts: false,
      restorable: false,
      blockedReason: 'missing_session',
      marker,
      runtimeActivation,
      invalidMarker: false,
      incompleteActivationDetected: false,
    };
  }

  if (invalidMarker) {
    return {
      exists,
      hasDurableAuthArtifacts,
      restorable: false,
      blockedReason: 'invalid_marker',
      marker,
      runtimeActivation,
      invalidMarker,
      incompleteActivationDetected,
    };
  }

  if (!hasDurableAuthArtifacts) {
    return {
      exists,
      hasDurableAuthArtifacts,
      restorable: false,
      blockedReason: 'missing_auth_artifacts',
      marker,
      runtimeActivation,
      invalidMarker,
      incompleteActivationDetected,
    };
  }

  if (!sessionIdentityMatches(marker, context)) {
    return {
      exists,
      hasDurableAuthArtifacts,
      restorable: false,
      blockedReason: 'identity_mismatch',
      marker,
      runtimeActivation,
      invalidMarker,
      incompleteActivationDetected,
    };
  }

  if (marker?.state === 'quarantined') {
    return {
      exists,
      hasDurableAuthArtifacts,
      restorable: false,
      blockedReason: 'quarantined',
      marker,
      runtimeActivation,
      invalidMarker,
      incompleteActivationDetected,
    };
  }

  if ((marker?.restore_failures ?? 0) >= maxRestoreAttempts) {
    return {
      exists,
      hasDurableAuthArtifacts,
      restorable: false,
      blockedReason: 'restore_attempts_exhausted',
      marker,
      runtimeActivation,
      invalidMarker,
      incompleteActivationDetected,
    };
  }

  return {
    exists,
    hasDurableAuthArtifacts,
    restorable: true,
    marker,
    runtimeActivation,
    invalidMarker,
    incompleteActivationDetected,
  };
}

export function beginWwebjsRuntimeSessionActivation(
  context: WwebjsSessionGuardContext,
  startedAt = context.activationStartedAt ?? new Date().toISOString()
): WwebjsRuntimeActivationMarker {
  return withRuntimeActivationLock(context, () => {
    const existing = readRuntimeActivationMarker(context.runtimeRootPath);
    if (
      existing &&
      existing.activation_id !== context.activationId &&
      !canClaimRuntimeActivation(existing, context, startedAt)
    ) {
      throw activationFencedError('newer_runtime_owner_exists');
    }
    const marker: WwebjsRuntimeActivationMarker = {
      version: SESSION_MARKER_VERSION,
      activation_id: context.activationId,
      worker_id: context.workerId,
      account_id: context.accountId,
      state: 'activating',
      started_at:
        existing?.activation_id === context.activationId
          ? existing.started_at
          : startedAt,
      updated_at: startedAt,
      runtime_generation: context.runtimeGeneration,
      session_volume_name: context.sessionVolumeName,
    };
    writeRuntimeActivationMarker(context.runtimeRootPath, marker);
    return marker;
  });
}

export function markWwebjsRuntimeSessionReady(
  context: WwebjsSessionGuardContext,
  readyAt = new Date().toISOString()
): WwebjsRuntimeActivationMarker {
  return withRuntimeActivationLock(context, () => {
    const existing = assertCurrentRuntimeActivation(context);
    const marker: WwebjsRuntimeActivationMarker = {
      version: SESSION_MARKER_VERSION,
      activation_id: context.activationId,
      worker_id: context.workerId,
      account_id: context.accountId,
      state: 'ready',
      started_at: existing.started_at,
      updated_at: readyAt,
      runtime_generation: context.runtimeGeneration,
      session_volume_name: context.sessionVolumeName,
      ready_at: readyAt,
    };
    writeRuntimeActivationMarker(context.runtimeRootPath, marker);
    return marker;
  });
}

export function ensureWwebjsSessionCandidate(
  context: WwebjsSessionGuardContext,
  source: WwebjsSessionCandidateSource,
  incompleteActivationDetected = false,
  updatedAt = new Date().toISOString()
): WwebjsSessionMarker | undefined {
  return withRuntimeActivationLock(context, () => {
    assertCurrentRuntimeActivation(context);
    if (!hasWwebjsDurableAuthArtifacts(context.sessionPath)) {
      return undefined;
    }

    assertSessionMarkerValidOrMissing(context.sessionPath);
    const existing = readSessionMarker(context.sessionPath);
    if (
      existing?.state === 'validated' &&
      sessionIdentityMatches(existing, context)
    ) {
      return existing;
    }
    if (existing?.state === 'quarantined') {
      return existing;
    }

    const marker: WwebjsSessionMarker = {
      version: SESSION_MARKER_VERSION,
      worker_id: context.workerId,
      account_id: context.accountId,
      state: 'candidate',
      source,
      created_at: existing?.created_at ?? updatedAt,
      updated_at: updatedAt,
      runtime_generation: context.runtimeGeneration,
      session_volume_name: context.sessionVolumeName,
      restore_failures: existing?.restore_failures ?? 0,
      incomplete_activation_detected:
        existing?.incomplete_activation_detected === true ||
        incompleteActivationDetected,
      last_provider_state: existing?.last_provider_state,
      last_failure_reason: existing?.last_failure_reason,
    };
    writeSessionMarker(context.sessionPath, marker);
    return marker;
  });
}

export function recordWwebjsSessionRestoreFailure(
  context: WwebjsSessionGuardContext,
  providerState: string,
  reason: string,
  updatedAt = new Date().toISOString()
): WwebjsSessionMarker {
  return withRuntimeActivationLock(context, () => {
    assertCurrentRuntimeActivation(context);
    assertSessionMarkerValidOrMissing(context.sessionPath);
    const existing = readSessionMarker(context.sessionPath);
    const identityMatches = sessionIdentityMatches(existing, context);
    const marker: WwebjsSessionMarker = {
      version: SESSION_MARKER_VERSION,
      worker_id: identityMatches
        ? (existing?.worker_id ?? context.workerId)
        : context.workerId,
      account_id: identityMatches
        ? (existing?.account_id ?? context.accountId)
        : context.accountId,
      state: 'candidate',
      source: identityMatches
        ? (existing?.source ?? 'legacy_profile')
        : 'legacy_profile',
      created_at: identityMatches
        ? (existing?.created_at ?? updatedAt)
        : updatedAt,
      updated_at: updatedAt,
      runtime_generation: context.runtimeGeneration,
      session_volume_name: context.sessionVolumeName,
      restore_failures: identityMatches
        ? (existing?.restore_failures ?? 0) + 1
        : Number.MAX_SAFE_INTEGER,
      incomplete_activation_detected:
        existing?.incomplete_activation_detected === true,
      last_provider_state: providerState,
      last_failure_reason: reason,
    };
    writeSessionMarker(context.sessionPath, marker);
    return marker;
  });
}

export function markWwebjsSessionValidated(
  context: WwebjsSessionGuardContext,
  validatedAt = new Date().toISOString()
): WwebjsSessionMarker | undefined {
  return withRuntimeActivationLock(context, () => {
    assertCurrentRuntimeActivation(context);
    if (!hasWwebjsDurableAuthArtifacts(context.sessionPath)) {
      return undefined;
    }

    assertSessionMarkerValidOrMissing(context.sessionPath);
    const existing = readSessionMarker(context.sessionPath);
    const marker: WwebjsSessionMarker = {
      version: SESSION_MARKER_VERSION,
      worker_id: context.workerId,
      account_id: context.accountId,
      state: 'validated',
      source: existing?.source ?? 'provider_ready',
      created_at: existing?.created_at ?? validatedAt,
      updated_at: validatedAt,
      runtime_generation: context.runtimeGeneration,
      session_volume_name: context.sessionVolumeName,
      restore_failures: 0,
      incomplete_activation_detected: false,
      last_provider_state: 'CONNECTED',
      last_validated_at: validatedAt,
    };
    writeSessionMarker(context.sessionPath, marker);
    return marker;
  });
}

function sanitizeQuarantineReason(reason: string): string {
  const normalized = reason
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized || 'invalid-session';
}

function availableQuarantinePath(
  context: WwebjsSessionGuardContext,
  reason: string,
  timestampMs: number
): string {
  const quarantineRoot =
    context.quarantineRootPath ??
    path.join(path.dirname(context.sessionPath), QUARANTINE_DIRECTORY);
  fs.mkdirSync(quarantineRoot, { recursive: true });
  const baseName = `${path.basename(context.sessionPath)}-${timestampMs}-${sanitizeQuarantineReason(reason)}`;
  let candidate = path.join(quarantineRoot, baseName);
  let suffix = 0;
  while (fs.existsSync(candidate)) {
    suffix += 1;
    candidate = path.join(quarantineRoot, `${baseName}-${suffix}`);
  }
  return candidate;
}

export function quarantineWwebjsLocalAuthSession(
  context: WwebjsSessionGuardContext,
  reason: string,
  timestampMs = Date.now()
): WwebjsSessionQuarantineResult {
  try {
    return withRuntimeActivationLock(context, () => {
      assertCurrentRuntimeActivation(context);
      if (!fs.existsSync(context.sessionPath)) {
        return { blocked: true, moved: false };
      }
      const now = new Date(timestampMs).toISOString();
      const existing = readSessionMarker(context.sessionPath);
      let markerWritten = false;
      try {
        const marker: WwebjsSessionMarker = {
          version: SESSION_MARKER_VERSION,
          worker_id: existing?.worker_id ?? context.workerId,
          account_id: existing?.account_id ?? context.accountId,
          state: 'quarantined',
          source: existing?.source ?? 'legacy_profile',
          created_at: existing?.created_at ?? now,
          updated_at: now,
          runtime_generation:
            existing?.runtime_generation ?? context.runtimeGeneration,
          session_volume_name:
            existing?.session_volume_name ?? context.sessionVolumeName,
          restore_failures: existing?.restore_failures ?? 0,
          incomplete_activation_detected:
            existing?.incomplete_activation_detected === true,
          last_provider_state: existing?.last_provider_state,
          last_failure_reason: existing?.last_failure_reason,
          quarantined_at: now,
          quarantine_reason: reason,
        };
        writeSessionMarker(context.sessionPath, marker);
        markerWritten = true;
      } catch {}

      try {
        const quarantinePath = availableQuarantinePath(
          context,
          reason,
          timestampMs
        );
        const sourceDevice = fs.statSync(context.sessionPath).dev;
        const quarantineDevice = fs.statSync(path.dirname(quarantinePath)).dev;
        if (sourceDevice !== quarantineDevice) {
          return {
            blocked: true,
            moved: false,
            error: 'wwebjs_session_quarantine_cross_device_refused',
          };
        }
        fs.renameSync(context.sessionPath, quarantinePath);
        return {
          blocked: true,
          moved: true,
          quarantinePath,
        };
      } catch (error) {
        return {
          blocked: markerWritten,
          moved: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  } catch (error) {
    return {
      blocked: true,
      moved: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function purgeWwebjsSessionQuarantine(
  context: WwebjsSessionGuardContext
): WwebjsSessionQuarantinePurgeResult {
  if (!context.quarantineRootPath) {
    return {
      purged: false,
      error: 'wwebjs_session_quarantine_root_missing',
    };
  }

  const quarantineRoot = path.resolve(context.quarantineRootPath);
  const runtimeRoot = path.resolve(context.runtimeRootPath);
  const expectedWorkerSegment =
    context.workerId.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'worker';
  if (
    quarantineRoot === path.parse(quarantineRoot).root ||
    quarantineRoot === runtimeRoot ||
    runtimeRoot.startsWith(`${quarantineRoot}${path.sep}`) ||
    path.basename(quarantineRoot) !== expectedWorkerSegment
  ) {
    return {
      purged: false,
      error: 'wwebjs_session_quarantine_root_unsafe',
    };
  }

  try {
    return withRuntimeActivationLock(context, () => {
      fs.rmSync(quarantineRoot, { recursive: true, force: true });
      return { purged: !fs.existsSync(quarantineRoot) };
    });
  } catch (error) {
    return {
      purged: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
