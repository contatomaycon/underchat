import { ChildProcess, spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  WORKER_CONTAINER_FREEZE_DETECTOR_BOUND_MS,
  WORKER_CONTAINER_HEALTH_INTERVAL_MS,
  WORKER_CONTAINER_HEALTH_RETRIES,
  WORKER_CONTAINER_HEALTH_START_INTERVAL_MS,
  WORKER_CONTAINER_HEALTH_TIMEOUT_MS,
  WORKER_CONTAINER_LIVENESS_MAX_JITTER_MS,
  WORKER_CONTAINER_LIVENESS_REMOTE_PHASE_TIMEOUT_MS,
  WORKER_CONTAINER_LIVENESS_REMOTE_OBSERVATION_PHASES,
  WORKER_CONTAINER_LIVENESS_SCAN_INTERVAL_MS,
  WORKER_CONTAINER_STARTUP_FALLBACK_BOUND_MS,
  WORKER_CONTAINER_STARTUP_FALLBACK_PROBES,
} from '@core/common/functions/workerContainerLivenessPolicy';
import {
  BALANCE_API_MAX_SHUTDOWN_TIMEOUT_MS,
  installBalanceApiGracefulShutdown,
} from '@core/common/functions/balanceApiGracefulShutdown';

const PROJECT_ROOT = resolve(__dirname, '../../../../');
const HEALTHCHECK_SCRIPT = join(
  PROJECT_ROOT,
  'scripts/worker-liveness-healthcheck.sh'
);
const ENTRYPOINT_SCRIPT = join(
  PROJECT_ROOT,
  'scripts/worker-liveness-entrypoint.sh'
);
const CONDITIONAL_REMOVE_SCRIPT = join(
  PROJECT_ROOT,
  'scripts/worker-liveness-conditional-remove.sh'
);
const HAS_LOCAL_DOCKER_FIXTURE =
  spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0 &&
  spawnSync('docker', ['image', 'inspect', 'alpine:3.20'], {
    stdio: 'ignore',
  }).status === 0;
const dockerFixtureIt = HAS_LOCAL_DOCKER_FIXTURE ? it : it.skip;

function readProjectFile(relativePath: string): string {
  return readFileSync(join(PROJECT_ROOT, relativePath), 'utf8');
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for liveness fixture');
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
}

async function waitForExit(
  child: ChildProcess,
  timeoutMs = 2_000
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await Promise.race([
    new Promise<void>((resolvePromise) => {
      child.once('exit', () => resolvePromise());
    }),
    new Promise<never>((_resolvePromise, rejectPromise) => {
      setTimeout(
        () => rejectPromise(new Error('Timed out waiting for worker exit')),
        timeoutMs
      );
    }),
  ]);
}

