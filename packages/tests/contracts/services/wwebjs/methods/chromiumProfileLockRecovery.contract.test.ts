import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import {
  ChromiumLockCleanupAuthorizationRequest,
  ChromiumLockCleanupAuthorizationResponse,
  recoverWwebjsChromiumProfileBeforeLaunch,
  WwebjsChromiumProfileRecoveryInput,
} from '@core/services/wwebjs/methods/chromiumProfileLockRecovery';

const currentContainerId = 'aaaaaaaaaaaa';
const foreignContainerId = 'bbbbbbbbbbbb';
const absentPid = 2_147_483_647;
const workerId = '019fa877-9f95-7518-9753-3f4e32569dee';
const accountId = '019a930d-c6f4-75ad-88ff-8d2fcd5839e1';
const sessionVolumeName = 'warm-session-volume';
const fixedNow = 1_785_249_000_000;

function artifactExists(filePath: string): boolean {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      String((error as { code?: unknown }).code) === 'ENOENT'
    ) {
      return false;
    }
    throw error;
  }
}

function writeChromiumArtifacts(directory: string, lockTarget: string): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.symlinkSync('cookie-target', path.join(directory, 'SingletonCookie'));
  fs.symlinkSync('socket-target', path.join(directory, 'SingletonSocket'));
  fs.symlinkSync(lockTarget, path.join(directory, 'SingletonLock'));
}

function approvedResponse(
  request: ChromiumLockCleanupAuthorizationRequest
): ChromiumLockCleanupAuthorizationResponse {
  const ownerContainerId = request.singleton_lock_target.slice(
    0,
    request.singleton_lock_target.lastIndexOf('-')
  );
  return {
    authorized: true,
    reason: 'authorized',
    request_id: request.request_id,
    requester_container_id: request.requester_container_id,
    owner_container_id: ownerContainerId,
    session_volume_name: request.session_volume_name,
    singleton_lock_target: request.singleton_lock_target,
    expires_at_unix_ms: fixedNow + 1_000,
  };
}

