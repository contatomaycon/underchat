import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EWorkerType } from '@core/common/enums/EWorkerType';

const CHROMIUM_PROFILE_SCOPES = [
  { name: 'session', relativePath: '' },
  { name: 'default', relativePath: 'Default' },
] as const;
const CHROMIUM_PROFILE_ARTIFACT_NAMES = [
  'SingletonCookie',
  'SingletonSocket',
  'SingletonLock',
] as const;
const CHROMIUM_CONTAINER_ID_PATTERN = /^[a-f0-9]{12,64}$/;
const CHROMIUM_LOCK_TARGET_PATTERN = /^([a-f0-9]{12,64})-([1-9][0-9]{0,9})$/;
const RUNTIME_IDENTITY_RETRY_DELAYS_MS = [50, 100, 200, 400, 800, 1_000];

type ChromiumProfileScopeName =
  (typeof CHROMIUM_PROFILE_SCOPES)[number]['name'];
type ChromiumProfileArtifactName =
  (typeof CHROMIUM_PROFILE_ARTIFACT_NAMES)[number];
type ChromiumProfileArtifactType =
  'absent' | 'symlink' | 'file' | 'socket' | 'directory' | 'other';

export interface ChromiumProfileArtifactSnapshot {
  name: ChromiumProfileArtifactName;
  scope: ChromiumProfileScopeName;
  type: ChromiumProfileArtifactType;
  device?: string;
  inode?: string;
  mode?: string;
  size?: string;
  ctimeNs?: string;
  mtimeNs?: string;
  symlinkTarget?: string;
}

export interface ChromiumLockCleanupAuthorizationRequest {
  request_id: string;
  worker_id: string;
  account_id: string;
  worker_type_id: EWorkerType.wwebjs;
  runtime_generation: number;
  requester_container_id: string;
  session_volume_name: string;
  singleton_lock_target: string;
}

export interface ChromiumLockCleanupAuthorizationResponse {
  authorized: boolean;
  reason: string;
  request_id: string;
  requester_container_id: string;
  owner_container_id: string;
  session_volume_name: string;
  singleton_lock_target: string;
  expires_at_unix_ms: number | string;
}

export interface WwebjsChromiumProfileRecoveryInput {
  sessionDir: string;
  workerId: string;
  accountId: string;
  runtimeGeneration?: number;
  sessionVolumeName?: string;
  currentContainerId?: string;
  authorizeForeignOwner: (
    request: ChromiumLockCleanupAuthorizationRequest
  ) => Promise<ChromiumLockCleanupAuthorizationResponse>;
  now?: () => number;
  waitBeforeAuthorizationRetry?: (delayMs: number) => Promise<void>;
}

export interface WwebjsChromiumProfileRecoveryResult {
  recoveredScopes: number;
  removedArtifacts: number;
}

interface ChromiumLockOwner {
  containerId: string;
  pid: number;
}

interface ChromiumProfileScopeSnapshot {
  directoryPath: string;
  lockOwner?: ChromiumLockOwner;
  scope: ChromiumProfileScopeName;
  artifacts: ChromiumProfileArtifactSnapshot[];
}

interface AuthorizedScopeCleanup {
  authorization?: ChromiumLockCleanupAuthorizationResponse;
  initial: ChromiumProfileScopeSnapshot;
  lockOwner: ChromiumLockOwner;
}

export class WwebjsChromiumProfileLockRecoveryError extends Error {
  constructor(
    public readonly reason: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(`wwebjs_chromium_profile_lock_recovery_blocked:${reason}`);
    this.name = 'WwebjsChromiumProfileLockRecoveryError';
  }
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }
  return String(error);
}

function artifactType(
  stats: fs.BigIntStats
): Exclude<ChromiumProfileArtifactType, 'absent'> {
  if (stats.isSymbolicLink()) {
    return 'symlink';
  }
  if (stats.isFile()) {
    return 'file';
  }
  if (stats.isSocket()) {
    return 'socket';
  }
  if (stats.isDirectory()) {
    return 'directory';
  }
  return 'other';
}