function isRunning(child: ChildProcess): boolean {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    return false;
  }

  try {
    process.kill(child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function runConditionalRemoveFixture(
  directory: string,
  scenario: string,
  removeStarting = false,
  retiredLifecycleOperationId = ''
): {
  calls: string[];
  durationMs: number;
  result: {
    status: string;
    reason: string;
    observed_restart_count?: number;
  };
} {
  const fakeDocker = join(directory, 'docker');
  const callsFile = join(
    directory,
    `calls-${scenario}-${removeStarting}-${retiredLifecycleOperationId}`
  );
  const stateFile = join(
    directory,
    `state-${scenario}-${removeStarting}-${retiredLifecycleOperationId}`
  );
  const containerId = 'a'.repeat(64);
  const replacementId = 'b'.repeat(64);
  writeFileSync(
    fakeDocker,
    String.raw`#!/bin/sh
set -u
printf '%s\n' "$*" >>"$FAKE_DOCKER_CALLS"
command_name=$1
shift

case "$command_name" in
  update)
    if [ "$FAKE_SCENARIO" = "wrong_not_found" ]; then
      printf 'Error response from daemon: No such container: %s\n' "$FAKE_REPLACEMENT_ID" >&2
      exit 1
    fi
    exit 0
    ;;
  start)
    exit 0
    ;;
  inspect)
    if [ "$FAKE_SCENARIO" = "ambiguous" ] && [ -f "$FAKE_DOCKER_STATE.absent" ]; then
      printf 'Error response from daemon: No such container: %s\n' "$FAKE_CONTAINER_ID" >&2
      exit 1
    fi
    if [ "$1" != "--format" ]; then
      if [ "$FAKE_SCENARIO" = "recovered_transient" ]; then
        restore_count=$(cat "$FAKE_DOCKER_STATE.restore" 2>/dev/null || printf '0')
        restore_count=$((restore_count + 1))
        printf '%s\n' "$restore_count" >"$FAKE_DOCKER_STATE.restore"
        if [ "$restore_count" -eq 1 ]; then
          printf '%s\n' 'docker daemon temporarily unavailable' >&2
          exit 1
        fi
      fi
      exit 0
    fi
    format=$2
    if [ "$format" = "{{.State.Running}}" ]; then
      printf '%s\n' 'true'
      exit 0
    fi
    if [ "$FAKE_SCENARIO" = "hang" ]; then
      exec sleep 300
    fi
    observed_id=$FAKE_CONTAINER_ID
    observed_started_at='2026-07-29T22:00:00Z'
    observed_restart_count=0
    observed_health_status=unhealthy
    observed_account_id=account-1
    case "$FAKE_SCENARIO" in
      recovered|recovered_transient)
        observed_started_at='2026-07-29T22:01:00Z'
        observed_restart_count=1
        observed_health_status=healthy
        ;;
      starting)
        observed_started_at='2026-07-29T22:01:00Z'
        observed_restart_count=1
        observed_health_status=starting
        ;;
      stale)
        observed_id=$FAKE_REPLACEMENT_ID
        observed_account_id=different-account
        ;;
    esac
    printf '%s|/worker-1|%s|%s|%s|false|true|worker-1|%s|server-1|019a930d-c6f6-766d-9c84-62b9c3e7d1f0|7|||\n' \
      "$observed_id" "$observed_started_at" "$observed_restart_count" \
      "$observed_health_status" "$observed_account_id"
    ;;
  rm)
    if [ "$FAKE_SCENARIO" = "ambiguous" ]; then
      : >"$FAKE_DOCKER_STATE.absent"
      printf '%s\n' 'response lost after remove' >&2
      exit 1
    fi
    exit 0
    ;;
  *)
    printf '%s\n' "unexpected docker command: $command_name" >&2
    exit 1
    ;;
esac
`,
    { mode: 0o755 }
  );
  chmodSync(fakeDocker, 0o755);

  const startedAt = Date.now();
  const execution = spawnSync(
    'sh',
    [
      CONDITIONAL_REMOVE_SCRIPT,
      containerId,
      '2026-07-29T22:00:00Z',
      '0',
      'unhealthy',
      'false',
      'worker-1',
      'account-1',
      'server-1',
      '019a930d-c6f6-766d-9c84-62b9c3e7d1f0',
      '7',
      String(removeStarting),
      '',
      '',
      retiredLifecycleOperationId,
    ],
    {
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH ?? ''}`,
        FAKE_DOCKER_CALLS: callsFile,
        FAKE_DOCKER_STATE: stateFile,
        FAKE_SCENARIO: scenario,
        FAKE_CONTAINER_ID: containerId,
        FAKE_REPLACEMENT_ID: replacementId,
        UNDERCHAT_LIVENESS_STATE_DIR: join(directory, 'locks'),
      },
      encoding: 'utf8',
      timeout: 15_000,
    }
  );
  const durationMs = Date.now() - startedAt;
  if (execution.error) {
    throw execution.error;
  }
  expect(execution.status).toBe(0);
  const resultLine = execution.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (!resultLine) {
    throw new Error(
      `Conditional remove returned no result: ${execution.stderr}`
    );
  }

  return {
    calls: readFileSync(callsFile, 'utf8').split(/\r?\n/u).filter(Boolean),
    durationMs,
    result: JSON.parse(resultLine) as {
      status: string;
      reason: string;
      observed_restart_count?: number;
    },
  };
}

describe('worker container liveness contract', () => {
  const temporaryDirectories: string[] = [];
  const children: ChildProcess[] = [];

  afterEach(() => {
    jest.useRealTimers();
    for (const child of children) {
      if (isRunning(child)) {
        child.kill('SIGKILL');
      }
    }
    children.length = 0;

    for (const directory of temporaryDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
    temporaryDirectories.length = 0;
  });

  it('installs the same local-only Docker health probe in all worker images', () => {
    const dockerfiles = [
      'apps/worker_baileys/Dockerfile',
      'apps/worker_wwebjs/Dockerfile',
      'apps/worker_whatsmeow/Dockerfile',
    ].map(readProjectFile);

    for (const dockerfile of dockerfiles) {
      expect(dockerfile).toContain(
        'HEALTHCHECK --interval=15s --timeout=4s --start-period=90s --start-interval=15s --retries=3'
      );
      expect(dockerfile).toContain(
        'CMD ["/usr/local/bin/worker-liveness-healthcheck"]'
      );
      expect(dockerfile).toContain(
        'COPY scripts/worker-liveness-healthcheck.sh /usr/local/bin/worker-liveness-healthcheck'
      );
      expect(dockerfile).toContain(
        'COPY scripts/worker-liveness-entrypoint.sh /usr/local/bin/worker-liveness-entrypoint'
      );
      expect(dockerfile).toContain('STOPSIGNAL SIGTERM');
    }

    const healthcheck = readProjectFile(
      'scripts/worker-liveness-healthcheck.sh'
    );
    const executableHealthcheck = healthcheck
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(healthcheck).toContain('http://127.0.0.1:3005/v1/health/check');
    expect(executableHealthcheck).not.toMatch(/kafka|redis|balance|whatsapp/i);
    expect(healthcheck).toContain('local_fallback_after=5');
    expect(healthcheck).toContain('startup_fallback_after=10');
    expect(WORKER_CONTAINER_HEALTH_START_INTERVAL_MS).toBe(15_000);
    expect(WORKER_CONTAINER_STARTUP_FALLBACK_PROBES).toBe(10);
    expect(WORKER_CONTAINER_STARTUP_FALLBACK_BOUND_MS).toBe(190_000);
    expect(WORKER_CONTAINER_STARTUP_FALLBACK_BOUND_MS).toBeLessThan(240_000);
    expect(healthcheck).toContain('kill -KILL "${target_pid}"');
    expect(healthcheck).not.toMatch(/kill\s+-KILL\s+1(?:\s|$)/);
  });

  it('does not declare an implicit Whatsmeow data volume in the image', () => {
    const dockerfile = readProjectFile('apps/worker_whatsmeow/Dockerfile');

    expect(dockerfile).toContain('mkdir -p /app/data');
    expect(dockerfile).not.toMatch(
      /^\s*VOLUME\s+(?:\[\s*["']\/app\/data["']\s*\]|\/app\/data)\s*$/imu
    );
  });

  it('keeps PID1 supervision valid for every active and warm creation path', () => {
    const workerService = readProjectFile(
      'packages/services/worker.service.ts'
    );
    const dockerfiles = [
      'apps/worker_baileys/Dockerfile',
      'apps/worker_wwebjs/Dockerfile',
      'apps/worker_whatsmeow/Dockerfile',
    ].map(readProjectFile);

    expect(workerService).toContain('Init: false');
    expect(workerService).not.toContain(
      'Init: imageName !== EWorkerImage.wwebjs'
    );
    expect(workerService).not.toContain(
      'Init: input.imageName !== EWorkerImage.wwebjs'
    );
    for (const dockerfile of dockerfiles) {
      expect(dockerfile).toContain('ARG TINI_VERSION=0.19.0-1+b3');
      expect(dockerfile).toContain('tini="${TINI_VERSION}"');
      expect(dockerfile).toContain(
        'ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/worker-liveness-entrypoint"]'
      );
    }
  });

  it('ships a bounded host-side restart fence in the Balance image', () => {
    const balanceDockerfile = readProjectFile('apps/balance_api/Dockerfile');
    const balanceIndex = readProjectFile('apps/balance_api/src/index.ts');
    const balanceStartCommand = readProjectFile(
      'packages/common/functions/getStartBalanceContainerCommand.ts'
    );
    const conditionalRemove = readProjectFile(
      'scripts/worker-liveness-conditional-remove.sh'
    );

    expect(balanceDockerfile).toContain('FROM docker:27-cli AS docker_cli');
    expect(balanceDockerfile).toContain(
      'COPY scripts/worker-liveness-conditional-remove.sh /app/scripts/worker-liveness-conditional-remove.sh'
    );
    expect(balanceDockerfile).toContain('coreutils');
    expect(balanceDockerfile).toContain('util-linux');
    expect(conditionalRemove).toContain(
      'docker_bounded update --restart=no "$container_id"'
    );
    expect(conditionalRemove).toContain(
      'docker_bounded update --restart=unless-stopped "$container_id"'
    );
    expect(conditionalRemove).toContain(
      'timeout --signal=TERM --kill-after=1s 2s docker "$@"'
    );
    expect(conditionalRemove).toContain('docker_bounded rm -f "$container_id"');
    expect(balanceDockerfile).toContain(
      'COPY scripts/worker-liveness-healthcheck.sh /usr/local/bin/worker-liveness-healthcheck'
    );
    expect(balanceDockerfile).toContain(
      'COPY scripts/worker-liveness-entrypoint.sh /usr/local/bin/worker-liveness-entrypoint'
    );
    expect(balanceDockerfile).toContain(
      'UNDERCHAT_LIVENESS_HEALTH_URL=http://127.0.0.1:3003/v1/health/check'
    );
    expect(balanceDockerfile).toContain('BALANCE_API_SHUTDOWN_TIMEOUT_MS=8000');
    expect(balanceDockerfile).toContain('ARG TINI_VERSION=0.19.0-1+b3');
    expect(balanceDockerfile).toContain('tini="${TINI_VERSION}"');
    expect(balanceDockerfile).toContain(
      'test "$(dpkg-query -W -f=\'${Version}\' tini)" = "${TINI_VERSION}"'
    );
    expect(balanceDockerfile).toContain(
      'HEALTHCHECK --interval=15s --timeout=4s --start-period=90s --start-interval=15s --retries=3'
    );
    expect(balanceDockerfile).toContain('STOPSIGNAL SIGTERM');
    expect(balanceDockerfile).toContain(
      'ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/worker-liveness-entrypoint"]'
    );
    expect(balanceStartCommand).toContain('--restart always');
    expect(balanceStartCommand).toContain('--stop-timeout 10');
    expect(balanceIndex).toContain(
      'const balanceApiShutdown = installBalanceApiGracefulShutdown(server)'
    );
    expect(balanceIndex).toContain('balanceApiShutdown.isShuttingDown()');
    expect(BALANCE_API_MAX_SHUTDOWN_TIMEOUT_MS).toBe(8_000);
    expect(BALANCE_API_MAX_SHUTDOWN_TIMEOUT_MS).toBeLessThan(10_000);
  });

  it.each([
    ['SIGTERM', 143],
    ['SIGINT', 130],
  ] as const)(
    'drains Balance once and preserves the conventional %s exit code',
    async (signal, expectedExitCode) => {
      const signalTarget = new EventEmitter();
      const close = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
      const forceExit = jest.fn<void, [number]>();
      const setExitCode = jest.fn<void, [number]>();
      const addHook = jest.fn();
      const server = {
        addHook,
        close,
        log: {
          fatal: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
        },
      };

      const controller = installBalanceApiGracefulShutdown(server as never, {
        forceExit,
        setExitCode,
        signalTarget,
        timeoutMs: 100,
      });
      const duplicateController = installBalanceApiGracefulShutdown(
        server as never,
        {
          forceExit,
          setExitCode,
          signalTarget,
          timeoutMs: 100,
        }
      );

      expect(duplicateController).toBe(controller);
      expect(controller.isShuttingDown()).toBe(false);

      signalTarget.emit(signal);
      signalTarget.emit(signal);
      expect(controller.isShuttingDown()).toBe(true);
      await flushPromises();

      expect(close).toHaveBeenCalledTimes(1);
      expect(setExitCode).toHaveBeenCalledTimes(1);
      expect(setExitCode).toHaveBeenCalledWith(expectedExitCode);
      expect(forceExit).toHaveBeenCalledTimes(1);
      expect(forceExit).toHaveBeenCalledWith(expectedExitCode);
      expect(signalTarget.listenerCount('SIGTERM')).toBe(0);
      expect(signalTarget.listenerCount('SIGINT')).toBe(0);
    }
  );

  it('does not replace a startup shutdown signal with generic exit code 1', () => {
    const balanceIndex = readProjectFile('apps/balance_api/src/index.ts');

    expect(balanceIndex).toMatch(
      /catch \(err\) \{\s+if \(balanceApiShutdown\.isShuttingDown\(\)\) \{\s+return;\s+\}/u
    );
    expect(balanceIndex).toMatch(
      /if \(balanceApiShutdown\.isShuttingDown\(\)\)[\s\S]*process\.exit\(1\)/u
    );
  });

  it('keeps Balance signal listeners through onClose and deduplicates a later signal', async () => {
    const signalTarget = new EventEmitter();
    const forceExit = jest.fn<void, [number]>();
    const setExitCode = jest.fn<void, [number]>();
    let onCloseHook: (() => Promise<void>) | undefined;
    let releaseClose: (() => void) | undefined;
    const closeBarrier = new Promise<void>((resolvePromise) => {
      releaseClose = resolvePromise;
    });
    const server = {
      addHook: jest.fn((name: string, hook: () => Promise<void>): void => {
        if (name === 'onClose') {
          onCloseHook = hook;
        }
      }),
      close: jest.fn(async (): Promise<void> => {
        await onCloseHook?.();
        await closeBarrier;
      }),
      log: {
        fatal: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
      },
    };

    installBalanceApiGracefulShutdown(server as never, {
      forceExit,
      setExitCode,
      signalTarget,
      timeoutMs: 1_000,
    });

    signalTarget.emit('SIGTERM');
    await flushPromises();

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(signalTarget.listenerCount('SIGTERM')).toBe(1);
    expect(signalTarget.listenerCount('SIGINT')).toBe(1);

    signalTarget.emit('SIGINT');
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(setExitCode).toHaveBeenCalledTimes(1);
    expect(server.log.warn).toHaveBeenCalledTimes(1);

    releaseClose?.();
    await flushPromises();

    expect(forceExit).toHaveBeenCalledTimes(1);
    expect(forceExit).toHaveBeenCalledWith(143);
    expect(signalTarget.listenerCount('SIGTERM')).toBe(0);
    expect(signalTarget.listenerCount('SIGINT')).toBe(0);
  });

  it('forces a stuck Balance drain before Docker reaches its stop timeout', async () => {
    jest.useFakeTimers();
    const signalTarget = new EventEmitter();
    const close = jest.fn(
      () =>
        new Promise<void>(() => {
          // Deliberately never resolves: models a stuck gRPC/plugin close hook.
        })
    );
    const forceExit = jest.fn<void, [number]>();
    const server = {
      addHook: jest.fn(),
      close,
      log: {
        fatal: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
      },
    };

    installBalanceApiGracefulShutdown(server as never, {
      forceExit,
      setExitCode: jest.fn(),
      signalTarget,
      timeoutMs: 60_000,
    });

    signalTarget.emit('SIGTERM');
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(
      BALANCE_API_MAX_SHUTDOWN_TIMEOUT_MS - 1
    );
    expect(forceExit).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(forceExit).toHaveBeenCalledTimes(1);
    expect(forceExit).toHaveBeenCalledWith(143);

    signalTarget.emit('SIGINT');
    expect(close).toHaveBeenCalledTimes(1);
    expect(forceExit).toHaveBeenCalledTimes(1);
  });

  dockerFixtureIt(
    'reads a real paused Docker container with no Health map without a template error',
    () => {
      const fixtureName = `codex-liveness-health-none-${process.pid}-${Date.now()}`;
      const started = spawnSync(
        'docker',
        [
          'run',
          '-d',
          '--no-healthcheck',
          '--name',
          fixtureName,
          'alpine:3.20',
          'sleep',
          '60',
        ],
        { encoding: 'utf8', timeout: 10_000 }
      );
      expect(started.status).toBe(0);

      try {
        expect(
          spawnSync('docker', ['pause', fixtureName], {
            encoding: 'utf8',
            timeout: 5_000,
          }).status
        ).toBe(0);
        const inspected = spawnSync(
          'docker',
          [
            'inspect',
            '--format',
            '{{with index .State "Health"}}{{index . "Status"}}{{else}}none{{end}}|{{.State.Paused}}|{{.State.Running}}',
            fixtureName,
          ],
          { encoding: 'utf8', timeout: 5_000 }
        );

        expect(inspected.status).toBe(0);
        expect(inspected.stdout.trim()).toBe('none|true|true');
        expect(
          readProjectFile('scripts/worker-liveness-conditional-remove.sh')
        ).toContain(
          '{{with index .State "Health"}}{{index . "Status"}}{{else}}none{{end}}'
        );
      } finally {
        spawnSync('docker', ['rm', '-f', fixtureName], {
          stdio: 'ignore',
          timeout: 5_000,
        });
      }
    }
  );

  it('removes only a still-unhealthy exact identity without restoring restart policy', () => {
    const directory = mkdtempSync(join(tmpdir(), 'underchat-liveness-remove-'));
    temporaryDirectories.push(directory);

    const execution = runConditionalRemoveFixture(directory, 'matching');

    expect(execution.result).toEqual({
      status: 'removed',
      reason: 'fence_matched',
    });
    expect(execution.calls[0]).toMatch(/^update --restart=no a{64}$/u);
    expect(
      execution.calls.some((call) => call.startsWith('inspect --format'))
    ).toBe(true);
    expect(
      execution.calls.some((call) => call === `rm -f ${'a'.repeat(64)}`)
    ).toBe(true);
    expect(
      execution.calls.some((call) =>
        call.startsWith('update --restart=unless-stopped')
      )
    ).toBe(false);
  });

  it('restores restart policy after proven recovery even when a stale force request arrives', () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'underchat-liveness-recovered-')
    );
    temporaryDirectories.push(directory);

    const execution = runConditionalRemoveFixture(
      directory,
      'recovered_transient'
    );
    const forced = runConditionalRemoveFixture(directory, 'recovered', true);

    expect(execution.result).toEqual({
      status: 'recovered',
      reason: 'runtime_recovered',
      observed_restart_count: 1,
    });
    expect(
      execution.calls.filter((call) => call === `inspect ${'a'.repeat(64)}`)
        .length
    ).toBeGreaterThanOrEqual(2);
    expect(
      execution.calls.some(
        (call) => call === `update --restart=unless-stopped ${'a'.repeat(64)}`
      )
    ).toBe(true);
    expect(execution.calls.some((call) => call.startsWith('rm -f'))).toBe(
      false
    );
    expect(forced.result).toEqual({
      status: 'recovered',
      reason: 'runtime_recovered',
      observed_restart_count: 1,
    });
    expect(forced.calls.some((call) => call.startsWith('rm -f'))).toBe(false);
  });

  it('removes a healthy exact runtime only with an explicit durable retirement operation', () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'underchat-liveness-retired-')
    );
    temporaryDirectories.push(directory);
    const retiredOperationId = '019fd0a1-b2c3-74d5-86e7-f8091a2b3c4d';

    const retired = runConditionalRemoveFixture(
      directory,
      'recovered',
      true,
      retiredOperationId
    );

    expect(retired.result).toEqual({
      status: 'removed',
      reason: 'retired_runtime_fence_matched',
    });
    expect(
      retired.calls.some((call) => call === `rm -f ${'a'.repeat(64)}`)
    ).toBe(true);
    expect(
      retired.calls.some((call) =>
        call.startsWith('update --restart=unless-stopped')
      )
    ).toBe(false);
  });

  it('returns starting as pending, then permits a bounded forced exact removal', () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'underchat-liveness-starting-')
    );
    temporaryDirectories.push(directory);

    const pending = runConditionalRemoveFixture(directory, 'starting');
    const forced = runConditionalRemoveFixture(directory, 'starting', true);

    expect(pending.result).toEqual({
      status: 'pending',
      reason: 'health_starting',
      observed_restart_count: 1,
    });
    expect(
      pending.calls.some((call) =>
        call.startsWith('update --restart=unless-stopped')
      )
    ).toBe(true);
    expect(pending.calls.some((call) => call.startsWith('rm -f'))).toBe(false);
    expect(forced.result).toEqual({
      status: 'removed',
      reason: 'still_unhealthy_after_restart',
    });
    expect(forced.calls.some((call) => call.startsWith('rm -f'))).toBe(true);
  });

  it('restores the old exact ID and rejects identity drift without touching its replacement', () => {
    const directory = mkdtempSync(join(tmpdir(), 'underchat-liveness-stale-'));
    temporaryDirectories.push(directory);

    const execution = runConditionalRemoveFixture(directory, 'stale');

    expect(execution.result).toEqual({
      status: 'stale',
      reason: 'identity_changed',
    });
    expect(execution.calls.some((call) => call.includes('b'.repeat(64)))).toBe(
      false
    );
    expect(execution.calls.some((call) => call.startsWith('rm -f'))).toBe(
      false
    );
    expect(
      execution.calls.some(
        (call) => call === `update --restart=unless-stopped ${'a'.repeat(64)}`
      )
    ).toBe(true);
  });

  it('treats an ambiguous rm followed by exact not-found as idempotent success', () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'underchat-liveness-ambiguous-')
    );
    temporaryDirectories.push(directory);

    const execution = runConditionalRemoveFixture(directory, 'ambiguous');

    expect(execution.result).toEqual({
      status: 'removed',
      reason: 'ambiguous_remove_confirmed_absent',
    });
    expect(execution.calls.some((call) => call.startsWith('rm -f'))).toBe(true);
    expect(
      execution.calls.some((call) =>
        call.startsWith('update --restart=unless-stopped')
      )
    ).toBe(false);
  });

  it('does not accept a no-such error for another immutable container ID', () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'underchat-liveness-wrong-not-found-')
    );
    temporaryDirectories.push(directory);

    const execution = runConditionalRemoveFixture(directory, 'wrong_not_found');

    expect(execution.result).toEqual({
      status: 'error',
      reason: 'restart_policy_fence_failed',
    });
    expect(execution.calls.some((call) => call.startsWith('rm -f'))).toBe(
      false
    );
  });

  it('bounds a Docker CLI hang and still runs the restart-policy restoration path', () => {
    const directory = mkdtempSync(join(tmpdir(), 'underchat-liveness-hang-'));
    temporaryDirectories.push(directory);

    const execution = runConditionalRemoveFixture(directory, 'hang');

    expect(execution.result).toEqual({
      status: 'error',
      reason: 'inspect_failed',
    });
    expect(execution.durationMs).toBeLessThan(10_000);
    expect(
      execution.calls.some(
        (call) => call === `update --restart=unless-stopped ${'a'.repeat(64)}`
      )
    ).toBe(true);
  });

  it('attaches immutable server identity to every worker creation family', () => {
    const commandHandler = readProjectFile(
      'packages/services/workerCommandHandler.service.ts'
    );

    expect(commandHandler.match(/createContainerWorker\(/g)).toHaveLength(5);
    expect(commandHandler).toContain('serverId: input.data.server_id');
    expect(commandHandler).toMatch(
      /runtimeGeneration:\s*nextRuntimeGeneration,\s*serverId:\s*data\.server_id/
    );
    expect(commandHandler).toMatch(
      /runtimeGeneration,\s*serverId:\s*data\.server_id/
    );
  });

  it('bounds established freeze detection below two minutes', async () => {
    const modeledWorstCaseMs =
      (WORKER_CONTAINER_HEALTH_INTERVAL_MS +
        WORKER_CONTAINER_HEALTH_TIMEOUT_MS) *
        WORKER_CONTAINER_HEALTH_RETRIES +
      WORKER_CONTAINER_LIVENESS_SCAN_INTERVAL_MS +
      WORKER_CONTAINER_LIVENESS_MAX_JITTER_MS +
      WORKER_CONTAINER_LIVENESS_REMOTE_PHASE_TIMEOUT_MS *
        WORKER_CONTAINER_LIVENESS_REMOTE_OBSERVATION_PHASES;

    expect(WORKER_CONTAINER_FREEZE_DETECTOR_BOUND_MS).toBe(modeledWorstCaseMs);
    expect(modeledWorstCaseMs).toBeLessThan(120_000);

    jest.useFakeTimers();
    const requested = jest.fn();
    setTimeout(requested, modeledWorstCaseMs);

    await jest.advanceTimersByTimeAsync(modeledWorstCaseMs - 1);
    expect(requested).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(requested).toHaveBeenCalledTimes(1);
  });

  it('kills only the fenced worker identity after five established failures', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'underchat-worker-liveness-'));
    temporaryDirectories.push(directory);
    const pidFile = join(directory, 'worker.pid');
    const failureFile = join(directory, 'failures');
    const healthyFile = join(directory, 'healthy');
    writeFileSync(healthyFile, 'ok');

    const child = spawn('sh', [ENTRYPOINT_SCRIPT, 'sleep', '300'], {
      env: {
        ...process.env,
        UNDERCHAT_LIVENESS_PID_FILE: pidFile,
      },
      stdio: 'ignore',
    });
    children.push(child);
    await waitFor(() => existsSync(pidFile));

    const runProbe = (url: string) =>
      spawnSync('sh', [HEALTHCHECK_SCRIPT], {
        env: {
          ...process.env,
          UNDERCHAT_LIVENESS_PID_FILE: pidFile,
          UNDERCHAT_LIVENESS_FAILURE_FILE: failureFile,
          UNDERCHAT_LIVENESS_HEALTH_URL: url,
        },
        timeout: 5_000,
      });

    expect(runProbe(`file://${healthyFile}`).status).toBe(0);
    const unavailableUrl = `file://${join(directory, 'unavailable')}`;
    for (let failure = 1; failure < 5; failure += 1) {
      expect(runProbe(unavailableUrl).status).toBe(1);
      expect(isRunning(child)).toBe(true);
    }

    expect(runProbe(unavailableUrl).status).toBe(1);
    await waitForExit(child);
    expect(child.signalCode).toBe('SIGKILL');
  });

  it('bounds a permanently stuck cold start after ten failed probes', async () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'underchat-worker-cold-liveness-')
    );
    temporaryDirectories.push(directory);
    const pidFile = join(directory, 'worker.pid');
    const failureFile = join(directory, 'failures');
    const child = spawn('sh', [ENTRYPOINT_SCRIPT, 'sleep', '300'], {
      env: {
        ...process.env,
        UNDERCHAT_LIVENESS_PID_FILE: pidFile,
      },
      stdio: 'ignore',
    });
    children.push(child);
    await waitFor(() => existsSync(pidFile));

    const runFailedProbe = () =>
      spawnSync('sh', [HEALTHCHECK_SCRIPT], {
        env: {
          ...process.env,
          UNDERCHAT_LIVENESS_PID_FILE: pidFile,
          UNDERCHAT_LIVENESS_FAILURE_FILE: failureFile,
          UNDERCHAT_LIVENESS_HEALTH_URL: `file://${join(
            directory,
            'unavailable'
          )}`,
        },
        timeout: 5_000,
      });

    for (let failure = 1; failure < 10; failure += 1) {
      expect(runFailedProbe().status).toBe(1);
      expect(isRunning(child)).toBe(true);
    }

    expect(runFailedProbe().status).toBe(1);
    await waitForExit(child);
    expect(child.signalCode).toBe('SIGKILL');
  });
});
