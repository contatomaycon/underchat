import {
  getBalanceImageProbeCommand,
  getBalanceRolloutHostScript,
  getReconcileBalanceContainerCommand,
} from '@core/common/functions/getReconcileBalanceContainerCommand';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const IMAGE_REFERENCE = `harbor.example/underchat/balance/under-balance-api@${DIGEST}`;

function expectValidBash(source: string): void {
  const result = spawnSync('bash', ['-n'], {
    encoding: 'utf8',
    input: source,
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
}

function extractShellFunction(source: string, name: string): string {
  const marker = `${name}() {`;
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('\n}\n', start + marker.length);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + 3);
}

function runOldRuntimeIdentityRecovery(input: {
  currentId?: string;
  currentImageId?: string;
  oldId?: string;
  oldImageId?: string;
  phase: string;
  restartPolicy: string;
}): {
  journaledStatus: number;
  prepareRuntimeStatus: number;
  strictStatus: number;
} {
  const hostScript = getBalanceRolloutHostScript();
  const source = `
CURRENT_NAME=under-balance-api
BACKUP_NAME=under-balance-api-rollback
SERVER_ID=019e98ad-aab4-715d-aa6b-9e0e027edc24
WEB_PORT=3003
NEW_ID=
PHASE="$TEST_PHASE"
OLD_ID="$TEST_OLD_ID"
OLD_IMAGE_ID="$TEST_OLD_IMAGE_ID"

assert_exact_name() {
  [ "$1" = "$TEST_CURRENT_ID" ] && [ "$2" = "$CURRENT_NAME" ]
}
exact_container_id() {
  case "$1" in
    "$CURRENT_NAME") printf "%s\\n" "$TEST_CURRENT_ID" ;;
    "$BACKUP_NAME") ;;
    *) return 1 ;;
  esac
}
container_image_id() {
  printf "%s\\n" "$TEST_CURRENT_IMAGE_ID"
}
container_token() {
  return 0
}
assert_candidate_identity() {
  return 1
}
capture_runtime_env() {
  return 0
}
fail() {
  exit "\${2:-1}"
}
docker() {
  [ "$1" = inspect ] && [ "$2" = --format ] || return 1
  case "$3" in
    *Config.Image*) printf "under-balance-api:latest\\n" ;;
    *underchat.component*) ;;
    *Config.Env*)
      printf "SERVER_ID=%s\\nDOCKER_HOST=unix:///var/run/docker.sock\\n" "$SERVER_ID"
      ;;
    *Mounts*) printf "/var/run/docker.sock:/var/run/docker.sock\\n" ;;
    *NetworkSettings.Networks*) printf "underchat\\n" ;;
    *3003/tcp*HostIp*|*50051/tcp*HostIp*) printf "0.0.0.0\\n" ;;
    *3003/tcp*HostPort*) printf "%s\\n" "$WEB_PORT" ;;
    *50051/tcp*HostPort*) printf "50051\\n" ;;
    *RestartPolicy.Name*) printf "%s\\n" "$TEST_RESTART_POLICY" ;;
    *) return 1 ;;
  esac
}

${extractShellFunction(hostScript, 'is_named_balance_image_reference')}
${extractShellFunction(hostScript, 'assert_existing_balance_runtime_identity')}
${extractShellFunction(hostScript, 'assert_existing_balance_identity')}
${extractShellFunction(hostScript, 'assert_journaled_old_current_identity')}
${extractShellFunction(hostScript, 'prepare_runtime_env')}

journaled_status=0
assert_journaled_old_current_identity "$TEST_CURRENT_ID" || journaled_status=$?
strict_status=0
assert_existing_balance_identity "$TEST_CURRENT_ID" || strict_status=$?
prepare_status=0
( prepare_runtime_env ) || prepare_status=$?
printf "journaled=%s strict=%s prepare=%s\\n" \
  "$journaled_status" "$strict_status" "$prepare_status"
`;
  const currentId = input.currentId ?? 'c'.repeat(64);
  const result = spawnSync('bash', ['-c', source], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TEST_CURRENT_ID: currentId,
      TEST_CURRENT_IMAGE_ID: input.currentImageId ?? DIGEST,
      TEST_OLD_ID: input.oldId ?? currentId,
      TEST_OLD_IMAGE_ID: input.oldImageId ?? DIGEST,
      TEST_PHASE: input.phase,
      TEST_RESTART_POLICY: input.restartPolicy,
    },
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  const match = result.stdout.match(
    /^journaled=(\d+) strict=(\d+) prepare=(\d+)\n$/u
  );
  expect(match).not.toBeNull();
  return {
    journaledStatus: Number(match?.[1]),
    strictStatus: Number(match?.[2]),
    prepareRuntimeStatus: Number(match?.[3]),
  };
}

function runEmbeddedEnvironmentNormalizer(values: string[]): {
  output: string;
  status: number | null;
} {
  const hostScript = getBalanceRolloutHostScript();
  const startMarker = `if ! python3 - "$ENV_JSON_FILE" "$RUNTIME_ENV_FILE" <<'PY'\n`;
  const start = hostScript.indexOf(startMarker);
  const end = hostScript.indexOf('\nPY\n', start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const python = hostScript.slice(start + startMarker.length, end);
  const directory = mkdtempSync(join(tmpdir(), 'balance-env-contract-'));
  const source = join(directory, 'source.json');
  const target = join(directory, 'runtime.env');
  try {
    writeFileSync(source, JSON.stringify(values), { mode: 0o600 });
    const result = spawnSync('python3', ['-', source, target], {
      encoding: 'utf8',
      input: python,
    });
    return {
      output: result.status === 0 ? readFileSync(target, 'utf8') : '',
      status: result.status,
    };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function runEmbeddedHealthValidator(payload: unknown): number | null {
  const hostScript = getBalanceRolloutHostScript();
  const match = hostScript.match(
    /python3 -c "\$\(printf '%s' '([A-Za-z0-9+/=]+)' \| base64 -d\)"/u
  );
  expect(match).not.toBeNull();
  const python = Buffer.from(match?.[1] ?? '', 'base64').toString('utf8');
  return spawnSync('python3', ['-c', python], {
    encoding: 'utf8',
    input: JSON.stringify(payload),
  }).status;
}

function runEmbeddedRegistryAuth(values: string[]): {
  auth: string | null;
  mode: number | null;
  raw: string;
  status: number | null;
} {
  const hostScript = getBalanceRolloutHostScript();
  const startMarker =
    `if ! python3 - "$RUNTIME_ENV_FILE" ` +
    `"$DOCKER_CONFIG_DIR/config.json" "$registry" <<'PY'\n`;
  const start = hostScript.indexOf(startMarker);
  const end = hostScript.indexOf('\nPY\n', start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const python = hostScript.slice(start + startMarker.length, end);
  const directory = mkdtempSync(join(tmpdir(), 'balance-auth-contract-'));
  const source = join(directory, 'runtime.env');
  const target = join(directory, 'config.json');
  try {
    writeFileSync(source, `${values.join('\n')}\n`, { mode: 0o600 });
    const result = spawnSync(
      'python3',
      ['-', source, target, 'harbor.example'],
      {
        encoding: 'utf8',
        input: python,
      }
    );
    const raw = result.status === 0 ? readFileSync(target, 'utf8') : '';
    const parsed = raw
      ? (JSON.parse(raw) as {
          auths?: Record<string, { auth?: string }>;
        })
      : {};
    return {
      auth: parsed.auths?.['harbor.example']?.auth ?? null,
      mode: result.status === 0 ? statSync(target).mode & 0o777 : null,
      raw,
      status: result.status,
    };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function runEmbeddedRegistryCredentialApply(
  values: string[],
  payload: unknown
): {
  mode: number;
  output: string;
  status: number | null;
} {
  const hostScript = getBalanceRolloutHostScript();
  const startMarker = `if ! python3 - "$RUNTIME_ENV_FILE" /dev/fd/8 <<'PY'\n`;
  const start = hostScript.indexOf(startMarker);
  const end = hostScript.indexOf('\nPY\n', start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const python = hostScript.slice(start + startMarker.length, end);
  const directory = mkdtempSync(
    join(tmpdir(), 'balance-credentials-contract-')
  );
  const runtime = join(directory, 'runtime.env');
  const credentials = join(directory, 'credentials.json');
  try {
    writeFileSync(runtime, `${values.join('\n')}\n`, { mode: 0o600 });
    writeFileSync(credentials, JSON.stringify(payload), { mode: 0o600 });
    const result = spawnSync('python3', ['-', runtime, credentials], {
      encoding: 'utf8',
      input: python,
    });
    return {
      mode: statSync(runtime).mode & 0o777,
      output: readFileSync(runtime, 'utf8'),
      status: result.status,
    };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function healthyBalanceResponse() {
  const succeededAt = new Date().toISOString();
  const aliasStatus = () => ({
    content_id: `sha256:${'b'.repeat(64)}`,
    error_code: null as string | null,
    last_success_at: succeededAt,
  });

  return {
    data: {
      worker_images: {
        aliases: {
          'under-worker-baileys:latest': aliasStatus(),
          'under-worker-whatsmeow:latest': aliasStatus(),
          'under-worker-wwebjs:latest': aliasStatus(),
        },
        is_running: true,
        last_success_at: succeededAt,
      },
    },
  };
}

function runProbeWithIdentityOverride(overrides: {
  componentLabel?: string;
  configuredImage?: string;
  dockerHost?: string;
  hostIp?: string;
  restartPolicy?: string;
  rolloutToken?: string;
}): {
  observedDockerEnvironment: string;
  output: string;
  status: number | null;
} {
  const directory = mkdtempSync(join(tmpdir(), 'balance-probe-identity-'));
  const dockerPath = join(directory, 'docker');
  const curlPath = join(directory, 'curl');
  const timeoutPath = join(directory, 'timeout');
  const healthPath = join(directory, 'health.json');
  const dockerEnvironmentPath = join(directory, 'docker-environment');
  const statePath = join(directory, 'state.env');
  const currentId = 'c'.repeat(64);
  const dockerHost = overrides.dockerHost ?? 'unix:///var/run/docker.sock';
  const hostIp = overrides.hostIp ?? '0.0.0.0';
  const restartPolicy = overrides.restartPolicy ?? 'always';
  const configuredImage =
    overrides.configuredImage ?? 'under-balance-api:latest';
  const componentLabel = overrides.componentLabel ?? '';
  const rolloutToken = overrides.rolloutToken ?? '';
  const fakeDocker = `#!/usr/bin/env bash
set -u
printf "%s|%s\\n" "\${DOCKER_HOST:-unset}" "\${DOCKER_CONTEXT-unset}" > "${dockerEnvironmentPath}"
if [ "$1" = ps ]; then
  case "$*" in *under-balance-api-rollback*) exit 0 ;; esac
  printf "%s\\n" "${currentId}"
  exit 0
fi
if [ "$1" = image ] && [ "$2" = inspect ]; then
  printf "%s\\n" "${DIGEST}"
  exit 0
fi
if [ "$1" = inspect ]; then
  FORMAT="$3"
  case "$FORMAT" in
    *Config.Image*) printf "%s\\n" "${configuredImage}" ;;
    *underchat.component*) printf "%s\\n" "${componentLabel}" ;;
    *underchat.balance.rollout-token*) printf "%s\\n" "${rolloutToken}" ;;
    *Config.Env*) printf "SERVER_ID=019e98ad-aab4-715d-aa6b-9e0e027edc24\\nDOCKER_HOST=${dockerHost}\\n" ;;
    *Mounts*) printf "/var/run/docker.sock:/var/run/docker.sock\\n" ;;
    *RestartPolicy.Name*) printf "%s\\n" "${restartPolicy}" ;;
    *NetworkSettings.Networks*) printf "underchat\\n" ;;
    *3003/tcp*HostIp*) printf "%s\\n" "${hostIp}" ;;
    *50051/tcp*HostIp*) printf "%s\\n" "${hostIp}" ;;
    *3003/tcp*HostPort*) printf "3003\\n" ;;
    *50051/tcp*HostPort*) printf "50051\\n" ;;
    *State.Running*) printf "true\\n" ;;
    *State.Health*) printf "healthy\\n" ;;
    *Image*) printf "%s\\n" "${DIGEST}" ;;
    *) exit 1 ;;
  esac
  exit 0
fi
exit 1
`;
  try {
    writeFileSync(dockerPath, fakeDocker, { mode: 0o700 });
    writeFileSync(healthPath, JSON.stringify(healthyBalanceResponse()), {
      mode: 0o600,
    });
    writeFileSync(curlPath, `#!/usr/bin/env bash\ncat "${healthPath}"\n`, {
      mode: 0o700,
    });
    writeFileSync(timeoutPath, '#!/usr/bin/env bash\nexit 0\n', {
      mode: 0o700,
    });
    chmodSync(dockerPath, 0o700);
    chmodSync(curlPath, 0o700);
    chmodSync(timeoutPath, 0o700);
    const command = getBalanceImageProbeCommand({
      imageReference: IMAGE_REFERENCE,
      serverId: '019e98ad-aab4-715d-aa6b-9e0e027edc24',
      webPort: 3003,
    })
      .replace('bash -lc', 'bash -c')
      .replace(
        'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin;',
        `PATH=${directory}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin;`
      )
      .replace('/var/lib/underchat/balance-rollout/state.env', statePath);
    const result = spawnSync('bash', ['-c', command], {
      encoding: 'utf8',
      env: {
        ...process.env,
        DOCKER_CONTEXT: 'inherited-remote-context',
        DOCKER_HOST: 'tcp://inherited.example:2375',
        PATH: `${directory}:${process.env.PATH ?? ''}`,
      },
    });
    return {
      observedDockerEnvironment: readFileSync(dockerEnvironmentPath, 'utf8'),
      output: result.stdout,
      status: result.status,
    };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function runHostRuntimePinWithInheritedRemoteDocker(): string {
  const hostScript = getBalanceRolloutHostScript();
  const argumentsStart = hostScript.indexOf('DESIRED_REF=');
  expect(argumentsStart).toBeGreaterThanOrEqual(0);
  const runtimePin = hostScript.slice(0, argumentsStart);
  const result = spawnSync(
    'bash',
    [
      '-c',
      `${runtimePin}\nprintf "%s|%s|%s\\n" "$PATH" "$DOCKER_HOST" "\${DOCKER_CONTEXT-unset}"`,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        DOCKER_CONTEXT: 'inherited-remote-context',
        DOCKER_HOST: 'tcp://inherited.example:2375',
        PATH: `/untrusted:${process.env.PATH ?? ''}`,
      },
    }
  );
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  return result.stdout;
}

function runFinalizeStartedRecovery(input: {
  backupMarker: string;
  crashAfterBackupRemoval?: boolean;
  eventLog: string;
  stateFile: string;
  tagFails?: boolean;
}) {
  const hostScript = getBalanceRolloutHostScript();
  const currentId = 'c'.repeat(64);
  const oldId = 'd'.repeat(64);
  const source = `
set -Eeuo pipefail
CURRENT_NAME=under-balance-api
BACKUP_NAME=under-balance-api-rollback
NEW_ID="${currentId}"
OLD_ID="${oldId}"
OLD_IMAGE_ID="sha256:${'e'.repeat(64)}"
TARGET_ID="${DIGEST}"
TOKEN=managed-token
PHASE=finalize_started
exact_container_id() {
  case "$1" in
    "$CURRENT_NAME") printf "%s\\n" "$NEW_ID" ;;
    "$BACKUP_NAME") [ -e "$TEST_BACKUP_MARKER" ] && printf "%s\\n" "$OLD_ID" ;;
  esac
  return 0
}
assert_candidate_identity() { [ "$1" = "$NEW_ID" ]; }
assert_existing_balance_identity() { [ "$1" = "$NEW_ID" ]; }
assert_backup_identity() { [ "$1" = "$OLD_ID" ]; }
docker() {
  case "$1" in
    tag)
      printf "tag\\n" >>"$TEST_EVENT_LOG"
      [ "\${TEST_TAG_FAILS:-0}" != 1 ]
      ;;
    inspect) printf "false\\n" ;;
    rm)
      printf "remove-backup\\n" >>"$TEST_EVENT_LOG"
      /bin/rm -f -- "$TEST_BACKUP_MARKER"
      if [ "\${TEST_CRASH_AFTER_REMOVE:-0}" = 1 ]; then kill -KILL $$; fi
      ;;
    *) return 1 ;;
  esac
}
write_state() { printf "%s\\n" "$PHASE" >"$TEST_STATE_FILE"; }
log() { printf "%s\\n" "$*" >>"$TEST_EVENT_LOG"; }
fail() {
  printf "failed:%s\\n" "$1" >>"$TEST_EVENT_LOG"
  exit "\${2:-1}"
}
${extractShellFunction(hostScript, 'complete_started_finalization')}
complete_started_finalization
`;
  return spawnSync('bash', ['-c', source], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TEST_BACKUP_MARKER: input.backupMarker,
      TEST_CRASH_AFTER_REMOVE: input.crashAfterBackupRemoval ? '1' : '0',
      TEST_EVENT_LOG: input.eventLog,
      TEST_STATE_FILE: input.stateFile,
      TEST_TAG_FAILS: input.tagFails ? '1' : '0',
    },
  });
}

function runPreRegistryRecoveryFlow(input: {
  desiredTargetRef: string;
  failedAt?: number;
  loadedTargetRef: string;
  localTargetAvailable?: boolean;
  phase:
    | 'candidate_ready_pending_confirmation'
    | 'candidate_started'
    | 'finalize_started'
    | 'old_backed_up'
    | 'prepared'
    | 'rollback_started'
    | 'rolled_back';
  runtimeLayout?: 'backup-only' | 'candidate-with-backup' | 'old-current';
  runtimePreparationFails?: boolean;
}) {
  const directory = mkdtempSync(join(tmpdir(), 'balance-local-recovery-'));
  const eventLog = join(directory, 'events.log');
  writeFileSync(eventLog, '');
  const hostScript = getBalanceRolloutHostScript();
  const flowStart = hostScript.lastIndexOf('\nload_state\n') + 1;
  const registryStart = hostScript.indexOf(
    '\nprepare_registry_auth\n',
    flowStart
  );
  expect(flowStart).toBeGreaterThan(0);
  expect(registryStart).toBeGreaterThan(flowStart);
  const preRegistryFlow = hostScript
    .slice(flowStart, registryStart)
    .replace(
      'if ! test -S /var/run/docker.sock; then fail docker_socket_missing 66; fi',
      'if false; then fail docker_socket_missing 66; fi'
    );
  const oldId = 'd'.repeat(64);
  const source = `
set -Eeuo pipefail
CURRENT_NAME=under-balance-api
BACKUP_NAME=under-balance-api-rollback
SERVER_ID=019e98ad-aab4-715d-aa6b-9e0e027edc24
WEB_PORT=3003
RETRY_COOLDOWN_SECONDS=900
DESIRED_REF="$TEST_DESIRED_REF"
PHASE="$TEST_PHASE"
TOKEN=managed-token
TARGET_REF="$TEST_LOADED_TARGET_REF"
TARGET_ID="${DIGEST}"
OLD_ID="${oldId}"
OLD_IMAGE_ID="sha256:${'e'.repeat(64)}"
NEW_ID=
READY_AT=0
READY_RESTART_COUNT=-1
FAILED_AT="$TEST_FAILED_AT"
CURRENT_ID_VALUE=
BACKUP_PRESENT=0
RUNNING=false
case "$TEST_RUNTIME_LAYOUT" in
  old-current) CURRENT_ID_VALUE="$OLD_ID" ;;
  backup-only) BACKUP_PRESENT=1 ;;
  candidate-with-backup)
    CURRENT_ID_VALUE="${'c'.repeat(64)}"
    BACKUP_PRESENT=1
    NEW_ID="$CURRENT_ID_VALUE"
    RUNNING=true
    ;;
esac
load_state() { :; }
exact_container_id() {
  case "$1" in
    "$CURRENT_NAME") [ -n "$CURRENT_ID_VALUE" ] && printf "%s\\n" "$CURRENT_ID_VALUE" ;;
    "$BACKUP_NAME") [ "$BACKUP_PRESENT" = 1 ] && printf "%s\\n" "$OLD_ID" ;;
  esac
  return 0
}
container_token() { [ "$1" != "$OLD_ID" ] && printf "%s\\n" "$TOKEN"; return 0; }
container_image_id() {
  if [ "$1" = "$OLD_ID" ]; then printf "%s\\n" "$OLD_IMAGE_ID"; else printf "%s\\n" "$TARGET_ID"; fi
}
assert_journaled_old_current_identity() { [ "$1" = "$OLD_ID" ]; }
assert_backup_identity() { [ "$1" = "$OLD_ID" ]; }
assert_candidate_identity() { [ "$1" = "$NEW_ID" ] && [ "$1" = "$CURRENT_ID_VALUE" ]; }
remove_candidate_exact() {
  printf "remove-candidate\\n" >>"$TEST_FLOW_LOG"
  CURRENT_ID_VALUE=
  RUNNING=false
}
restore_backup_exact() {
  CURRENT_ID_VALUE="$OLD_ID"
  BACKUP_PRESENT=0
  RUNNING=true
  printf "restore-backup\\n" >>"$TEST_FLOW_LOG"
}
wait_rollback_ready() { printf "wait-local-health\\n" >>"$TEST_FLOW_LOG"; }
write_state() { printf "write:%s\\n" "$PHASE" >>"$TEST_FLOW_LOG"; }
log() { printf "%s\\n" "$*" >>"$TEST_FLOW_LOG"; }
fail() { printf "failed:%s\\n" "$1" >>"$TEST_FLOW_LOG"; exit "\${2:-1}"; }
docker() {
  case "$1" in
    network) return 0 ;;
    update) printf "docker-update:%s\\n" "$2" >>"$TEST_FLOW_LOG" ;;
    start) RUNNING=true; printf "docker-start:%s\\n" "$2" >>"$TEST_FLOW_LOG" ;;
    stop) RUNNING=false; printf "docker-stop:%s\\n" "$4" >>"$TEST_FLOW_LOG" ;;
    kill) RUNNING=false; printf "docker-kill:%s\\n" "$2" >>"$TEST_FLOW_LOG" ;;
    rename)
      CURRENT_ID_VALUE=
      BACKUP_PRESENT=1
      printf "docker-rename:%s:%s\\n" "$2" "$3" >>"$TEST_FLOW_LOG"
      ;;
    inspect)
      case "$3" in
        *State.Running*) printf "%s\\n" "$RUNNING" ;;
        *) return 1 ;;
      esac
      ;;
    *) return 1 ;;
  esac
}
timeout() { shift; "$@"; }
prepare_runtime_env() {
  printf "prepare-runtime-env\\n" >>"$TEST_FLOW_LOG"
  [ "$TEST_RUNTIME_PREPARATION_FAILS" != 1 ] || exit 66
}
apply_runtime_environment_overrides() { printf "apply-runtime-overrides\\n" >>"$TEST_FLOW_LOG"; }
validate_journaled_target_local() {
  printf "validate-local-target\\n" >>"$TEST_FLOW_LOG"
  [ "$TEST_LOCAL_TARGET_AVAILABLE" = 1 ]
}
validate_reserved_ports() { printf "validate-ports\\n" >>"$TEST_FLOW_LOG"; }
start_candidate_exact() { printf "start-candidate-local\\n" >>"$TEST_FLOW_LOG"; }
handle_pending_candidate() { printf "handle-candidate-local\\n" >>"$TEST_FLOW_LOG"; }
recover_rollback_candidate_locally() { printf "recover-candidate-local\\n" >>"$TEST_FLOW_LOG"; }
complete_started_finalization() { printf "complete-finalization-local\\n" >>"$TEST_FLOW_LOG"; }
prepare_registry_auth() { printf "REGISTRY-CALLED\\n" >>"$TEST_FLOW_LOG"; }
${extractShellFunction(hostScript, 'is_nonterminal_phase')}
${extractShellFunction(hostScript, 'mark_local_rollback_complete')}
${extractShellFunction(hostScript, 'rollback_after_local_target_loss')}
${extractShellFunction(hostScript, 'recover_interrupted_old_before_remote')}
${preRegistryFlow}
prepare_registry_auth
`;
  try {
    const result = spawnSync('bash', ['-c', source], {
      encoding: 'utf8',
      env: {
        ...process.env,
        TEST_DESIRED_REF: input.desiredTargetRef,
        TEST_FAILED_AT: String(input.failedAt ?? 0),
        TEST_FLOW_LOG: eventLog,
        TEST_LOCAL_TARGET_AVAILABLE:
          input.localTargetAvailable === false ? '0' : '1',
        TEST_LOADED_TARGET_REF: input.loadedTargetRef,
        TEST_PHASE: input.phase,
        TEST_RUNTIME_LAYOUT: input.runtimeLayout ?? 'old-current',
        TEST_RUNTIME_PREPARATION_FAILS: input.runtimePreparationFails
          ? '1'
          : '0',
      },
    });
    return { ...result, flow: readFileSync(eventLog, 'utf8') };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function runAlreadyCurrentRecognition(input: {
  actualToken: string;
  configuredImage: string;
  initialNewId?: string;
  initialToken?: string;
}) {
  const hostScript = getBalanceRolloutHostScript();
  const branchStart = hostScript.lastIndexOf(
    '\nCURRENT_ID="$(exact_container_id "$CURRENT_NAME")"\n'
  );
  const branchEnd = hostScript.indexOf(
    '\nTOKEN="$(cat /proc/sys/kernel/random/uuid)"',
    branchStart
  );
  expect(branchStart).toBeGreaterThan(0);
  expect(branchEnd).toBeGreaterThan(branchStart);
  const branch = hostScript.slice(branchStart + 1, branchEnd);
  const currentId = 'c'.repeat(64);
  const source = `
set -Eeuo pipefail
CURRENT_NAME=under-balance-api
BACKUP_NAME=under-balance-api-rollback
CAPTURED_ENV_CONTAINER_ID="${currentId}"
TARGET_ID="${DIGEST}"
TOKEN="$TEST_INITIAL_TOKEN"
NEW_ID="$TEST_INITIAL_NEW_ID"
OLD_ID=old
OLD_IMAGE_ID=old-image
READY_AT=0
READY_RESTART_COUNT=-1
PHASE=complete
exact_container_id() {
  [ "$1" = "$CURRENT_NAME" ] && printf "%s\\n" "${currentId}"
  return 0
}
target_runtime_ready() { return 0; }
container_token() { printf "%s\\n" "$TEST_ACTUAL_TOKEN"; }
docker() {
  case "$1" in
    inspect)
      case "$3" in
        *Config.Image*) printf "%s\\n" "$TEST_CONFIGURED_IMAGE" ;;
        *RestartCount*) printf "0\\n" ;;
        *) return 1 ;;
      esac
      ;;
    tag) printf "tagged\\n" ;;
    *) return 1 ;;
  esac
}
write_state() {
  printf "STATE=%s|TOKEN=%s|NEW_ID=%s\\n" "$PHASE" "$TOKEN" "$NEW_ID"
}
log() { printf "%s\\n" "$*"; }
fail() { printf "failed:%s\\n" "$1"; exit "\${2:-1}"; }
${extractShellFunction(hostScript, 'is_named_balance_image_reference')}
${branch}
`;
  return spawnSync('bash', ['-c', source], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TEST_ACTUAL_TOKEN: input.actualToken,
      TEST_CONFIGURED_IMAGE: input.configuredImage,
      TEST_INITIAL_NEW_ID: input.initialNewId ?? '',
      TEST_INITIAL_TOKEN: input.initialToken ?? '',
    },
  });
}

describe('Balance image rollout host command contract', () => {
  it('accepts only a content-addressed image reference', () => {
    expect(() =>
      getReconcileBalanceContainerCommand({
        imageReference:
          'harbor.example/underchat/balance/under-balance-api:v123',
        readinessTimeoutMs: 420_000,
        retryCooldownMs: 900_000,
        serverId: '019e98ad-aab4-715d-aa6b-9e0e027edc24',
        stabilityWindowMs: 120_000,
        webPort: 3003,
      })
    ).toThrow('immutable sha256 image reference');
  });

  it('rejects shell metacharacters in every interpolated host argument', () => {
    expect(() =>
      getReconcileBalanceContainerCommand({
        imageReference: `${IMAGE_REFERENCE}'; touch /tmp/injected; '`,
        readinessTimeoutMs: 420_000,
        retryCooldownMs: 900_000,
        serverId: '019e98ad-aab4-715d-aa6b-9e0e027edc24',
        stabilityWindowMs: 120_000,
        webPort: 3003,
      })
    ).toThrow('immutable sha256 image reference');
    expect(() =>
      getReconcileBalanceContainerCommand({
        imageReference: IMAGE_REFERENCE,
        readinessTimeoutMs: 420_000,
        retryCooldownMs: 900_000,
        serverId: "019e98ad-aab4-715d-aa6b-9e0e027e';id",
        stabilityWindowMs: 120_000,
        webPort: 3003,
      })
    ).toThrow('Invalid Balance rollout server ID');
  });

  it('ships a syntactically valid, journaled two-phase rollout state machine', () => {
    const script = getBalanceRolloutHostScript();
    expectValidBash(script);

    expect(script).toContain('PHASE=candidate_started');
    expect(script).toContain('PHASE=candidate_ready_pending_confirmation');
    expect(script).toContain('PHASE=rollback_started');
    expect(script).toContain('PHASE=finalize_started');
    expect(script).toContain('PHASE=rolled_back');
    expect(script).toContain('PHASE=complete');
    expect(script).toContain('write_state');
    expect(script).toContain('READY_RESTART_COUNT');
    expect(script).toContain(
      'if [ $((now - READY_AT)) -lt "$STABILITY_WINDOW_SECONDS" ]'
    );
  });

  it('pins the candidate by content ID and preserves exact rollback identity', () => {
    const script = getBalanceRolloutHostScript();

    expect(script).toContain('"$TARGET_ID")');
    expect(script).toContain(
      '--label "underchat.balance.rollout-token=$TOKEN"'
    );
    expect(script).toContain(
      '--label "underchat.balance.target-content=$TARGET_ID"'
    );
    expect(script).toContain('target_manifest_digest_not_verified');
    expect(script).toContain(
      '[ "$(container_image_id "$container_id")" = "$TARGET_ID" ]'
    );
    expect(script).toContain(
      '[ "$(container_image_id "$container_id")" = "$OLD_IMAGE_ID" ]'
    );
    expect(script).toContain('docker ps -aq --no-trunc --filter "name=^/$1$"');
    expect(script).toContain(
      'docker ps -q --no-trunc --filter "publish=$WEB_PORT"'
    );
    expect(script).toContain('docker rm "$backup_id"');
    expect(script).not.toContain('docker rm -f "$CURRENT_NAME"');
    expect(script).not.toContain('docker rm -f "$BACKUP_NAME"');
    expect(script).not.toContain('docker rm -f under-balance-api');
  });

  it('validates host prerequisites and refuses foreign port owners', () => {
    const script = getBalanceRolloutHostScript();

    expect(script).toContain(
      'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
    );
    expect(script).toContain('unset DOCKER_CONTEXT');
    expect(script).toContain('DOCKER_HOST=unix:///var/run/docker.sock');
    expect(script.indexOf('unset DOCKER_CONTEXT')).toBeLessThan(
      script.indexOf('docker network inspect underchat')
    );
    expect(script).toContain('test -S /var/run/docker.sock');
    expect(script).toContain('docker network inspect underchat');
    expect(script).toContain('exec 9<"$STATE_DIR"');
    expect(script).not.toContain('/var/lock/underchat-balance-rollout.lock');
    expect(script).toContain('foreign_reserved_port_owner');
    expect(script).toContain('assert_existing_balance_identity');
    expect(script).toContain(`sed -n 's/^SERVER_ID=//p' | tail -n 1`);
    expect(script).toContain(
      "grep -Fx '/var/run/docker.sock:/var/run/docker.sock'"
    );
    expect(script).not.toContain('NATS_CREDS_DIRECTORY');
    expect(script).not.toContain('nats-worker-creds');
    expect(script).toContain('--env-file "$RUNTIME_ENV_FILE"');
    expect(script).not.toContain('/home/app/.env');
    expect(script).not.toContain('/home/app/.docker');
    expect(script).not.toContain('docker login');
    expect(script).toContain('base64.b64encode');
    expect(script).toContain(
      `sed -n 's/^HARBOR_REGISTRY=//p' "$RUNTIME_ENV_FILE" | tail -n 1`
    );
    expect(script).toContain('os.O_WRONLY | os.O_CREAT | os.O_EXCL');
    expect(script).toContain('mktemp "$STATE_DIR/runtime-env.XXXXXX"');
    expect(script).toContain('chmod 0600 "$RUNTIME_ENV_FILE"');
    expect(script).toContain('-v /var/run/docker.sock:/var/run/docker.sock');
    expect(script).not.toContain('worker-creds');
    expect(script).toContain('--network underchat');
    expect(script).toContain(
      'assert_existing_balance_identity "$container_id"'
    );
  });

  it('requires the exact operational identity and never adopts an unlabelled replacement', () => {
    const script = getBalanceRolloutHostScript();
    const runtimeIdentity = extractShellFunction(
      script,
      'assert_existing_balance_runtime_identity'
    );
    const strictIdentity = extractShellFunction(
      script,
      'assert_existing_balance_identity'
    );
    const journaledIdentity = extractShellFunction(
      script,
      'assert_journaled_old_current_identity'
    );
    const prepareRuntimeEnv = extractShellFunction(
      script,
      'prepare_runtime_env'
    );

    expect(runtimeIdentity).toContain("sed -n 's/^DOCKER_HOST=//p'");
    expect(runtimeIdentity).toContain('unix:///var/run/docker.sock');
    expect(runtimeIdentity).toContain('.HostConfig.PortBindings "3003/tcp"');
    expect(runtimeIdentity).toContain('.HostConfig.PortBindings "50051/tcp"');
    expect(runtimeIdentity).toContain("in ''|0.0.0.0)");
    expect(strictIdentity).toContain(
      'assert_existing_balance_runtime_identity "$container_id"'
    );
    expect(strictIdentity).toContain("'{{.HostConfig.RestartPolicy.Name}}'");
    expect(strictIdentity).toContain('= always ]');
    expect(journaledIdentity).toContain(
      'case "$PHASE" in prepared|rollback_started)'
    );
    expect(journaledIdentity).toContain('[ "$container_id" = "$OLD_ID" ]');
    expect(journaledIdentity).toContain(
      '[ "$(container_image_id "$container_id")" = "$OLD_IMAGE_ID" ]'
    );
    expect(journaledIdentity).toContain('case "$restart_policy" in always|no)');
    expect(prepareRuntimeEnv).toContain(
      '[ "$PHASE" = prepared ] || [ "$PHASE" = rollback_started ]'
    );
    expect(prepareRuntimeEnv).toContain(
      'assert_journaled_old_current_identity "$current_id"'
    );
    expect(script).not.toContain('ADOPTED_EXTERNAL');
    expect(script).not.toContain('adopt_external_replacement');
    expect(script).not.toContain('TOKEN="adopted-');
  });

  it('routes every durable recovery phase through a local decision before Harbor', () => {
    const script = getBalanceRolloutHostScript();
    const flowStart = script.lastIndexOf('\nload_state\n');
    const flow = script.slice(flowStart);
    const registryIndex = flow.indexOf('\nprepare_registry_auth\n');
    const localValidationIndex = flow.indexOf(
      'validate_journaled_target_local'
    );
    const finalizeDispatchIndex = flow.indexOf(
      'if [ "$PHASE" = finalize_started ]'
    );
    const runtimePreparationIndex = flow.indexOf('\nprepare_runtime_env\n');
    const localRecoveryCaseIndex = flow.indexOf(
      'case "$PHASE" in',
      localValidationIndex
    );

    expect(flowStart).toBeGreaterThanOrEqual(0);
    expect(finalizeDispatchIndex).toBeGreaterThanOrEqual(0);
    expect(finalizeDispatchIndex).toBeLessThan(localValidationIndex);
    expect(localValidationIndex).toBeLessThan(runtimePreparationIndex);
    expect(localValidationIndex).toBeGreaterThanOrEqual(0);
    expect(localRecoveryCaseIndex).toBeGreaterThan(localValidationIndex);
    expect(registryIndex).toBeGreaterThan(localRecoveryCaseIndex);
    for (const phase of [
      'prepared)',
      'old_backed_up)',
      'candidate_started|candidate_ready_pending_confirmation)',
      'rollback_started)',
    ]) {
      const phaseIndex = flow.indexOf(phase, localRecoveryCaseIndex);
      expect(phaseIndex).toBeGreaterThan(localRecoveryCaseIndex);
      expect(phaseIndex).toBeLessThan(registryIndex);
    }
  });

  it('recovers by the persisted content ID without requiring a mutable tag or RepoDigest entry', () => {
    const validate = extractShellFunction(
      getBalanceRolloutHostScript(),
      'validate_journaled_target_local'
    );

    expect(validate).toContain('\'{{.Id}}\' "$TARGET_ID"');
    expect(validate).not.toContain('$TARGET_REF');
    expect(validate).not.toContain('RepoDigests');
  });

  it('journals the no-return phase before idempotent tag and backup cleanup', () => {
    const script = getBalanceRolloutHostScript();
    const authorize = extractShellFunction(script, 'finalize_candidate');
    const complete = extractShellFunction(
      script,
      'complete_started_finalization'
    );

    expect(authorize.indexOf('PHASE=finalize_started')).toBeLessThan(
      authorize.indexOf('write_state')
    );
    expect(authorize.indexOf('write_state')).toBeLessThan(
      authorize.indexOf('complete_started_finalization')
    );
    expect(complete.indexOf('docker tag')).toBeLessThan(
      complete.indexOf('docker rm "$backup_id"')
    );
    expect(complete.indexOf('docker rm "$backup_id"')).toBeLessThan(
      complete.indexOf('PHASE=complete')
    );
    expect(complete).not.toContain('rollback_exact');
    expect(complete).not.toContain('confirm_candidate_ready');
  });

  it.each([
    ['prepared after restart was disabled', 'prepared'],
    ['rollback after the old container was renamed back', 'rollback_started'],
  ])(
    'recovers the %s crash window using the exact journaled old identity',
    (_label, phase) => {
      expect(
        runOldRuntimeIdentityRecovery({
          phase,
          restartPolicy: 'no',
        })
      ).toEqual({
        journaledStatus: 0,
        prepareRuntimeStatus: 0,
        strictStatus: 1,
      });
    }
  );

  it('accepts restart=always for both strict and journaled old identities', () => {
    expect(
      runOldRuntimeIdentityRecovery({
        phase: 'prepared',
        restartPolicy: 'always',
      })
    ).toEqual({
      journaledStatus: 0,
      prepareRuntimeStatus: 0,
      strictStatus: 0,
    });
  });

  it('does not relax restart policy outside the two exact crash phases', () => {
    expect(
      runOldRuntimeIdentityRecovery({
        phase: 'candidate_started',
        restartPolicy: 'no',
      })
    ).toEqual({
      journaledStatus: 1,
      prepareRuntimeStatus: 70,
      strictStatus: 1,
    });
  });

  it.each([
    ['container ID', { oldId: 'd'.repeat(64) }],
    ['image ID', { oldImageId: `sha256:${'d'.repeat(64)}` }],
  ])(
    'rejects a journaled old identity with a mismatched %s',
    (_label, input) => {
      const result = runOldRuntimeIdentityRecovery({
        ...input,
        phase: 'prepared',
        restartPolicy: 'always',
      });

      expect(result.journaledStatus).toBe(1);
    }
  );

  it('resumes finalize_started after a crash removed the backup without attempting rollback', () => {
    const directory = mkdtempSync(join(tmpdir(), 'balance-finalize-crash-'));
    const backupMarker = join(directory, 'backup-present');
    const eventLog = join(directory, 'events.log');
    const stateFile = join(directory, 'state');
    try {
      writeFileSync(backupMarker, 'present');
      writeFileSync(eventLog, '');
      writeFileSync(stateFile, 'finalize_started\n');

      const interrupted = runFinalizeStartedRecovery({
        backupMarker,
        crashAfterBackupRemoval: true,
        eventLog,
        stateFile,
      });

      expect(interrupted.status).toBeNull();
      expect(interrupted.signal).toBe('SIGKILL');
      expect(existsSync(backupMarker)).toBe(false);
      expect(readFileSync(stateFile, 'utf8')).toBe('finalize_started\n');

      const resumed = runFinalizeStartedRecovery({
        backupMarker,
        eventLog,
        stateFile,
      });

      expect(resumed.status).toBe(0);
      expect(readFileSync(stateFile, 'utf8')).toBe('complete\n');
      const events = readFileSync(eventLog, 'utf8');
      expect(events.match(/^tag$/gmu)).toHaveLength(2);
      expect(events.match(/^remove-backup$/gmu)).toHaveLength(1);
      expect(events).toContain('event=completed');
      expect(events).not.toContain('rollback');
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('keeps the exact backup and finalize_started journal when tagging fails', () => {
    const directory = mkdtempSync(join(tmpdir(), 'balance-finalize-tag-'));
    const backupMarker = join(directory, 'backup-present');
    const eventLog = join(directory, 'events.log');
    const stateFile = join(directory, 'state');
    try {
      writeFileSync(backupMarker, 'present');
      writeFileSync(eventLog, '');
      writeFileSync(stateFile, 'finalize_started\n');

      const failed = runFinalizeStartedRecovery({
        backupMarker,
        eventLog,
        stateFile,
        tagFails: true,
      });

      expect(failed.status).toBe(69);
      expect(existsSync(backupMarker)).toBe(true);
      expect(readFileSync(stateFile, 'utf8')).toBe('finalize_started\n');
      expect(readFileSync(eventLog, 'utf8')).not.toContain('remove-backup');

      const resumed = runFinalizeStartedRecovery({
        backupMarker,
        eventLog,
        stateFile,
      });
      expect(resumed.status).toBe(0);
      expect(existsSync(backupMarker)).toBe(false);
      expect(readFileSync(stateFile, 'utf8')).toBe('complete\n');
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('restores a prepared restart=no runtime and resumes from the locally verified target before Harbor', () => {
    const result = runPreRegistryRecoveryFlow({
      desiredTargetRef: IMAGE_REFERENCE,
      loadedTargetRef: IMAGE_REFERENCE,
      phase: 'prepared',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.flow).not.toContain('REGISTRY-CALLED');
    const expectedOrder = [
      'docker-update:--restart=always',
      'docker-start:',
      'wait-local-health',
      'validate-local-target',
      'prepare-runtime-env',
      'apply-runtime-overrides',
      'docker-update:--restart=no',
      'docker-stop:',
      'docker-rename:',
      'start-candidate-local',
    ];
    let previousIndex = -1;
    for (const event of expectedOrder) {
      const eventIndex = result.flow.indexOf(event);
      expect(eventIndex).toBeGreaterThan(previousIndex);
      previousIndex = eventIndex;
    }
  });

  it('finishes rollback_started locally before runtime env or Harbor access', () => {
    const result = runPreRegistryRecoveryFlow({
      desiredTargetRef: IMAGE_REFERENCE,
      loadedTargetRef: IMAGE_REFERENCE,
      phase: 'rollback_started',
    });

    expect(result.status).toBe(42);
    expect(result.stderr).toBe('');
    expect(result.flow).toContain('docker-update:--restart=always');
    expect(result.flow).toContain('docker-start:');
    expect(result.flow).toContain('write:rolled_back');
    expect(result.flow).not.toContain('prepare-runtime-env');
    expect(result.flow).not.toContain('REGISTRY-CALLED');
  });

  it('applies rollback cooldown only to the digest that actually failed', () => {
    const recentFailure = Math.floor(Date.now() / 1000);
    const otherImageReference =
      `harbor.example/underchat/balance/under-balance-api@sha256:` +
      'b'.repeat(64);
    const sameDigest = runPreRegistryRecoveryFlow({
      desiredTargetRef: IMAGE_REFERENCE,
      failedAt: recentFailure,
      loadedTargetRef: IMAGE_REFERENCE,
      phase: 'rolled_back',
    });
    const differentDigest = runPreRegistryRecoveryFlow({
      desiredTargetRef: otherImageReference,
      failedAt: recentFailure,
      loadedTargetRef: IMAGE_REFERENCE,
      phase: 'rolled_back',
    });

    expect(sameDigest.status).toBe(0);
    expect(sameDigest.flow).toContain('event=retry_cooldown');
    expect(sameDigest.flow).not.toContain('REGISTRY-CALLED');
    expect(differentDigest.status).toBe(0);
    expect(differentDigest.flow).toContain('REGISTRY-CALLED');
  });

  it.each([
    ['prepared', 'old-current', 'local_target_loss_old_preserved'],
    ['old_backed_up', 'backup-only', 'local_target_loss_rolled_back'],
    [
      'candidate_started',
      'candidate-with-backup',
      'local_target_loss_rolled_back',
    ],
    [
      'candidate_ready_pending_confirmation',
      'candidate-with-backup',
      'local_target_loss_rolled_back',
    ],
    [
      'rollback_started',
      'candidate-with-backup',
      'local_target_loss_rolled_back',
    ],
  ] as const)(
    'recovers %s locally when its persisted target image is gone',
    (phase, runtimeLayout, expectedEvent) => {
      const result = runPreRegistryRecoveryFlow({
        desiredTargetRef: IMAGE_REFERENCE,
        loadedTargetRef: IMAGE_REFERENCE,
        localTargetAvailable: false,
        phase,
        runtimeLayout,
        runtimePreparationFails: true,
      });

      expect(result.status).toBe(42);
      expect(result.stderr).toBe('');
      expect(result.flow).toContain('validate-local-target');
      expect(result.flow).toContain(`event=${expectedEvent}`);
      expect(result.flow).toContain('write:rolled_back');
      expect(result.flow).not.toContain('REGISTRY-CALLED');
      expect(result.flow).not.toContain('prepare-runtime-env');
      expect(result.flow).not.toContain('apply-runtime-overrides');
      if (runtimeLayout === 'candidate-with-backup') {
        expect(result.flow).toContain('remove-candidate');
        expect(result.flow).toContain('restore-backup');
      }
      if (runtimeLayout === 'backup-only') {
        expect(result.flow).toContain('restore-backup');
      }
    }
  );

  it('completes finalize_started without target ref, env capture or credential preparation', () => {
    const result = runPreRegistryRecoveryFlow({
      desiredTargetRef: IMAGE_REFERENCE,
      loadedTargetRef: IMAGE_REFERENCE,
      localTargetAvailable: false,
      phase: 'finalize_started',
      runtimeLayout: 'candidate-with-backup',
      runtimePreparationFails: true,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.flow).toContain('complete-finalization-local');
    expect(result.flow).not.toContain('prepare-runtime-env');
    expect(result.flow).not.toContain('apply-runtime-overrides');
    expect(result.flow).not.toContain('validate-local-target');
    expect(result.flow).not.toContain('REGISTRY-CALLED');
  });

  it('keeps a named terminal legacy runtime tokenless and recognizable across consecutive passes', () => {
    const first = runAlreadyCurrentRecognition({
      actualToken: '',
      configuredImage: 'under-balance-api:latest',
    });
    const second = runAlreadyCurrentRecognition({
      actualToken: '',
      configuredImage: 'under-balance-api:latest',
      initialNewId: '',
      initialToken: '',
    });

    expect(first.status).toBe(0);
    expect(first.stdout).toContain('STATE=complete|TOKEN=|NEW_ID=');
    expect(first.stdout).not.toContain('adopted-');
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('STATE=complete|TOKEN=|NEW_ID=');
    expect(second.stdout).not.toContain('adopted-');
  });

  it('refuses tokenless raw-sha terminal recognition even if the outer readiness gate is stubbed true', () => {
    const result = runAlreadyCurrentRecognition({
      actualToken: '',
      configuredImage: DIGEST,
    });

    expect(result.status).toBe(70);
    expect(result.stdout).toContain('failed:terminal_legacy_identity_mismatch');
  });

  it('requires worker provisioning, HTTP, gRPC and Docker health before acceptance', () => {
    const script = getBalanceRolloutHostScript();

    expect(script).toContain('.State.Health.Status');
    expect(script).toContain('python3 -c');
    expect(script).toContain('/dev/tcp/127.0.0.1/50051');
    expect(script).toContain('confirm_candidate_ready');
    expect(runEmbeddedHealthValidator(healthyBalanceResponse())).toBe(0);

    const incomplete = healthyBalanceResponse();
    Reflect.deleteProperty(
      incomplete.data.worker_images.aliases,
      'under-worker-whatsmeow:latest'
    );
    expect(runEmbeddedHealthValidator(incomplete)).not.toBe(0);

    const degraded = healthyBalanceResponse();
    degraded.data.worker_images.aliases[
      'under-worker-baileys:latest'
    ].error_code = 'worker_image_pull_failed';
    expect(runEmbeddedHealthValidator(degraded)).not.toBe(0);

    const stale = healthyBalanceResponse();
    stale.data.worker_images.last_success_at = new Date(
      Date.now() - 16 * 60 * 1000
    ).toISOString();
    expect(runEmbeddedHealthValidator(stale)).not.toBe(0);
  });

  it('resumes a rollback interrupted after the old container was renamed back', () => {
    const script = getBalanceRolloutHostScript();

    expect(script).toContain('[ "$current_id" = "$OLD_ID" ]');
    expect(script).toContain('restored_rollback_identity_mismatch');
    expect(script).toContain(
      'event=rollback_restored_before_remote token=$TOKEN'
    );
  });

  it('preserves env-file spaces, hashes, equals, quotes and empty values without evaluating them', () => {
    const values = [
      'SERVER_ID=019e98ad-aab4-715d-aa6b-9e0e027edc24',
      `HARBOR_PASSWORD=space and 'single' plus "double" # fragment`,
      'QUERY_VALUE=left=middle=right',
      'OTHER_SECRET="literal outer quotes stay intact"',
      'OPTIONAL_VALUE=',
    ];
    expect(runEmbeddedEnvironmentNormalizer(values)).toEqual({
      output: `${values.join('\n')}\n`,
      status: 0,
    });

    const script = getBalanceRolloutHostScript();
    expect(script).not.toContain('set -x');
    expect(script).not.toContain('cat "$RUNTIME_ENV_FILE"');
    expect(script).not.toContain('printf \'%s\' "$RUNTIME_ENV_FILE"');
  });

  it('captures malformed legacy Harbor values verbatim for canonical replacement', () => {
    const values = [
      'HARBOR_USERNAME=old-user',
      'HARBOR_PASSWORD="unterminated',
      'HARBOR_NAMESPACE=',
    ];
    expect(runEmbeddedEnvironmentNormalizer(values)).toEqual({
      output: `${values.join('\n')}\n`,
      status: 0,
    });
  });

  it('fails closed when a captured environment value contains a newline', () => {
    expect(
      runEmbeddedEnvironmentNormalizer([
        'SERVER_ID=019e98ad-aab4-715d-aa6b-9e0e027edc24',
        'HARBOR_PASSWORD=first-line\nsecond-line',
      ]).status
    ).not.toBe(0);
  });

  it('rejects invalid environment keys and carriage returns', () => {
    expect(
      runEmbeddedEnvironmentNormalizer([
        'SERVER_ID=019e98ad-aab4-715d-aa6b-9e0e027edc24',
        'export HARBOR_PASSWORD=secret',
      ]).status
    ).not.toBe(0);
    expect(
      runEmbeddedEnvironmentNormalizer([
        'SERVER_ID=019e98ad-aab4-715d-aa6b-9e0e027edc24',
        'HARBOR_PASSWORD=first\rsecond',
      ]).status
    ).not.toBe(0);
  });

  it('builds root-only registry auth without evaluating or exposing the password', () => {
    const password = `space and 'quotes' # fragment = value`;
    const result = runEmbeddedRegistryAuth([
      'HARBOR_USERNAME=robot',
      `HARBOR_PASSWORD=${password}`,
    ]);

    expect(result).toMatchObject({
      auth: Buffer.from(`robot:${password}`).toString('base64'),
      mode: 0o600,
      status: 0,
    });
    expect(result.raw).not.toContain(password);
    expect(
      runEmbeddedRegistryAuth(['HARBOR_USERNAME=robot', 'HARBOR_PASSWORD='])
        .status
    ).not.toBe(0);
  });

  it('atomically applies Harbor values from systemd stdin', () => {
    const password = `new "quoted" and 'literal' # password = value`;
    const result = runEmbeddedRegistryCredentialApply(
      [
        'SERVER_ID=019e98ad-aab4-715d-aa6b-9e0e027edc24',
        'HARBOR_REGISTRY=old-harbor.example',
        'HARBOR_NAMESPACE=old/namespace',
        'HARBOR_USERNAME=old-user',
        'HARBOR_PASSWORD="old-password',
        'UNCHANGED=value=with=equals',
      ],
      {
        HARBOR_REGISTRY: 'harbor.example',
        HARBOR_NAMESPACE: 'underchat/balance',
        HARBOR_USERNAME: 'current-user',
        HARBOR_PASSWORD: password,
      }
    );

    expect(result).toEqual({
      mode: 0o600,
      output:
        'SERVER_ID=019e98ad-aab4-715d-aa6b-9e0e027edc24\n' +
        'UNCHANGED=value=with=equals\n' +
        'HARBOR_REGISTRY=harbor.example\n' +
        'HARBOR_NAMESPACE=underchat/balance\n' +
        'HARBOR_USERNAME=current-user\n' +
        `HARBOR_PASSWORD=${password}\n`,
      status: 0,
    });
    expect(result.output).not.toContain('old-user');
    expect(result.output).not.toContain('old-password');
    expect(result.output).not.toContain('old/namespace');
  });

  it('fails closed for incomplete, extra or multiline registry payloads', () => {
    const runtime = ['SERVER_ID=019e98ad-aab4-715d-aa6b-9e0e027edc24'];
    const valid = {
      HARBOR_REGISTRY: 'harbor.example',
      HARBOR_NAMESPACE: 'underchat/balance',
      HARBOR_USERNAME: 'current-user',
      HARBOR_PASSWORD: 'current-password',
    };

    expect(
      runEmbeddedRegistryCredentialApply(runtime, {
        HARBOR_REGISTRY: valid.HARBOR_REGISTRY,
        HARBOR_USERNAME: valid.HARBOR_USERNAME,
      }).status
    ).not.toBe(0);
    expect(
      runEmbeddedRegistryCredentialApply(runtime, {
        ...valid,
        UNEXPECTED_KEY: 'must-not-be-applied',
      }).status
    ).not.toBe(0);
    expect(
      runEmbeddedRegistryCredentialApply(runtime, {
        ...valid,
        HARBOR_PASSWORD: 'first-line\nsecond-line',
      }).status
    ).not.toBe(0);
  });

  it('installs an integrity-checked script in a bounded systemd unit', () => {
    const command = getReconcileBalanceContainerCommand({
      imageReference: IMAGE_REFERENCE,
      readinessTimeoutMs: 420_000,
      retryCooldownMs: 900_000,
      serverId: '019e98ad-aab4-715d-aa6b-9e0e027edc24',
      stabilityWindowMs: 120_000,
      webPort: 3003,
    });
    expectValidBash(command);

    expect(command).toContain('sha256sum -c -');
    expect(command).toContain('systemd-run --quiet --collect --pipe --wait');
    expect(command).toContain('--unit="underchat-balance-rollout-v1.service"');
    expect(command).toContain('--property=RuntimeMaxSec=930');
    expect(command).toContain(`"${IMAGE_REFERENCE}"`);
  });

  it('keeps the fleet-selection probe strictly read-only', () => {
    const command = getBalanceImageProbeCommand({
      imageReference: IMAGE_REFERENCE,
      serverId: '019e98ad-aab4-715d-aa6b-9e0e027edc24',
      webPort: 3003,
    });
    expectValidBash(command);

    expect(command).toContain('UNDERCHAT_BALANCE_PROBE_V1');
    expect(command).toContain(
      'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
    );
    expect(command).toContain('unset DOCKER_CONTEXT');
    expect(command).toContain('DOCKER_HOST=unix:///var/run/docker.sock');
    expect(command).toContain('docker image inspect');
    expect(command).toContain('s/^SERVER_ID=//p');
    expect(command).toContain('019e98ad-aab4-715d-aa6b-9e0e027edc24');
    expect(command).toContain('.State.Health.Status');
    expect(command).toContain('index .Config.Labels \\"underchat.component\\"');
    expect(command).toContain(
      'index .Config.Labels \\"underchat.balance.rollout-token\\"'
    );
    expect(command).toContain('/var/run/docker.sock:/var/run/docker.sock');
    expect(command).not.toContain('worker-creds');
    expect(command).toContain('.NetworkSettings.Networks');
    expect(command).toContain('s/^DOCKER_HOST=//p');
    expect(command).toContain('.HostConfig.RestartPolicy.Name');
    expect(command).toContain('.HostConfig.PortBindings');
    expect(command).toContain('.HostIp');
    expect(command).toContain('0.0.0.0');
    expect(command).toContain('/dev/tcp/127.0.0.1/50051');
    expect(command).toContain('state_target_ref=');
    expect(command).not.toContain('docker pull');
    expect(command).not.toContain('docker run');
    expect(command).not.toContain('docker stop');
    expect(command).not.toContain('docker rm');
  });

  it('overrides inherited remote Docker host and context before every probe or rollout operation', () => {
    const probe = runProbeWithIdentityOverride({});

    expect(probe.status).toBe(0);
    expect(probe.output).toContain('status=converged');
    expect(probe.observedDockerEnvironment).toBe(
      'unix:///var/run/docker.sock|unset\n'
    );
    expect(runHostRuntimePinWithInheritedRemoteDocker()).toBe(
      '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin|' +
        'unix:///var/run/docker.sock|unset\n'
    );
  });

  it.each([
    ['local-only port binding', { hostIp: '127.0.0.1' }],
    ['non-durable restart policy', { restartPolicy: 'no' }],
    ['wrong Docker socket endpoint', { dockerHost: 'tcp://docker:2375' }],
    ['unmanaged raw content ID', { configuredImage: DIGEST }],
    [
      'malformed raw content ID',
      {
        componentLabel: 'balance-api',
        configuredImage: 'sha256:foo',
        rolloutToken: 'managed-token',
      },
    ],
  ])('probe rejects %s before reporting convergence', (_label, override) => {
    const result = runProbeWithIdentityOverride(override);

    expect(result.status).toBe(0);
    expect(result.output).toContain('status=unhealthy');
    expect(result.output).not.toContain('status=converged');
  });

  it('probe accepts an exact raw content ID only with managed component and token labels', () => {
    const result = runProbeWithIdentityOverride({
      componentLabel: 'balance-api',
      configuredImage: DIGEST,
      rolloutToken: 'managed-token',
    });

    expect(result.status).toBe(0);
    expect(result.output).toContain('status=converged');
  });

  it('keeps the host stop deadline aligned with the container policy', () => {
    const script = getBalanceRolloutHostScript();

    expect(script.match(/docker stop -t 10/g)).toHaveLength(2);
    expect(script).not.toContain('docker stop -t 15');
    expect(script).toContain('--stop-timeout 10');
  });
});