function artifactPath(
  directoryPath: string,
  name: ChromiumProfileArtifactName
): string {
  return path.join(directoryPath, name);
}

function snapshotArtifact(
  directoryPath: string,
  scope: ChromiumProfileScopeName,
  name: ChromiumProfileArtifactName
): ChromiumProfileArtifactSnapshot {
  const targetPath = artifactPath(directoryPath, name);
  let stats: fs.BigIntStats;
  try {
    stats = fs.lstatSync(targetPath, { bigint: true });
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return { name, scope, type: 'absent' };
    }
    throw new WwebjsChromiumProfileLockRecoveryError(
      'artifact_snapshot_failed',
      { name, scope, error: errorMessage(error) }
    );
  }

  const type = artifactType(stats);
  let symlinkTarget: string | undefined;
  if (type === 'symlink') {
    try {
      symlinkTarget = fs.readlinkSync(targetPath);
    } catch (error) {
      throw new WwebjsChromiumProfileLockRecoveryError(
        'artifact_readlink_failed',
        { name, scope, error: errorMessage(error) }
      );
    }
  }

  return {
    name,
    scope,
    type,
    device: stats.dev.toString(),
    inode: stats.ino.toString(),
    mode: stats.mode.toString(),
    size: stats.size.toString(),
    ctimeNs: stats.ctimeNs.toString(),
    mtimeNs: stats.mtimeNs.toString(),
    symlinkTarget,
  };
}

function assertDirectoryRealpathSafe(directoryPath: string): void {
  try {
    if (fs.realpathSync.native(directoryPath) !== path.resolve(directoryPath)) {
      throw new WwebjsChromiumProfileLockRecoveryError(
        'profile_directory_ancestor_symlink',
        { directoryPath }
      );
    }
  } catch (error) {
    if (error instanceof WwebjsChromiumProfileLockRecoveryError) {
      throw error;
    }
    throw new WwebjsChromiumProfileLockRecoveryError(
      'profile_directory_realpath_failed',
      { directoryPath, error: errorMessage(error) }
    );
  }
}

function assertNearestExistingDirectorySafe(directoryPath: string): void {
  let candidate = path.dirname(directoryPath);
  while (true) {
    try {
      const stats = fs.lstatSync(candidate);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new WwebjsChromiumProfileLockRecoveryError(
          'profile_directory_ancestor_unsafe',
          { directoryPath, ancestorPath: candidate }
        );
      }
      assertDirectoryRealpathSafe(candidate);
      return;
    } catch (error) {
      if (error instanceof WwebjsChromiumProfileLockRecoveryError) {
        throw error;
      }
      if (errorCode(error) !== 'ENOENT') {
        throw new WwebjsChromiumProfileLockRecoveryError(
          'profile_directory_ancestor_snapshot_failed',
          {
            directoryPath,
            ancestorPath: candidate,
            error: errorMessage(error),
          }
        );
      }
      const parent = path.dirname(candidate);
      if (parent === candidate) {
        throw new WwebjsChromiumProfileLockRecoveryError(
          'profile_directory_ancestor_missing',
          { directoryPath }
        );
      }
      candidate = parent;
    }
  }
}

function assertProfileDirectorySafe(directoryPath: string): void {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(directoryPath);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      assertNearestExistingDirectorySafe(directoryPath);
      return;
    }
    throw new WwebjsChromiumProfileLockRecoveryError(
      'profile_directory_snapshot_failed',
      { directoryPath, error: errorMessage(error) }
    );
  }

  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new WwebjsChromiumProfileLockRecoveryError(
      'profile_directory_unsafe',
      { directoryPath }
    );
  }
  assertDirectoryRealpathSafe(directoryPath);
}