describe('WWebJS Chromium profile lock recovery', () => {
  let temporaryRoot: string;
  let sessionDir: string;
  let authorizeForeignOwner: jest.Mock<
    Promise<ChromiumLockCleanupAuthorizationResponse>,
    [ChromiumLockCleanupAuthorizationRequest]
  >;
  let waitBeforeAuthorizationRetry: jest.Mock<Promise<void>, [number]>;

  const buildInput = (
    overrides: Partial<WwebjsChromiumProfileRecoveryInput> = {}
  ): WwebjsChromiumProfileRecoveryInput => ({
    sessionDir,
    workerId,
    accountId,
    runtimeGeneration: 7,
    sessionVolumeName,
    currentContainerId,
    authorizeForeignOwner,
    now: () => fixedNow,
    waitBeforeAuthorizationRetry,
    ...overrides,
  });

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'underchat-chromium-lock-')
    );
    sessionDir = path.join(temporaryRoot, 'session-worker');
    fs.mkdirSync(sessionDir, { recursive: true });
    authorizeForeignOwner = jest.fn(async (request) =>
      approvedResponse(request)
    );
    waitBeforeAuthorizationRetry = jest.fn<Promise<void>, [number]>(
      async (_delayMs) => undefined
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  it('removes a current-container lock only when its proc owner is ENOENT', async () => {
    writeChromiumArtifacts(sessionDir, `${currentContainerId}-${absentPid}`);

    await expect(
      recoverWwebjsChromiumProfileBeforeLaunch(buildInput())
    ).resolves.toEqual({
      recoveredScopes: 1,
      removedArtifacts: 3,
    });

    expect(authorizeForeignOwner).not.toHaveBeenCalled();
    expect(artifactExists(path.join(sessionDir, 'SingletonLock'))).toBe(false);
  });

  it('preserves a trustworthy current Chrome lock while its PID exists', async () => {
    writeChromiumArtifacts(sessionDir, `${currentContainerId}-${process.pid}`);

    await expect(
      recoverWwebjsChromiumProfileBeforeLaunch(buildInput())
    ).rejects.toMatchObject({
      reason: 'current_owner_pid_present',
    });

    expect(authorizeForeignOwner).not.toHaveBeenCalled();
    expect(artifactExists(path.join(sessionDir, 'SingletonLock'))).toBe(true);
  });

  it('does not treat ESRCH or a proc inspection error as owner absence', async () => {
    writeChromiumArtifacts(sessionDir, `${currentContainerId}-${absentPid}`);
    const statSync = jest.spyOn(fs, 'statSync');

    for (const code of ['ESRCH', 'EACCES']) {
      statSync.mockImplementationOnce(() => {
        throw Object.assign(new Error(`proc ${code}`), { code });
      });
      await expect(
        recoverWwebjsChromiumProfileBeforeLaunch(buildInput())
      ).rejects.toMatchObject({
        reason: 'current_owner_pid_unreadable',
      });
    }

    expect(artifactExists(path.join(sessionDir, 'SingletonLock'))).toBe(true);
  });

  it('uses only the Balance authorization path for a foreign owner', async () => {
    writeChromiumArtifacts(sessionDir, `${foreignContainerId}-${absentPid}`);

    await expect(
      recoverWwebjsChromiumProfileBeforeLaunch(buildInput())
    ).resolves.toEqual({
      recoveredScopes: 1,
      removedArtifacts: 3,
    });

    expect(authorizeForeignOwner).toHaveBeenCalledTimes(1);
    expect(authorizeForeignOwner.mock.calls[0]?.[0]).toMatchObject({
      worker_id: workerId,
      account_id: accountId,
      worker_type_id: EWorkerType.wwebjs,
      runtime_generation: 7,
      requester_container_id: currentContainerId,
      session_volume_name: sessionVolumeName,
      singleton_lock_target: `${foreignContainerId}-${absentPid}`,
    });
  });

  it('preserves every artifact when Balance denies a foreign owner', async () => {
    writeChromiumArtifacts(sessionDir, `${foreignContainerId}-${absentPid}`);
    authorizeForeignOwner.mockImplementationOnce(async (request) => ({
      ...approvedResponse(request),
      authorized: false,
      reason: 'lock_owner_present',
    }));

    await expect(
      recoverWwebjsChromiumProfileBeforeLaunch(buildInput())
    ).rejects.toMatchObject({
      reason: 'foreign_owner_authorization_invalid',
    });

    expect(artifactExists(path.join(sessionDir, 'SingletonCookie'))).toBe(true);
    expect(artifactExists(path.join(sessionDir, 'SingletonSocket'))).toBe(true);
    expect(artifactExists(path.join(sessionDir, 'SingletonLock'))).toBe(true);
    expect(waitBeforeAuthorizationRetry).not.toHaveBeenCalled();
  });

  it('retries a fully echoed runtime transition denial without waiting for the outer reconnect', async () => {
    writeChromiumArtifacts(sessionDir, `${foreignContainerId}-${absentPid}`);
    authorizeForeignOwner
      .mockImplementationOnce(async (request) => ({
        ...approvedResponse(request),
        authorized: false,
        reason: 'runtime_identity_mismatch',
        expires_at_unix_ms: 0,
      }))
      .mockImplementationOnce(async (request) => ({
        ...approvedResponse(request),
        authorized: false,
        reason: 'runtime_identity_mismatch',
        expires_at_unix_ms: 0,
      }))
      .mockImplementationOnce(async (request) => approvedResponse(request));

    await expect(
      recoverWwebjsChromiumProfileBeforeLaunch(buildInput())
    ).resolves.toEqual({
      recoveredScopes: 1,
      removedArtifacts: 3,
    });

    expect(authorizeForeignOwner).toHaveBeenCalledTimes(3);
    expect(waitBeforeAuthorizationRetry.mock.calls).toEqual([[50], [100]]);
    expect(
      new Set(authorizeForeignOwner.mock.calls.map(([item]) => item.request_id))
        .size
    ).toBe(3);
  });

  it('fails closed after the bounded runtime identity retry budget', async () => {
    writeChromiumArtifacts(sessionDir, `${foreignContainerId}-${absentPid}`);
    authorizeForeignOwner.mockImplementation(async (request) => ({
      ...approvedResponse(request),
      authorized: false,
      reason: 'runtime_identity_mismatch',
      expires_at_unix_ms: 0,
    }));

    await expect(
      recoverWwebjsChromiumProfileBeforeLaunch(buildInput())
    ).rejects.toMatchObject({
      reason: 'foreign_owner_authorization_invalid',
      details: { reason: 'runtime_identity_mismatch' },
    });

    expect(authorizeForeignOwner).toHaveBeenCalledTimes(7);
    expect(waitBeforeAuthorizationRetry.mock.calls).toEqual([
      [50],
      [100],
      [200],
      [400],
      [800],
      [1_000],
    ]);
    expect(artifactExists(path.join(sessionDir, 'SingletonLock'))).toBe(true);
  });

  it('does not retry a transition denial with a divergent response echo', async () => {
    writeChromiumArtifacts(sessionDir, `${foreignContainerId}-${absentPid}`);
    authorizeForeignOwner.mockImplementationOnce(async (request) => ({
      ...approvedResponse(request),
      authorized: false,
      reason: 'runtime_identity_mismatch',
      request_id: 'different-request',
      expires_at_unix_ms: 0,
    }));

    await expect(
      recoverWwebjsChromiumProfileBeforeLaunch(buildInput())
    ).rejects.toMatchObject({
      reason: 'foreign_owner_authorization_invalid',
    });

    expect(authorizeForeignOwner).toHaveBeenCalledTimes(1);
    expect(waitBeforeAuthorizationRetry).not.toHaveBeenCalled();
    expect(artifactExists(path.join(sessionDir, 'SingletonLock'))).toBe(true);
  });

  it.each([
    '../../etc/passwd-26',
    `${foreignContainerId}-0`,
    'not-a-container-26',
  ])('rejects malformed SingletonLock target %s', async (lockTarget) => {
    writeChromiumArtifacts(sessionDir, lockTarget);

    await expect(
      recoverWwebjsChromiumProfileBeforeLaunch(buildInput())
    ).rejects.toMatchObject({
      reason: 'singleton_lock_target_invalid',
    });

    expect(authorizeForeignOwner).not.toHaveBeenCalled();
    expect(artifactExists(path.join(sessionDir, 'SingletonLock'))).toBe(true);
  });

  it('blocks a session path whose ancestor resolves through a symlink', async () => {
    const realRoot = path.join(temporaryRoot, 'real-root');
    const linkedRoot = path.join(temporaryRoot, 'linked-root');
    fs.mkdirSync(realRoot);
    fs.symlinkSync(realRoot, linkedRoot);
    sessionDir = path.join(linkedRoot, 'session-worker');
    writeChromiumArtifacts(sessionDir, `${foreignContainerId}-${absentPid}`);

    await expect(
      recoverWwebjsChromiumProfileBeforeLaunch(buildInput())
    ).rejects.toMatchObject({
      name: 'WwebjsChromiumProfileLockRecoveryError',
    });

    expect(authorizeForeignOwner).not.toHaveBeenCalled();
    expect(artifactExists(path.join(sessionDir, 'SingletonLock'))).toBe(true);
  });

  it('rejects a regular file masquerading as SingletonLock', async () => {
    fs.writeFileSync(path.join(sessionDir, 'SingletonLock'), 'stale');

    await expect(
      recoverWwebjsChromiumProfileBeforeLaunch(buildInput())
    ).rejects.toMatchObject({
      reason: 'singleton_lock_not_symlink',
    });

    expect(authorizeForeignOwner).not.toHaveBeenCalled();
    expect(
      fs.readFileSync(path.join(sessionDir, 'SingletonLock'), 'utf8')
    ).toBe('stale');
  });

  it('blocks cleanup when an artifact changes while authorization is pending', async () => {
    writeChromiumArtifacts(sessionDir, `${foreignContainerId}-${absentPid}`);
    authorizeForeignOwner.mockImplementationOnce(async (request) => {
      const lockPath = path.join(sessionDir, 'SingletonLock');
      fs.unlinkSync(lockPath);
      fs.symlinkSync(request.singleton_lock_target, lockPath);
      return approvedResponse(request);
    });

    await expect(
      recoverWwebjsChromiumProfileBeforeLaunch(buildInput())
    ).rejects.toMatchObject({
      reason: 'profile_artifact_changed',
    });

    expect(artifactExists(path.join(sessionDir, 'SingletonLock'))).toBe(true);
  });

  it('rejects an authorization that is already expired', async () => {
    writeChromiumArtifacts(sessionDir, `${foreignContainerId}-${absentPid}`);
    authorizeForeignOwner.mockImplementationOnce(async (request) => ({
      ...approvedResponse(request),
      expires_at_unix_ms: fixedNow,
    }));

    await expect(
      recoverWwebjsChromiumProfileBeforeLaunch(buildInput())
    ).rejects.toMatchObject({
      reason: 'foreign_owner_authorization_invalid',
    });

    expect(artifactExists(path.join(sessionDir, 'SingletonLock'))).toBe(true);
  });

  it.each([
    ['request_id', 'different-request'],
    ['requester_container_id', 'cccccccccccc'],
    ['owner_container_id', 'dddddddddddd'],
    ['singleton_lock_target', `${foreignContainerId}-999`],
  ] as const)(
    'rejects authorization with divergent %s echo',
    async (field, value) => {
      writeChromiumArtifacts(sessionDir, `${foreignContainerId}-${absentPid}`);
      authorizeForeignOwner.mockImplementationOnce(async (request) => ({
        ...approvedResponse(request),
        [field]: value,
      }));

      await expect(
        recoverWwebjsChromiumProfileBeforeLaunch(buildInput())
      ).rejects.toMatchObject({
        reason: 'foreign_owner_authorization_invalid',
      });

      expect(artifactExists(path.join(sessionDir, 'SingletonLock'))).toBe(true);
    }
  );

  it('blocks browser launch and keeps SingletonLock when unlink fails', async () => {
    writeChromiumArtifacts(sessionDir, `${foreignContainerId}-${absentPid}`);
    const unlinkSync = fs.unlinkSync.bind(fs);
    jest.spyOn(fs, 'unlinkSync').mockImplementation((filePath) => {
      if (path.basename(String(filePath)) === 'SingletonSocket') {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      }
      unlinkSync(filePath);
    });

    await expect(
      recoverWwebjsChromiumProfileBeforeLaunch(buildInput())
    ).rejects.toMatchObject({
      reason: 'profile_artifact_unlink_failed',
      details: {
        name: 'SingletonSocket',
      },
    });

    expect(artifactExists(path.join(sessionDir, 'SingletonLock'))).toBe(true);
  });

  it('recovers an authorized lock in the Default profile scope', async () => {
    const defaultProfile = path.join(sessionDir, 'Default');
    writeChromiumArtifacts(
      defaultProfile,
      `${foreignContainerId}-${absentPid}`
    );

    await expect(
      recoverWwebjsChromiumProfileBeforeLaunch(buildInput())
    ).resolves.toEqual({
      recoveredScopes: 1,
      removedArtifacts: 3,
    });

    expect(artifactExists(path.join(defaultProfile, 'SingletonLock'))).toBe(
      false
    );
  });
});
