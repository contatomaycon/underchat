import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  acquireWwebjsSessionLifecycleLease,
  acquireWwebjsSessionMetadataLock,
  beginWwebjsRuntimeSessionActivation,
  ensureWwebjsSessionCandidate,
  inspectWwebjsLocalAuthSession,
  markWwebjsSessionValidated,
  purgeWwebjsSessionQuarantine,
  quarantineWwebjsLocalAuthSession,
  recordWwebjsSessionRestoreFailure,
  type WwebjsSessionGuardContext,
} from '@core/services/wwebjs/methods/sessionGuard';

describe('WWebJS LocalAuth session guard', () => {
  let temporaryRoot: string;
  let context: WwebjsSessionGuardContext;

  const createDurableProfile = (): void => {
    const indexedDb = path.join(
      context.sessionPath,
      'Default',
      'IndexedDB',
      'https_web.whatsapp.com_0.indexeddb.leveldb'
    );
    fs.mkdirSync(indexedDb, { recursive: true });
    fs.writeFileSync(path.join(indexedDb, '000003.log'), 'signal-state');
    fs.writeFileSync(
      path.join(context.sessionPath, 'Default', 'Cookies'),
      'sqlite-cookie-state'
    );
  };

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'underchat-wwebjs-session-')
    );
    const runtimeRootPath = path.join(
      temporaryRoot,
      'wwebjs',
      'storage',
      'worker-w'
    );
    context = {
      sessionPath: path.join(
        runtimeRootPath,
        '.wwebjs_auth',
        'session-worker-w'
      ),
      runtimeRootPath,
      workerId: 'worker-w',
      accountId: 'account-w',
      activationId: 'activation-current',
      activationStartedAt: '2026-07-27T20:22:00.000Z',
      runtimeGeneration: 104,
      sessionVolumeName: 'warm-volume',
      quarantineRootPath: path.join(
        temporaryRoot,
        '.underchat-quarantine',
        'wwebjs',
        'worker-w'
      ),
      lockRootPath: path.join(
        temporaryRoot,
        '.underchat-locks',
        'wwebjs',
        'worker-w'
      ),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  it('does not treat a merely non-empty LocalAuth directory as restorable', () => {
    fs.mkdirSync(path.join(context.sessionPath, 'Default', 'Cache'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(context.sessionPath, 'Default', 'Cache', 'cache.bin'),
      'browser-cache'
    );
    fs.writeFileSync(
      path.join(context.sessionPath, 'SingletonLock'),
      'stale-lock'
    );

    expect(inspectWwebjsLocalAuthSession(context, 3)).toMatchObject({
      exists: true,
      hasDurableAuthArtifacts: false,
      restorable: false,
      blockedReason: 'missing_auth_artifacts',
    });
  });

  it('accepts a legacy profile only when durable WhatsApp auth artifacts exist', () => {
    createDurableProfile();

    expect(inspectWwebjsLocalAuthSession(context, 3)).toMatchObject({
      exists: true,
      hasDurableAuthArtifacts: true,
      restorable: true,
      incompleteActivationDetected: false,
    });
  });

  it('detects a candidate left by an unfinished runtime activation and exhausts it after one failure', () => {
    createDurableProfile();
    const previousContext = {
      ...context,
      activationId: 'activation-previous',
      runtimeGeneration: 103,
    };
    beginWwebjsRuntimeSessionActivation(
      previousContext,
      '2026-07-27T19:36:30.000Z'
    );
    ensureWwebjsSessionCandidate(
      previousContext,
      'legacy_profile',
      false,
      '2026-07-27T19:36:31.000Z'
    );

    const inherited = inspectWwebjsLocalAuthSession(context, 3);
    expect(inherited.incompleteActivationDetected).toBe(true);
    beginWwebjsRuntimeSessionActivation(context, '2026-07-27T20:22:00.000Z');
    ensureWwebjsSessionCandidate(
      context,
      'legacy_profile',
      inherited.incompleteActivationDetected,
      '2026-07-27T20:22:02.000Z'
    );
    recordWwebjsSessionRestoreFailure(
      context,
      'UNPAIRED',
      'persistent_unpaired',
      '2026-07-27T20:22:32.000Z'
    );

    expect(inspectWwebjsLocalAuthSession(context, 1)).toMatchObject({
      restorable: false,
      blockedReason: 'restore_attempts_exhausted',
      marker: {
        state: 'candidate',
        restore_failures: 1,
        incomplete_activation_detected: true,
      },
    });
  });

  it('does not classify a previously validated session as an incomplete activation', () => {
    createDurableProfile();
    const previousContext = {
      ...context,
      activationId: 'activation-previous',
      runtimeGeneration: 103,
    };
    beginWwebjsRuntimeSessionActivation(
      previousContext,
      '2026-07-27T19:36:30.000Z'
    );
    markWwebjsSessionValidated(previousContext, '2026-07-27T19:37:00.000Z');

    expect(inspectWwebjsLocalAuthSession(context, 3)).toMatchObject({
      restorable: true,
      incompleteActivationDetected: false,
      marker: {
        state: 'validated',
        restore_failures: 0,
      },
    });
  });

  it('quarantines instead of deleting an exhausted profile', () => {
    createDurableProfile();
    beginWwebjsRuntimeSessionActivation(context);
    ensureWwebjsSessionCandidate(context, 'legacy_profile');
    recordWwebjsSessionRestoreFailure(
      context,
      'UNPAIRED',
      'persistent_unpaired'
    );

    const result = quarantineWwebjsLocalAuthSession(
      context,
      'persistent_unpaired_restore_exhausted',
      Date.parse('2026-07-27T20:23:00.000Z')
    );

    expect(result).toMatchObject({
      blocked: true,
      moved: true,
    });
    expect(fs.existsSync(context.sessionPath)).toBe(false);
    const quarantinePath = result.quarantinePath;
    expect(quarantinePath).toBeDefined();
    if (!quarantinePath) {
      throw new Error('Expected the session to be moved to quarantine');
    }
    expect(
      fs.readFileSync(path.join(quarantinePath, 'Default', 'Cookies'), 'utf8')
    ).toBe('sqlite-cookie-state');
    fs.rmSync(context.runtimeRootPath, { recursive: true, force: true });
    expect(
      fs.readFileSync(path.join(quarantinePath, 'Default', 'Cookies'), 'utf8')
    ).toBe('sqlite-cookie-state');
    expect(purgeWwebjsSessionQuarantine(context)).toEqual({ purged: true });
    expect(fs.existsSync(quarantinePath)).toBe(false);
    expect(inspectWwebjsLocalAuthSession(context, 3).restorable).toBe(false);
  });

  it('refuses to copy or delete a session when quarantine is on another filesystem', () => {
    createDurableProfile();
    beginWwebjsRuntimeSessionActivation(context);
    ensureWwebjsSessionCandidate(context, 'legacy_profile');
    const originalStatSync = fs.statSync;
    const quarantineRootPath = context.quarantineRootPath;
    if (!quarantineRootPath) {
      throw new Error('Expected a dedicated quarantine root');
    }
    jest.spyOn(fs, 'statSync').mockImplementation(((target: fs.PathLike) => {
      const stat = originalStatSync(target);
      if (path.resolve(String(target)) !== path.resolve(quarantineRootPath)) {
        return stat;
      }
      return new Proxy(stat, {
        get(value, property, receiver) {
          if (property === 'dev') {
            return Number(value.dev) + 1;
          }
          return Reflect.get(value, property, receiver);
        },
      });
    }) as typeof fs.statSync);

    expect(
      quarantineWwebjsLocalAuthSession(
        context,
        'cross_device_guard',
        Date.parse('2026-07-27T20:23:00.000Z')
      )
    ).toMatchObject({
      blocked: true,
      moved: false,
      error: 'wwebjs_session_quarantine_cross_device_refused',
    });
    expect(fs.existsSync(context.sessionPath)).toBe(true);
    expect(
      fs.readFileSync(
        path.join(context.sessionPath, 'Default', 'Cookies'),
        'utf8'
      )
    ).toBe('sqlite-cookie-state');
  });

  it('fails closed when a present session marker is malformed', () => {
    createDurableProfile();
    fs.writeFileSync(
      path.join(context.sessionPath, '.underchat-session-state.json'),
      '{"state":"validated"'
    );

    expect(inspectWwebjsLocalAuthSession(context, 3)).toMatchObject({
      exists: true,
      hasDurableAuthArtifacts: true,
      restorable: false,
      blockedReason: 'invalid_marker',
      invalidMarker: true,
    });
  });

  it('does not reset the restore budget when restore_failures is missing or invalid', () => {
    createDurableProfile();
    const markerPath = path.join(
      context.sessionPath,
      '.underchat-session-state.json'
    );
    const baseMarker = {
      version: 1,
      worker_id: context.workerId,
      account_id: context.accountId,
      state: 'candidate',
      source: 'legacy_profile',
      created_at: '2026-07-27T20:20:00.000Z',
      updated_at: '2026-07-27T20:21:00.000Z',
    };

    fs.writeFileSync(markerPath, JSON.stringify(baseMarker));
    expect(inspectWwebjsLocalAuthSession(context, 3)).toMatchObject({
      restorable: false,
      blockedReason: 'invalid_marker',
      invalidMarker: true,
    });

    fs.writeFileSync(
      markerPath,
      JSON.stringify({ ...baseMarker, restore_failures: '2' })
    );
    expect(inspectWwebjsLocalAuthSession(context, 3)).toMatchObject({
      restorable: false,
      blockedReason: 'invalid_marker',
      invalidMarker: true,
    });
  });

  it('fences an older runtime generation from mutating or quarantining the active profile', () => {
    createDurableProfile();
    const olderContext = {
      ...context,
      activationId: 'activation-older',
      activationStartedAt: '2026-07-27T20:20:00.000Z',
      runtimeGeneration: 103,
    };
    beginWwebjsRuntimeSessionActivation(olderContext);
    ensureWwebjsSessionCandidate(olderContext, 'legacy_profile');

    beginWwebjsRuntimeSessionActivation(context);

    expect(() =>
      recordWwebjsSessionRestoreFailure(
        olderContext,
        'UNPAIRED',
        'persistent_unpaired'
      )
    ).toThrow('wwebjs_session_activation_fenced');
    expect(
      quarantineWwebjsLocalAuthSession(
        olderContext,
        'stale_older_runtime',
        Date.parse('2026-07-27T20:23:00.000Z')
      )
    ).toMatchObject({
      blocked: true,
      moved: false,
      error: expect.stringContaining('wwebjs_session_activation_fenced'),
    });
    expect(fs.existsSync(context.sessionPath)).toBe(true);
    expect(markWwebjsSessionValidated(context)).toMatchObject({
      state: 'validated',
      restore_failures: 0,
    });
  });

  it('uses a kernel lock while mutating session ownership', () => {
    createDurableProfile();
    beginWwebjsRuntimeSessionActivation(context);
    ensureWwebjsSessionCandidate(context, 'legacy_profile');
    const lease = acquireWwebjsSessionMetadataLock(context);
    try {
      expect(() =>
        recordWwebjsSessionRestoreFailure(
          context,
          'UNPAIRED',
          'persistent_unpaired'
        )
      ).toThrow('wwebjs_session_metadata_lock_busy');
      expect(inspectWwebjsLocalAuthSession(context, 3)).toMatchObject({
        restorable: true,
        marker: {
          restore_failures: 0,
        },
      });
    } finally {
      lease.release();
    }
  });

  it('keeps lifecycle exclusion outside clearFolder and admits a third contender only after release', () => {
    fs.mkdirSync(context.runtimeRootPath, { recursive: true });
    fs.writeFileSync(
      path.join(context.runtimeRootPath, 'runtime-data'),
      'data'
    );
    const first = acquireWwebjsSessionLifecycleLease(context);

    expect(() => acquireWwebjsSessionLifecycleLease(context)).toThrow(
      'wwebjs_session_lifecycle_lock_busy'
    );
    fs.rmSync(context.runtimeRootPath, { recursive: true, force: true });
    expect(fs.existsSync(first.lockPath)).toBe(true);
    expect(() => acquireWwebjsSessionLifecycleLease(context)).toThrow(
      'wwebjs_session_lifecycle_lock_busy'
    );

    first.release();
    const third = acquireWwebjsSessionLifecycleLease(context);
    expect(third.lockPath).toBe(first.lockPath);
    third.release();
  });

  it('automatically releases the lifecycle lock when its owning process crashes', async () => {
    const seed = acquireWwebjsSessionLifecycleLease(context);
    const lockPath = seed.lockPath;
    seed.release();

    const owner = spawn(
      '/usr/bin/flock',
      [
        '--exclusive',
        '--no-fork',
        lockPath,
        '/bin/sh',
        '-c',
        'printf ready; read _; exit 137',
      ],
      { stdio: ['pipe', 'pipe', 'ignore'] }
    );
    if (!owner.stdout) {
      throw new Error('Expected lock owner stdout');
    }
    await Promise.race([
      once(owner.stdout, 'data'),
      once(owner, 'exit').then(([code]) => {
        throw new Error(`Lock owner exited before readiness with code ${code}`);
      }),
    ]);
    try {
      expect(() => acquireWwebjsSessionLifecycleLease(context)).toThrow(
        'wwebjs_session_lifecycle_lock_busy'
      );
    } finally {
      const ownerExit = once(owner, 'exit');
      owner.stdin?.end('simulate-crash');
      await ownerExit;
    }
    const recovered = acquireWwebjsSessionLifecycleLease(context);
    recovered.release();
  });

  it('fails closed when the flock backend is unavailable', () => {
    const previousCommand = process.env.WWEBJS_FLOCK_COMMAND;
    process.env.WWEBJS_FLOCK_COMMAND =
      '/definitely-missing/underchat-flock-backend';
    try {
      expect(() => acquireWwebjsSessionLifecycleLease(context)).toThrow(
        'wwebjs_session_activation_fenced:session_lifecycle_lock_backend_unavailable'
      );
    } finally {
      if (previousCommand === undefined) {
        delete process.env.WWEBJS_FLOCK_COMMAND;
      } else {
        process.env.WWEBJS_FLOCK_COMMAND = previousCommand;
      }
    }
  });

  it('installs the flock backend in the WWebJS runtime image', () => {
    const dockerfile = fs.readFileSync(
      path.join(process.cwd(), 'apps', 'worker_wwebjs', 'Dockerfile'),
      'utf8'
    );
    const runtimeStage = dockerfile.slice(
      dockerfile.lastIndexOf('FROM node:24.12.0-bookworm-slim')
    );
    expect(runtimeStage).toMatch(
      /apt-get install -y --no-install-recommends[\s\S]*\butil-linux\b/
    );
  });

  it('does not delete Chromium ownership files before the lifecycle lease is acquired', () => {
    const entrypoint = fs.readFileSync(
      path.join(process.cwd(), 'apps', 'worker_wwebjs', 'docker-entrypoint.sh'),
      'utf8'
    );

    expect(entrypoint).not.toMatch(/Singleton(?:Lock|Socket|Cookie)|\brm\b/);
  });
});