function parseLockOwner(
  lock: ChromiumProfileArtifactSnapshot
): ChromiumLockOwner {
  if (lock.type !== 'symlink' || !lock.symlinkTarget) {
    throw new WwebjsChromiumProfileLockRecoveryError(
      'singleton_lock_not_symlink',
      { scope: lock.scope, type: lock.type }
    );
  }

  const match = CHROMIUM_LOCK_TARGET_PATTERN.exec(lock.symlinkTarget);
  const pid = Number(match?.[2]);
  if (!match || !Number.isSafeInteger(pid) || pid <= 0 || pid > 2_147_483_647) {
    throw new WwebjsChromiumProfileLockRecoveryError(
      'singleton_lock_target_invalid',
      { scope: lock.scope, target: lock.symlinkTarget }
    );
  }

  return { containerId: match[1], pid };
}

function snapshotScope(
  sessionDir: string,
  scope: (typeof CHROMIUM_PROFILE_SCOPES)[number]
): ChromiumProfileScopeSnapshot {
  const directoryPath = scope.relativePath
    ? path.join(sessionDir, scope.relativePath)
    : sessionDir;
  assertProfileDirectorySafe(directoryPath);
  const artifacts = CHROMIUM_PROFILE_ARTIFACT_NAMES.map((name) =>
    snapshotArtifact(directoryPath, scope.name, name)
  );
  const lock = artifacts.find(({ name }) => name === 'SingletonLock');

  return {
    directoryPath,
    scope: scope.name,
    artifacts,
    lockOwner:
      lock && lock.type !== 'absent' ? parseLockOwner(lock) : undefined,
  };
}

function snapshotProfile(sessionDir: string): ChromiumProfileScopeSnapshot[] {
  if (
    !path.isAbsolute(sessionDir) ||
    path.normalize(sessionDir) !== sessionDir
  ) {
    throw new WwebjsChromiumProfileLockRecoveryError(
      'session_directory_invalid',
      { sessionDir }
    );
  }
  assertProfileDirectorySafe(sessionDir);
  return CHROMIUM_PROFILE_SCOPES.map((scope) =>
    snapshotScope(sessionDir, scope)
  );
}

function snapshotsEqual(
  left: ChromiumProfileArtifactSnapshot,
  right: ChromiumProfileArtifactSnapshot
): boolean {
  return (
    left.name === right.name &&
    left.scope === right.scope &&
    left.type === right.type &&
    left.device === right.device &&
    left.inode === right.inode &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.ctimeNs === right.ctimeNs &&
    left.mtimeNs === right.mtimeNs &&
    left.symlinkTarget === right.symlinkTarget
  );
}

function assertScopeUnchanged(
  initial: ChromiumProfileScopeSnapshot,
  current: ChromiumProfileScopeSnapshot
): void {
  if (
    initial.scope !== current.scope ||
    initial.artifacts.length !== current.artifacts.length ||
    initial.artifacts.some(
      (artifact, index) => !snapshotsEqual(artifact, current.artifacts[index])
    )
  ) {
    throw new WwebjsChromiumProfileLockRecoveryError(
      'profile_artifact_changed',
      { scope: initial.scope }
    );
  }
}

function inspectOwnerPid(pid: number): 'absent' | 'present' | 'unreadable' {
  try {
    const stats = fs.statSync(`/proc/${pid}`);
    return stats.isDirectory() ? 'present' : 'unreadable';
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return 'absent';
    }
    return 'unreadable';
  }
}

function assertCurrentOwnerPidAbsent(owner: ChromiumLockOwner): void {
  const status = inspectOwnerPid(owner.pid);
  if (status !== 'absent') {
    throw new WwebjsChromiumProfileLockRecoveryError(
      status === 'present'
        ? 'current_owner_pid_present'
        : 'current_owner_pid_unreadable',
      { ownerPid: owner.pid }
    );
  }
}

function validateArtifactRemovalType(
  artifact: ChromiumProfileArtifactSnapshot
): void {
  if (
    artifact.type !== 'absent' &&
    artifact.type !== 'symlink' &&
    artifact.type !== 'file' &&
    artifact.type !== 'socket'
  ) {
    throw new WwebjsChromiumProfileLockRecoveryError(
      'profile_artifact_type_unsafe',
      { name: artifact.name, scope: artifact.scope, type: artifact.type }
    );
  }
}

