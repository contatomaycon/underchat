import { installUbuntu2404 } from '@core/common/functions/installUbuntu2404';
import { installUbuntu2410 } from '@core/common/functions/installUbuntu2410';
import { installUbuntu2504 } from '@core/common/functions/installUbuntu2504';
import { installUbuntu2510 } from '@core/common/functions/installUbuntu2510';
import {
  getLegacyBalanceDockerRuntimeFenceShellFragment,
  getLegacyBalanceRolloutFenceShellFragment,
  getLegacyBalanceRolloutFencedCommand,
  getLegacyBalanceRolloutFencedCommandSequence,
  getLegacyBalanceRolloutReservationShellFragment,
  getStartBalanceContainerCommand,
} from '@core/common/functions/getStartBalanceContainerCommand';
import { IServerBuildDefaultImages } from '@core/common/interfaces/IServerBuildDefaultImages';
import { IViewServerWebById } from '@core/common/interfaces/IViewServerWebById';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const webView: IViewServerWebById = {
  server_id: '019e98ad-aab4-715d-aa6b-9e0e027edc24',
  server_status_id: 'online',
  web_domain: '10.0.2.15',
  web_port: 8181,
  web_protocol: 'http',
};

const defaultImages: IServerBuildDefaultImages = {
  baileys: 'registry/under-worker-baileys:v1',
  wwebjs: 'registry/under-worker-wwebjs:v1',
  whatsmeow: 'registry/under-worker-whatsmeow:v1',
  balance_api: 'registry/under-balance-api:v1',
};

const productionRolloutDirectory = '/var/lib/underchat/balance-rollout';
const testOwnerId = process.getuid?.() ?? 0;
const inactiveSystemdAndDockerStubs = `
systemctl() {
  if [ "$1" = is-active ]; then return 3; fi
  if [ "$1" = show ]; then
    case "$*" in
      *LoadState*) printf "not-found\\n" ;;
      *ActiveState*) printf "inactive\\n" ;;
      *) return 1 ;;
    esac
    return 0
  fi
  return 1
}
docker() {
  if [ "\${FAKE_DOCKER_FAILURE:-0}" = 1 ]; then return 1; fi
  if [ -n "\${FAKE_ROLLBACK_ID:-}" ]; then
    printf "%s\\n" "$FAKE_ROLLBACK_ID"
  fi
}
`;

function testFence(directory: string, socketAvailable = true): string {
  const fragment = getLegacyBalanceRolloutFenceShellFragment()
    .replaceAll(productionRolloutDirectory, directory)
    .replace(
      'ROLLOUT_EXPECTED_OWNER=0;',
      `ROLLOUT_EXPECTED_OWNER=${testOwnerId};`
    );
  return socketAvailable
    ? fragment.replace('[ ! -S /var/run/docker.sock ]', '[ 1 -eq 0 ]')
    : fragment;
}

function runFence(
  directory: string,
  continuation: string,
  environment: NodeJS.ProcessEnv = {}
) {
  return spawnSync(
    'bash',
    [
      '-c',
      `${inactiveSystemdAndDockerStubs}\n${testFence(directory)} && ${continuation}`,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, ...environment },
      timeout: 5_000,
    }
  );
}

function createValidRolloutDirectory(directory: string): void {
  mkdirSync(directory, { mode: 0o700, recursive: true });
  chmodSync(directory, 0o700);
}