function assertScopeReadyForLockRemoval(
  initial: ChromiumProfileScopeSnapshot
): void {
  for (const expected of initial.artifacts) {
    const current = snapshotArtifact(
      initial.directoryPath,
      initial.scope,
      expected.name
    );
    if (expected.name === 'SingletonLock') {
      if (!snapshotsEqual(expected, current)) {
        throw new WwebjsChromiumProfileLockRecoveryError(
          'singleton_lock_changed_before_unlink',
          { scope: initial.scope }
        );
      }
      continue;
    }
    if (current.type !== 'absent') {
      throw new WwebjsChromiumProfileLockRecoveryError(
        'profile_companion_artifact_reappeared',
        { name: expected.name, scope: initial.scope }
      );
    }
  }
}

function removeAuthorizedScope(
  cleanup: AuthorizedScopeCleanup,
  sessionDir: string,
  currentContainerId: string,
  now: () => number
): number {
  const current = snapshotProfile(sessionDir).find(
    ({ scope }) => scope === cleanup.initial.scope
  );
  if (!current) {
    throw new WwebjsChromiumProfileLockRecoveryError(
      'profile_scope_disappeared',
      { scope: cleanup.initial.scope }
    );
  }
  assertScopeUnchanged(cleanup.initial, current);

  if (cleanup.lockOwner.containerId === currentContainerId) {
    assertCurrentOwnerPidAbsent(cleanup.lockOwner);
  } else {
    const expiresAt = Number(cleanup.authorization?.expires_at_unix_ms);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now()) {
      throw new WwebjsChromiumProfileLockRecoveryError(
        'foreign_owner_authorization_expired',
        { scope: cleanup.initial.scope }
      );
    }
  }

  let removedArtifacts = 0;
  for (const name of CHROMIUM_PROFILE_ARTIFACT_NAMES) {
    const expected = cleanup.initial.artifacts.find(
      (artifact) => artifact.name === name
    );
    if (!expected || expected.type === 'absent') {
      continue;
    }
    validateArtifactRemovalType(expected);
    const currentArtifact = snapshotArtifact(
      cleanup.initial.directoryPath,
      cleanup.initial.scope,
      name
    );
    if (!snapshotsEqual(expected, currentArtifact)) {
      throw new WwebjsChromiumProfileLockRecoveryError(
        'profile_artifact_changed_before_unlink',
        { name, scope: cleanup.initial.scope }
      );
    }
    if (name === 'SingletonLock') {
      assertScopeReadyForLockRemoval(cleanup.initial);
      if (cleanup.lockOwner.containerId === currentContainerId) {
        assertCurrentOwnerPidAbsent(cleanup.lockOwner);
      } else if (Number(cleanup.authorization?.expires_at_unix_ms) <= now()) {
        throw new WwebjsChromiumProfileLockRecoveryError(
          'foreign_owner_authorization_expired_before_unlock',
          { scope: cleanup.initial.scope }
        );
      }
    }
    try {
      fs.unlinkSync(artifactPath(cleanup.initial.directoryPath, expected.name));
    } catch (error) {
      throw new WwebjsChromiumProfileLockRecoveryError(
        'profile_artifact_unlink_failed',
        {
          name,
          scope: cleanup.initial.scope,
          error: errorMessage(error),
        }
      );
    }
    removedArtifacts += 1;
  }
  return removedArtifacts;
}

function assertRecoveryIdentity(input: {
  accountId: string;
  currentContainerId: string;
  runtimeGeneration?: number;
  sessionVolumeName?: string;
  workerId: string;
}): asserts input is {
  accountId: string;
  currentContainerId: string;
  runtimeGeneration: number;
  sessionVolumeName: string;
  workerId: string;
} {
  if (
    !input.workerId.trim() ||
    !input.accountId.trim() ||
    !CHROMIUM_CONTAINER_ID_PATTERN.test(input.currentContainerId) ||
    !Number.isSafeInteger(input.runtimeGeneration) ||
    Number(input.runtimeGeneration) <= 0 ||
    !input.sessionVolumeName?.trim()
  ) {
    throw new WwebjsChromiumProfileLockRecoveryError(
      'runtime_identity_incomplete'
    );
  }
}

function validateForeignAuthorization(
  request: ChromiumLockCleanupAuthorizationRequest,
  response: ChromiumLockCleanupAuthorizationResponse,
  owner: ChromiumLockOwner,
  now: () => number
): void {
  const expiresAt = Number(response.expires_at_unix_ms);
  if (
    response.authorized !== true ||
    !foreignAuthorizationEchoMatches(request, response, owner) ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now()
  ) {
    throw new WwebjsChromiumProfileLockRecoveryError(
      'foreign_owner_authorization_invalid',
      { reason: response.reason }
    );
  }
}

function foreignAuthorizationEchoMatches(
  request: ChromiumLockCleanupAuthorizationRequest,
  response: ChromiumLockCleanupAuthorizationResponse,
  owner: ChromiumLockOwner
): boolean {
  return (
    response.request_id === request.request_id &&
    response.requester_container_id === request.requester_container_id &&
    response.owner_container_id === owner.containerId &&
    response.session_volume_name === request.session_volume_name &&
    response.singleton_lock_target === request.singleton_lock_target
  );
}

function isRetryableRuntimeIdentityDenial(
  request: ChromiumLockCleanupAuthorizationRequest,
  response: ChromiumLockCleanupAuthorizationResponse,
  owner: ChromiumLockOwner
): boolean {
  return (
    response.authorized === false &&
    response.reason === 'runtime_identity_mismatch' &&
    foreignAuthorizationEchoMatches(request, response, owner)
  );
}