function expectValidBash(command: string): void {
  const result = spawnSync('bash', ['-n'], {
    encoding: 'utf8',
    input: command,
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
}

const rolloutServiceFence = 'systemctl is-active --quiet "$ROLLOUT_UNIT"';
const rolloutLockOpen = 'exec {ROLLOUT_LEGACY_LOCK_FD}<"$ROLLOUT_STATE_DIR"';
const rolloutLockAcquire = 'flock -n "$ROLLOUT_LEGACY_LOCK_FD"';
const rolloutStateFile =
  'ROLLOUT_STATE_FILE=/var/lib/underchat/balance-rollout/state.env';
const nonTerminalRolloutPhases =
  'prepared|old_backed_up|candidate_started|candidate_ready_pending_confirmation|rollback_started|finalize_started';

function expectManagedRolloutFenceBeforeDockerMutation(command: string): void {
  const serviceFenceIndex = command.indexOf(rolloutServiceFence);
  const lockOpenIndex = command.indexOf(rolloutLockOpen);
  const lockAcquireIndex = command.indexOf(rolloutLockAcquire);
  const stateFileIndex = command.indexOf(rolloutStateFile);
  const phaseFenceIndex = command.indexOf(nonTerminalRolloutPhases);
  const dockerMutationIndexes = [...command.matchAll(/\bdocker (?:rm|run)\b/gu)]
    .map((match) => match.index)
    .filter((index): index is number => index !== undefined);

  expect(serviceFenceIndex).toBeGreaterThanOrEqual(0);
  expect(lockOpenIndex).toBeGreaterThanOrEqual(0);
  expect(lockAcquireIndex).toBeGreaterThan(lockOpenIndex);
  expect(serviceFenceIndex).toBeGreaterThan(lockAcquireIndex);
  expect(stateFileIndex).toBeGreaterThanOrEqual(0);
  expect(phaseFenceIndex).toBeGreaterThan(serviceFenceIndex);
  expect(phaseFenceIndex).toBeGreaterThan(stateFileIndex);
  expect(dockerMutationIndexes.length).toBeGreaterThan(0);

  for (const dockerMutationIndex of dockerMutationIndexes) {
    expect(serviceFenceIndex).toBeLessThan(dockerMutationIndex);
    expect(lockAcquireIndex).toBeLessThan(dockerMutationIndex);
    expect(phaseFenceIndex).toBeLessThan(dockerMutationIndex);
  }

  expect(command).toContain(
    'Legacy Balance mutation blocked because managed rollout service is active'
  );
  expect(command).toContain(
    'Legacy Balance mutation blocked by managed rollout phase: $ROLLOUT_PHASE'
  );
  expect(command).toContain('complete|rolled_back) ;;');
  expect(command).toContain(
    'Legacy Balance mutation blocked because managed rollout state cannot be verified'
  );
  expect(command).toContain('name=^/under-balance-api-rollback$');
  expect(command).toContain(
    'Legacy Balance mutation blocked because reserved rollback container exists'
  );
  expect(command).toContain(
    'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
  );
  expect(command).toContain('DOCKER_HOST=unix:///var/run/docker.sock');
  expect(command).not.toContain('/var/lib/underchat/nats');
  expect(command).not.toContain('nats-worker-creds');
  expect(command).toContain('unset DOCKER_CONTEXT');
  expect(command).toContain(
    'Legacy Balance mutation blocked because local Docker CLI is unavailable'
  );
  expect(command).toContain(
    'Legacy Balance mutation blocked because local Docker socket is unavailable'
  );
  expect(command).toContain('[ -L "$ROLLOUT_STATE_DIR" ]');
  expect(command).toContain('stat -c "%u" -- "$ROLLOUT_STATE_DIR"');
  expect(command).toContain('stat -c "%a" -- "$ROLLOUT_STATE_DIR"');
  expect(command).toContain('[ -L "$ROLLOUT_STATE_FILE" ]');
  expect(command).toContain('stat -c "%u" -- "$ROLLOUT_STATE_FILE"');
  expect(command).toContain('stat -c "%a" -- "$ROLLOUT_STATE_FILE"');
}

describe.each([
  ['Ubuntu 24.04', installUbuntu2404],
  ['Ubuntu 24.10', installUbuntu2410],
  ['Ubuntu 25.04', installUbuntu2504],
  ['Ubuntu 25.10', installUbuntu2510],
])('%s balance installation', (_distro, install) => {
  it('never stops or removes worker, channel or warm containers while updating image aliases', async () => {
    const commands = await install(webView, defaultImages);
    const script = commands.join('\n');

    expect(script).toContain(
      `docker --config /home/app/.docker pull '${defaultImages.baileys}'`
    );
    expect(script).toContain(
      `docker --config /home/app/.docker pull '${defaultImages.wwebjs}'`
    );
    expect(script).toContain(
      `docker --config /home/app/.docker pull '${defaultImages.whatsmeow}'`
    );
    expect(script).not.toMatch(
      /docker (?:stop|kill|restart|rm(?: -f)?) under-worker-(?:baileys|wwebjs|whatsmeow)\b/u
    );
    expect(script).not.toMatch(/docker (?:stop|kill|restart|rm) .*warm-/u);
    expect(script).not.toContain('underchat.worker_id');
    expect(script).not.toContain('underchat.warm_pool_id');
  });

  it('removes every container publishing reserved ports immediately before start', async () => {
    const commands = await install(webView, defaultImages);
    const pullIndex = commands.findIndex((command) =>
      command.includes(
        `docker --config /home/app/.docker pull '${defaultImages.balance_api}'`
      )
    );
    const startIndex = commands.findIndex((command) =>
      command.includes('docker run -d --name under-balance-api')
    );
    const startCommand = commands[startIndex];

    expect(pullIndex).toBeGreaterThanOrEqual(0);
    expect(startIndex).toBe(pullIndex);
    expect(
      startCommand.indexOf(
        `docker --config /home/app/.docker pull '${defaultImages.balance_api}'`
      )
    ).toBeLessThan(
      startCommand.indexOf('docker run -d --name under-balance-api')
    );
    expect(startCommand).toContain(
      'docker ps -aq --filter "name=^/under-balance-api$"'
    );
    expect(startCommand).not.toContain('name=^/under-balance-api($|-)');
    expect(startCommand).toContain('docker ps -q --filter "publish=8181"');
    expect(startCommand).toContain('docker ps -q --filter "publish=50051"');
    expect(startCommand).toContain(
      'docker rm -f $ACTIVE_BALANCE_CONTAINER_IDS'
    );
    expect(startCommand).toContain(
      'Reserved Balance port is owned by foreign container'
    );
    expect(startCommand).toContain('--stop-timeout 10');
    expect(startCommand).not.toContain(
      'docker rm -f $RESERVED_PORT_CONTAINER_IDS'
    );
  });

  it('reports a failed docker run and removes its incomplete container', async () => {
    const commands = await install(webView, defaultImages);
    const startCommand = commands.find((command) =>
      command.includes('docker run -d --name under-balance-api')
    );

    expect(startCommand).toContain('EXIT_CODE=$?;');
    expect(startCommand).toContain(
      'ERROR: Failed to create container. Exit code: $EXIT_CODE.'
    );
    expect(startCommand).toContain(
      'docker rm -f under-balance-api >/dev/null 2>&1 || true'
    );
  });

  it('fails closed before every legacy docker rm/run during a managed rollout', async () => {
    const commands = await install(webView, defaultImages);
    const dockerMutationCommands = commands.filter((command) =>
      /\bdocker (?:rm|run)\b/u.test(command)
    );

    expect(dockerMutationCommands).toHaveLength(1);
    dockerMutationCommands.forEach(
      expectManagedRolloutFenceBeforeDockerMutation
    );
  });

  it('holds the shared fence for every application install mutation', async () => {
    const commands = await install(webView, defaultImages);
    const mutationCommands = commands.filter((command) =>
      command.includes('rm -rf /home/app || true')
    );
    const dockerStartIndex = commands.findIndex((command) =>
      command.includes('systemctl start docker')
    );
    const mutationIndex = commands.findIndex((command) =>
      command.includes('rm -rf /home/app || true')
    );

    expect(mutationCommands).toHaveLength(1);
    const dockerSetupIndex = commands.findIndex((command) =>
      command.includes('https://download.docker.com/linux/ubuntu/gpg')
    );

    expect(dockerSetupIndex).toBeGreaterThanOrEqual(0);
    expect(dockerStartIndex).toBe(dockerSetupIndex);
    expect(mutationIndex).toBe(dockerSetupIndex);
    const [command] = mutationCommands;
    expectValidBash(command);
    expect(command).toContain('set -Eeuo pipefail');
    const lockIndexes = [
      ...command.matchAll(/flock -n "\$ROLLOUT_LEGACY_LOCK_FD"/gu),
    ];
    expect(lockIndexes).toHaveLength(1);
    const lockIndex = lockIndexes[0]?.index ?? -1;
    const dockerRepositorySetupIndex = command.indexOf(
      'https://download.docker.com/linux/ubuntu/gpg'
    );
    const dpkgRecoveryIndex = command.indexOf('dpkg --configure -a');
    const dockerInstallIndex = command.indexOf(
      'apt-get install -y docker-ce docker-ce-cli'
    );
    const dockerDaemonStartIndex = command.indexOf('systemctl start docker');
    const dockerRuntimeVerificationIndex = command.indexOf(
      '\nlegacy_rollout_verify_docker\n'
    );
    const appMutationIndex = command.indexOf('rm -rf /home/app || true');
    expect(lockIndex).toBeLessThan(dpkgRecoveryIndex);
    expect(dpkgRecoveryIndex).toBeLessThan(dockerRepositorySetupIndex);
    expect(dockerRepositorySetupIndex).toBeLessThan(dockerInstallIndex);
    expect(dockerInstallIndex).toBeLessThan(dockerDaemonStartIndex);
    expect(dockerDaemonStartIndex).toBeLessThan(dockerRuntimeVerificationIndex);
    expect(dockerRuntimeVerificationIndex).toBeLessThan(appMutationIndex);
    for (const match of command.matchAll(
      /(?:\/home\/app\/\.env|docker (?:pull|rm|run|stop|tag))/gu
    )) {
      expect(lockIndex).toBeLessThan(match.index ?? -1);
    }
    expect(command.indexOf('docker pull')).toBeLessThan(
      command.indexOf('docker run -d --name under-balance-api')
    );
  });

  it('emits ordered stage boundaries from inside the remote install process', async () => {
    const commands = await install(webView, defaultImages);
    const command = commands.find((value) =>
      value.includes('docker run -d --name under-balance-api')
    );

    expect(command).toBeDefined();
    expect(command).toContain('exec 2>&1');
    const expectedMarkers = [
      '__UNDERCHAT_INSTALL_STAGE__:packages:running',
      '__UNDERCHAT_INSTALL_STAGE__:packages:complete',
      '__UNDERCHAT_INSTALL_STAGE__:docker:running',
      '__UNDERCHAT_INSTALL_STAGE__:docker:complete',
      '__UNDERCHAT_INSTALL_STAGE__:images:running',
      '__UNDERCHAT_INSTALL_STAGE__:worker_baileys:running',
      '__UNDERCHAT_INSTALL_STAGE__:worker_wwebjs:running',
      '__UNDERCHAT_INSTALL_STAGE__:worker_meow:running',
      '__UNDERCHAT_INSTALL_STAGE__:balance:running',
      '__UNDERCHAT_INSTALL_STAGE__:balance:complete',
    ];
    let previousIndex = -1;

    for (const marker of expectedMarkers) {
      const markerIndex = command?.indexOf(marker) ?? -1;
      expect(markerIndex).toBeGreaterThan(previousIndex);
      previousIndex = markerIndex;
    }
  });
});

describe('shared Balance start command', () => {
  it('replaces only the exact active container and fails closed on foreign port owners', () => {
    const command = getStartBalanceContainerCommand({
      serverId: webView.server_id,
      webPort: webView.web_port,
    });

    expect(command).toContain(
      'docker ps -aq --filter "name=^/under-balance-api$"'
    );
    expect(command).not.toContain('name=^/under-balance-api($|-)');
    expect(command).toContain('docker ps -q --filter "publish=8181"');
    expect(command).toContain('docker ps -q --filter "publish=50051"');
    expect(command).toContain('docker rm -f $ACTIVE_BALANCE_CONTAINER_IDS');
    expect(command).toContain(
      'Reserved Balance port is owned by foreign container'
    );
    expect(command).toContain('--stop-timeout 10');
    expect(command).not.toContain('docker rm -f $RESERVED_PORT_CONTAINER_IDS');
  });

  it('fails closed before docker rm/run while the managed rollout is active or recovering', () => {
    const command = getStartBalanceContainerCommand({
      serverId: webView.server_id,
      webPort: webView.web_port,
    });

    expectValidBash(command);
    expectManagedRolloutFenceBeforeDockerMutation(command);
  });
});

describe('legacy Balance shared-lock fence behavior', () => {
  it('keeps the reusable fence safe for its single-quoted parent shell', () => {
    expect(getLegacyBalanceRolloutFenceShellFragment()).not.toContain("'");
    expect(getLegacyBalanceRolloutReservationShellFragment()).not.toContain(
      "'"
    );
    expect(getLegacyBalanceDockerRuntimeFenceShellFragment()).not.toContain(
      "'"
    );
  });

  it('cannot skip the continuous fence when an env payload contains the old lock marker', () => {
    const markerPayload =
      'HARBOR_PASSWORD=exec {ROLLOUT_LEGACY_LOCK_FD}<"$ROLLOUT_STATE_DIR"';
    const commands = getLegacyBalanceRolloutFencedCommandSequence(
      [
        'system preparation',
        'docker repository setup',
        'rm -rf /home/app || true',
        `printf "%s\\n" '${markerPayload}' > /home/app/.env`,
        'docker pull image',
        'docker run image',
      ],
      'docker repository setup',
      'rm -rf /home/app || true'
    );

    expect(commands).toHaveLength(2);
    expect(commands[0]).toBe('system preparation');
    expect(commands[1]).toContain(markerPayload);
    expect(commands[1]).toContain('set -Eeuo pipefail');
    expect(commands[1]).toContain('\nlegacy_rollout_verify_docker\n');
    expect(commands[1]?.indexOf(rolloutLockAcquire)).toBeLessThan(
      commands[1]?.indexOf(markerPayload) ?? -1
    );
    expect(commands[1]?.indexOf(markerPayload)).toBeLessThan(
      commands[1]?.indexOf('docker run image') ?? -1
    );
  });

  it('rejects missing or reversed exact sequence markers', () => {
    expect(() =>
      getLegacyBalanceRolloutFencedCommandSequence(
        ['prepare Docker', 'mutate app'],
        'missing Docker setup',
        'mutate app'
      )
    ).toThrow('reservation marker was not found');
    expect(() =>
      getLegacyBalanceRolloutFencedCommandSequence(
        ['mutate app', 'prepare Docker'],
        'prepare Docker',
        'mutate app'
      )
    ).toThrow('must follow the reservation marker');
  });

  it('holds one lock across Docker setup, runtime verification and app mutation', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'balance-fence-sequence-'));
    const directory = join(temporary, 'balance-rollout');
    const marker = join(temporary, 'mutated');
    createValidRolloutDirectory(directory);
    const dockerSetup = `if flock -n "${directory}" -c true; then exit 91; fi; printf setup >"${marker}"`;
    const appMutation = `if flock -n "${directory}" -c true; then exit 92; fi; [ "$DOCKER_HOST" = unix:///var/run/docker.sock ] || exit 93; [ -z "\${DOCKER_CONTEXT+x}" ] || exit 94; printf app >>"${marker}"`;
    const sequence = getLegacyBalanceRolloutFencedCommandSequence(
      ['outside reservation', dockerSetup, appMutation],
      dockerSetup,
      appMutation
    );
    const command = sequence[1]
      ?.replaceAll(productionRolloutDirectory, directory)
      .replace(
        'ROLLOUT_EXPECTED_OWNER=0;',
        `ROLLOUT_EXPECTED_OWNER=${testOwnerId};`
      )
      .replace('[ ! -S /var/run/docker.sock ]', '[ 1 -eq 0 ]');
    try {
      expect(sequence).toHaveLength(2);
      expect(sequence[0]).toBe('outside reservation');
      expect(command).toBeDefined();
      const result = spawnSync(
        'bash',
        [
          '-c',
          `${inactiveSystemdAndDockerStubs}\nexport -f systemctl docker\n${command ?? ''}`,
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            DOCKER_CONTEXT: 'inherited-remote-context',
            DOCKER_HOST: 'tcp://inherited.example:2375',
          },
          timeout: 5_000,
        }
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(readFileSync(marker, 'utf8')).toBe('setupapp');
    } finally {
      rmSync(temporary, { force: true, recursive: true });
    }
  });

  it('creates a verified directory and holds its lock through the wrapped mutation', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'balance-fence-create-'));
    const directory = join(temporary, 'balance-rollout');
    const marker = join(temporary, 'mutated');
    try {
      const result = runFence(
        directory,
        `[ "$ROLLOUT_LEGACY_LOCK_FD" -ge 10 ] || exit 92; if flock -n "$ROLLOUT_STATE_DIR" -c true; then exit 91; fi; printf done >"${marker}"`
      );

      expect(result.status).toBe(0);
      expect(existsSync(marker)).toBe(true);
      expect(lstatSync(directory).isSymbolicLink()).toBe(false);
      expect(lstatSync(directory).mode & 0o777).toBe(0o700);
      expect(spawnSync('flock', ['-n', directory, 'true']).status).toBe(0);
    } finally {
      rmSync(temporary, { force: true, recursive: true });
    }
  });

  it('fails before mutation while the protected reconciler owns the directory lock', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'balance-fence-busy-'));
    const directory = join(temporary, 'balance-rollout');
    const ready = join(temporary, 'holder-ready');
    const marker = join(temporary, 'mutated');
    createValidRolloutDirectory(directory);
    const source = `
set -u
cleanup() {
  kill "$HOLDER_PID" >/dev/null 2>&1 || true
  wait "$HOLDER_PID" 2>/dev/null || true
}
trap cleanup EXIT
(
  exec 9<"${directory}"
  flock -n 9
  printf ready >"${ready}"
  sleep 30
) &
HOLDER_PID=$!
while [ ! -e "${ready}" ]; do sleep 0.01; done
${inactiveSystemdAndDockerStubs}
${testFence(directory)} && printf mutated >"${marker}"
`;
    try {
      const result = spawnSync('bash', ['-c', source], {
        encoding: 'utf8',
        timeout: 5_000,
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('managed rollout lock is busy');
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(temporary, { force: true, recursive: true });
    }
  });

  it.each(['symlink', 'permissive'])(
    'fails closed for an invalid %s rollout directory',
    (variant) => {
      const temporary = mkdtempSync(join(tmpdir(), 'balance-fence-dir-'));
      const directory = join(temporary, 'balance-rollout');
      const marker = join(temporary, 'mutated');
      if (variant === 'symlink') {
        const target = join(temporary, 'target');
        createValidRolloutDirectory(target);
        symlinkSync(target, directory);
      } else {
        mkdirSync(directory, { mode: 0o755 });
        chmodSync(directory, 0o755);
      }
      try {
        const result = runFence(directory, `printf done >"${marker}"`);

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('managed rollout directory');
        expect(existsSync(marker)).toBe(false);
      } finally {
        rmSync(temporary, { force: true, recursive: true });
      }
    }
  );

  it('fails closed for a reserved rollback container', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'balance-fence-backup-'));
    const directory = join(temporary, 'balance-rollout');
    const marker = join(temporary, 'mutated');
    createValidRolloutDirectory(directory);
    try {
      const result = runFence(directory, `printf done >"${marker}"`, {
        FAKE_ROLLBACK_ID: 'a'.repeat(64),
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('reserved rollback container exists');
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(temporary, { force: true, recursive: true });
    }
  });

  it.each(['cli', 'socket'])(
    'fails closed when the local Docker %s is unavailable',
    (missingResource) => {
      const temporary = mkdtempSync(join(tmpdir(), 'balance-fence-docker-'));
      const directory = join(temporary, 'balance-rollout');
      const marker = join(temporary, 'mutated');
      createValidRolloutDirectory(directory);
      let fragment = testFence(directory, missingResource !== 'socket');
      if (missingResource === 'cli') {
        fragment = fragment.replace(
          'command -v docker',
          'command -v underchat-definitely-missing-docker'
        );
      } else {
        fragment = fragment.replaceAll(
          '/var/run/docker.sock',
          join(temporary, 'missing-docker.sock')
        );
      }
      try {
        const result = spawnSync(
          'bash',
          [
            '-c',
            `${inactiveSystemdAndDockerStubs}\n${fragment} && printf done >"${marker}"`,
          ],
          { encoding: 'utf8', timeout: 5_000 }
        );

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(
          missingResource === 'cli'
            ? 'local Docker CLI is unavailable'
            : 'local Docker socket is unavailable'
        );
        expect(existsSync(marker)).toBe(false);
      } finally {
        rmSync(temporary, { force: true, recursive: true });
      }
    }
  );

  it('fails closed for a durable nonterminal rollout phase', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'balance-fence-phase-'));
    const directory = join(temporary, 'balance-rollout');
    const marker = join(temporary, 'mutated');
    createValidRolloutDirectory(directory);
    writeFileSync(join(directory, 'state.env'), 'PHASE=candidate_started\n', {
      mode: 0o600,
    });
    try {
      const result = runFence(directory, `printf done >"${marker}"`);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        'managed rollout phase: candidate_started'
      );
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(temporary, { force: true, recursive: true });
    }
  });

  it.each(['symlink', 'permissive'])(
    'fails closed for an invalid %s state file',
    (variant) => {
      const temporary = mkdtempSync(join(tmpdir(), 'balance-fence-state-'));
      const directory = join(temporary, 'balance-rollout');
      const state = join(directory, 'state.env');
      const marker = join(temporary, 'mutated');
      createValidRolloutDirectory(directory);
      if (variant === 'symlink') {
        const target = join(temporary, 'state-target.env');
        writeFileSync(target, 'PHASE=complete\n', { mode: 0o600 });
        symlinkSync(target, state);
      } else {
        writeFileSync(state, 'PHASE=complete\n', { mode: 0o644 });
      }
      try {
        const result = runFence(directory, `printf done >"${marker}"`);

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(
          'managed rollout state cannot be verified'
        );
        expect(existsSync(marker)).toBe(false);
      } finally {
        rmSync(temporary, { force: true, recursive: true });
      }
    }
  );

  it('keeps arbitrary wrapped commands inside the lock-holding parent shell', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'balance-fence-wrapper-'));
    const directory = join(temporary, 'balance-rollout');
    const marker = join(temporary, 'mutated');
    createValidRolloutDirectory(directory);
    const body = `set -Eeuo pipefail
[ "$DOCKER_HOST" = unix:///var/run/docker.sock ] || exit 93
[ -z "\${DOCKER_CONTEXT+x}" ] || exit 94
if flock -n "${directory}" -c true; then exit 91; fi
printf first >"${marker}"
docker pull image
docker tag image alias
if flock -n "${directory}" -c true; then exit 92; fi
printf second >>"${marker}"`;
    const command = getLegacyBalanceRolloutFencedCommand(body)
      .replaceAll(productionRolloutDirectory, directory)
      .replace(
        'ROLLOUT_EXPECTED_OWNER=0;',
        `ROLLOUT_EXPECTED_OWNER=${testOwnerId};`
      )
      .replace('[ ! -S /var/run/docker.sock ]', '[ 1 -eq 0 ]');
    const lockIndex = command.indexOf(rolloutLockAcquire);
    try {
      const result = spawnSync(
        'bash',
        [
          '-c',
          `${inactiveSystemdAndDockerStubs}\nexport -f systemctl docker\n${command}`,
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            DOCKER_CONTEXT: 'inherited-remote-context',
            DOCKER_HOST: 'tcp://inherited.example:2375',
          },
          timeout: 5_000,
        }
      );

      expect(result.status).toBe(0);
      expect(existsSync(marker)).toBe(true);
      expect(readFileSync(marker, 'utf8')).toBe('firstsecond');
      expect(lockIndex).toBeGreaterThanOrEqual(0);
      expect(command).toContain("bash -s' <<'UNDERCHAT_LEGACY_BALANCE_");
      expect(lockIndex).toBeLessThan(command.indexOf('docker pull image'));
      expect(lockIndex).toBeLessThan(command.indexOf('docker tag image alias'));
    } finally {
      rmSync(temporary, { force: true, recursive: true });
    }
  });
});