async function waitBeforeAuthorizationRetry(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function buildForeignAuthorizationRequest(
  input: WwebjsChromiumProfileRecoveryInput,
  currentContainerId: string,
  singletonLockTarget: string
): ChromiumLockCleanupAuthorizationRequest {
  return {
    request_id: randomUUID(),
    worker_id: input.workerId.trim(),
    account_id: input.accountId.trim(),
    worker_type_id: EWorkerType.wwebjs,
    runtime_generation: input.runtimeGeneration as number,
    requester_container_id: currentContainerId,
    session_volume_name: input.sessionVolumeName as string,
    singleton_lock_target: singletonLockTarget,
  };
}

async function requestForeignOwnerAuthorization(
  input: WwebjsChromiumProfileRecoveryInput,
  currentContainerId: string,
  singletonLockTarget: string,
  lockOwner: ChromiumLockOwner,
  scope: ChromiumProfileScopeName,
  now: () => number
): Promise<ChromiumLockCleanupAuthorizationResponse> {
  const wait =
    input.waitBeforeAuthorizationRetry ?? waitBeforeAuthorizationRetry;

  for (
    let attempt = 0;
    attempt <= RUNTIME_IDENTITY_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    const request = buildForeignAuthorizationRequest(
      input,
      currentContainerId,
      singletonLockTarget
    );
    let authorization: ChromiumLockCleanupAuthorizationResponse;
    try {
      authorization = await input.authorizeForeignOwner(request);
    } catch (error) {
      throw new WwebjsChromiumProfileLockRecoveryError(
        'foreign_owner_authorization_failed',
        { scope, error: errorMessage(error) }
      );
    }

    if (
      !isRetryableRuntimeIdentityDenial(request, authorization, lockOwner) ||
      attempt === RUNTIME_IDENTITY_RETRY_DELAYS_MS.length
    ) {
      validateForeignAuthorization(request, authorization, lockOwner, now);
      return authorization;
    }

    await wait(RUNTIME_IDENTITY_RETRY_DELAYS_MS[attempt]);
  }

  throw new WwebjsChromiumProfileLockRecoveryError(
    'foreign_owner_authorization_invalid',
    { scope, reason: 'runtime_identity_retry_exhausted' }
  );
}

async function authorizeScope(
  input: WwebjsChromiumProfileRecoveryInput,
  initial: ChromiumProfileScopeSnapshot,
  currentContainerId: string,
  now: () => number
): Promise<AuthorizedScopeCleanup> {
  const lockOwner = initial.lockOwner;
  if (!lockOwner) {
    throw new WwebjsChromiumProfileLockRecoveryError(
      'singleton_lock_owner_missing',
      { scope: initial.scope }
    );
  }

  if (lockOwner.containerId === currentContainerId) {
    assertCurrentOwnerPidAbsent(lockOwner);
    return { initial, lockOwner };
  }

  assertRecoveryIdentity({
    workerId: input.workerId,
    accountId: input.accountId,
    currentContainerId,
    runtimeGeneration: input.runtimeGeneration,
    sessionVolumeName: input.sessionVolumeName,
  });
  const lock = initial.artifacts.find(({ name }) => name === 'SingletonLock');
  if (!lock?.symlinkTarget) {
    throw new WwebjsChromiumProfileLockRecoveryError(
      'singleton_lock_target_missing',
      { scope: initial.scope }
    );
  }
  const authorization = await requestForeignOwnerAuthorization(
    input,
    currentContainerId,
    lock.symlinkTarget,
    lockOwner,
    initial.scope,
    now
  );
  return { initial, lockOwner, authorization };
}

function currentContainerId(input?: string): string {
  return (input ?? os.hostname()).trim().toLowerCase();
}

export function cleanupWwebjsChromiumProfileArtifactsForCurrentOwnerSync(
  sessionDir: string,
  containerId: string = currentContainerId()
): WwebjsChromiumProfileRecoveryResult {
  if (!CHROMIUM_CONTAINER_ID_PATTERN.test(containerId)) {
    return { recoveredScopes: 0, removedArtifacts: 0 };
  }
  const currentOwnerScopes = snapshotProfile(sessionDir).filter(
    ({ lockOwner }) => lockOwner?.containerId === containerId
  );
  let removedArtifacts = 0;
  let recoveredScopes = 0;
  for (const initial of currentOwnerScopes) {
    const lockOwner = initial.lockOwner;
    if (!lockOwner || inspectOwnerPid(lockOwner.pid) !== 'absent') {
      continue;
    }
    removedArtifacts += removeAuthorizedScope(
      { initial, lockOwner },
      sessionDir,
      containerId,
      Date.now
    );
    recoveredScopes += 1;
  }
  return {
    recoveredScopes,
    removedArtifacts,
  };
}

export async function recoverWwebjsChromiumProfileBeforeLaunch(
  input: WwebjsChromiumProfileRecoveryInput
): Promise<WwebjsChromiumProfileRecoveryResult> {
  const containerId = currentContainerId(input.currentContainerId);
  const initialScopes = snapshotProfile(input.sessionDir).filter(
    ({ lockOwner }) => lockOwner !== undefined
  );
  if (initialScopes.length === 0) {
    return { recoveredScopes: 0, removedArtifacts: 0 };
  }
  if (!CHROMIUM_CONTAINER_ID_PATTERN.test(containerId)) {
    throw new WwebjsChromiumProfileLockRecoveryError(
      'current_container_id_invalid',
      { currentContainerId: containerId }
    );
  }
  const now = input.now ?? Date.now;
  const cleanups = await Promise.all(
    initialScopes.map((initial) =>
      authorizeScope(input, initial, containerId, now)
    )
  );
  let removedArtifacts = 0;
  for (const cleanup of cleanups) {
    removedArtifacts += removeAuthorizedScope(
      cleanup,
      input.sessionDir,
      containerId,
      now
    );
  }
  return {
    recoveredScopes: cleanups.length,
    removedArtifacts,
  };
}
