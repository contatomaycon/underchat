import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import { createHash } from 'node:crypto';

const BALANCE_CONTAINER_NAME = 'under-balance-api';
const BALANCE_ROLLBACK_CONTAINER_NAME = 'under-balance-api-rollback';
const BALANCE_ROLLOUT_SCRIPT_PATH =
  '/usr/local/sbin/underchat-balance-rollout-v1';
const BALANCE_ROLLOUT_UNIT = 'underchat-balance-rollout-v1.service';
const TRUSTED_HOST_PATH =
  '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const BALANCE_HEALTH_VALIDATOR_PYTHON = `
from datetime import datetime, timezone
import json
import re
import sys

MAX_SUCCESS_AGE_SECONDS = 15 * 60
EXPECTED_ALIASES = (
    "under-worker-baileys:latest",
    "under-worker-wwebjs:latest",
    "under-worker-whatsmeow:latest",
)

def require_recent_timestamp(value):
    if not isinstance(value, str) or not value:
        raise ValueError
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    observed = datetime.fromisoformat(normalized)
    if observed.tzinfo is None:
        raise ValueError
    age_seconds = (datetime.now(timezone.utc) - observed).total_seconds()
    if age_seconds < -60 or age_seconds > MAX_SUCCESS_AGE_SECONDS:
        raise ValueError

try:
    document = json.load(sys.stdin)
    worker_images = document["data"]["worker_images"]
    aliases = worker_images["aliases"]
    if worker_images.get("is_running") is not True:
        raise ValueError
    require_recent_timestamp(worker_images.get("last_success_at"))
    for alias in EXPECTED_ALIASES:
        status = aliases[alias]
        if status.get("error_code") is not None:
            raise ValueError
        require_recent_timestamp(status.get("last_success_at"))
        if re.fullmatch(r"sha256:[a-f0-9]{64}", status.get("content_id", "")) is None:
            raise ValueError
except Exception:
    sys.exit(1)
`;
const BALANCE_HEALTH_VALIDATOR_BASE64 = Buffer.from(
  BALANCE_HEALTH_VALIDATOR_PYTHON,
  'utf8'
).toString('base64');

interface IBalanceImageProbeCommandInput {
  imageReference: string;
  serverId: string;
  webPort: number;
}

interface IReconcileBalanceContainerCommandInput extends IBalanceImageProbeCommandInput {
  readinessTimeoutMs: number;
  retryCooldownMs: number;
  stabilityWindowMs: number;
}

function assertImmutableImageReference(imageReference: string): void {
  if (!/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/u.test(imageReference)) {
    throw new InvalidConfigurationError(
      'Balance rollout requires an immutable sha256 image reference.'
    );
  }
}

function assertWebPort(webPort: number): void {
  if (!Number.isSafeInteger(webPort) || webPort < 1 || webPort > 65_535) {
    throw new InvalidConfigurationError(
      'Balance rollout web port must be an integer between 1 and 65535.'
    );
  }
}

function assertDuration(name: string, durationMs: number): void {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    throw new InvalidConfigurationError(`${name} must be a positive integer.`);
  }
}

function assertServerId(serverId: string): void {
  if (!/^[a-f0-9-]{20,64}$/iu.test(serverId)) {
    throw new InvalidConfigurationError('Invalid Balance rollout server ID.');
  }
}

function durationSeconds(durationMs: number): number {
  return Math.max(1, Math.ceil(durationMs / 1000));
}

/**
 * A read-only probe used by the control plane before choosing the single host
 * that may be mutated in a reconciliation pass.
 */
export function getBalanceImageProbeCommand({
  imageReference,
  serverId,
  webPort,
}: IBalanceImageProbeCommandInput): string {
  assertImmutableImageReference(imageReference);
  assertServerId(serverId);
  assertWebPort(webPort);

  return `bash -lc 'set -u; \
PATH=${TRUSTED_HOST_PATH}; \
export PATH; \
hash -r; \
unset DOCKER_CONTEXT; \
DOCKER_HOST=unix:///var/run/docker.sock; \
export DOCKER_HOST; \
STATE_FILE=/var/lib/underchat/balance-rollout/state.env; \
CURRENT_ID="$(docker ps -aq --no-trunc --filter "name=^/${BALANCE_CONTAINER_NAME}$" | head -n 1)"; \
BACKUP_ID="$(docker ps -aq --no-trunc --filter "name=^/${BALANCE_ROLLBACK_CONTAINER_NAME}$" | head -n 1)"; \
DESIRED_ID="$(docker image inspect --format "{{.Id}}" "${imageReference}" 2>/dev/null || true)"; \
CURRENT_IMAGE_ID=""; \
CURRENT_MATCHES=0; \
HEALTHY=0; \
IDENTITY_OK=0; \
CONFIG_IDENTITY_OK=0; \
HEALTH_BODY=""; \
PHASE=none; \
STATE_TARGET_REF=none; \
if [ -n "$CURRENT_ID" ]; then \
  CURRENT_IMAGE_ID="$(docker inspect --format "{{.Image}}" "$CURRENT_ID" 2>/dev/null || true)"; \
  CURRENT_CONFIGURED_IMAGE="$(docker inspect --format "{{.Config.Image}}" "$CURRENT_ID" 2>/dev/null || true)"; \
  CURRENT_COMPONENT_LABEL="$(docker inspect --format "{{if index .Config.Labels \\\"underchat.component\\\"}}{{index .Config.Labels \\\"underchat.component\\\"}}{{end}}" "$CURRENT_ID" 2>/dev/null || true)"; \
  CURRENT_ROLLOUT_TOKEN="$(docker inspect --format "{{if index .Config.Labels \\\"underchat.balance.rollout-token\\\"}}{{index .Config.Labels \\\"underchat.balance.rollout-token\\\"}}{{end}}" "$CURRENT_ID" 2>/dev/null || true)"; \
  case "$CURRENT_CONFIGURED_IMAGE" in \
    "${BALANCE_CONTAINER_NAME}":*|"${BALANCE_CONTAINER_NAME}"@sha256:*|*/"${BALANCE_CONTAINER_NAME}":*|*/"${BALANCE_CONTAINER_NAME}"@sha256:*) CONFIG_IDENTITY_OK=1 ;; \
    sha256:*) \
      if printf "%s" "$CURRENT_CONFIGURED_IMAGE" | grep -Eq "^sha256:[a-f0-9]{64}$" && \
        [ "$CURRENT_COMPONENT_LABEL" = balance-api ] && [ -n "$CURRENT_ROLLOUT_TOKEN" ]; then CONFIG_IDENTITY_OK=1; fi \
      ;; \
  esac; \
  if [ "$CONFIG_IDENTITY_OK" -eq 1 ] && \
    [ "$(docker inspect --format "{{range .Config.Env}}{{println .}}{{end}}" "$CURRENT_ID" 2>/dev/null | sed -n "s/^SERVER_ID=//p" | tail -n 1)" = "${serverId}" ] && \
    [ "$(docker inspect --format "{{range .Config.Env}}{{println .}}{{end}}" "$CURRENT_ID" 2>/dev/null | sed -n "s/^DOCKER_HOST=//p" | tail -n 1)" = "unix:///var/run/docker.sock" ] && \
    [ "$(docker inspect --format "{{.HostConfig.RestartPolicy.Name}}" "$CURRENT_ID" 2>/dev/null || true)" = always ] && \
    docker inspect --format "{{range .Mounts}}{{printf \\"%s:%s\\\\n\\" .Source .Destination}}{{end}}" "$CURRENT_ID" 2>/dev/null | grep -Fx "/var/run/docker.sock:/var/run/docker.sock" >/dev/null && \
    [ "$(docker inspect --format "{{if index .NetworkSettings.Networks \\"underchat\\"}}underchat{{end}}" "$CURRENT_ID" 2>/dev/null || true)" = underchat ] && \
    { [ "$(docker inspect --format "{{(index (index .HostConfig.PortBindings \\"3003/tcp\\") 0).HostIp}}" "$CURRENT_ID" 2>/dev/null || true)" = "" ] || [ "$(docker inspect --format "{{(index (index .HostConfig.PortBindings \\"3003/tcp\\") 0).HostIp}}" "$CURRENT_ID" 2>/dev/null || true)" = "0.0.0.0" ]; } && \
    [ "$(docker inspect --format "{{(index (index .HostConfig.PortBindings \\"3003/tcp\\") 0).HostPort}}" "$CURRENT_ID" 2>/dev/null || true)" = "${webPort}" ] && \
    { [ "$(docker inspect --format "{{(index (index .HostConfig.PortBindings \\"50051/tcp\\") 0).HostIp}}" "$CURRENT_ID" 2>/dev/null || true)" = "" ] || [ "$(docker inspect --format "{{(index (index .HostConfig.PortBindings \\"50051/tcp\\") 0).HostIp}}" "$CURRENT_ID" 2>/dev/null || true)" = "0.0.0.0" ]; } && \
    [ "$(docker inspect --format "{{(index (index .HostConfig.PortBindings \\"50051/tcp\\") 0).HostPort}}" "$CURRENT_ID" 2>/dev/null || true)" = 50051 ]; then IDENTITY_OK=1; fi; \
fi; \
if [ -n "$DESIRED_ID" ] && [ "$CURRENT_IMAGE_ID" = "$DESIRED_ID" ]; then CURRENT_MATCHES=1; fi; \
if [ -n "$CURRENT_ID" ] && [ "$IDENTITY_OK" -eq 1 ] && \
  docker inspect --format "{{.State.Running}}" "$CURRENT_ID" 2>/dev/null | grep -qx true && \
  docker inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}" "$CURRENT_ID" 2>/dev/null | grep -qx healthy; then \
  HEALTH_BODY="$(curl -fsS --max-time 4 "http://127.0.0.1:${webPort}/v1/health/check" 2>/dev/null || true)"; \
  if printf "%s" "$HEALTH_BODY" | python3 -c "$(printf %s "${BALANCE_HEALTH_VALIDATOR_BASE64}" | base64 -d)" >/dev/null 2>&1 && \
    timeout 3 bash -c "</dev/tcp/127.0.0.1/50051" >/dev/null 2>&1; then HEALTHY=1; fi; \
fi; \
if [ -r "$STATE_FILE" ]; then \
  PHASE="$(sed -n "s/^PHASE=//p" "$STATE_FILE" | head -n 1 | tr -cd "A-Za-z0-9_-")"; \
  STATE_TARGET_REF="$(sed -n "s/^TARGET_REF=//p" "$STATE_FILE" | head -n 1 | tr -cd "A-Za-z0-9._:/@-")"; \
  [ -n "$PHASE" ] || PHASE=invalid; \
  [ -n "$STATE_TARGET_REF" ] || STATE_TARGET_REF=invalid; \
fi; \
STATUS=drift; \
case "$PHASE" in \
  prepared|old_backed_up|candidate_started|candidate_ready_pending_confirmation|rollback_started|finalize_started) STATUS=recovery ;; \
  *) \
    if [ "$CURRENT_MATCHES" -eq 1 ] && [ "$HEALTHY" -eq 1 ] && [ -z "$BACKUP_ID" ]; then STATUS=converged; \
    elif [ "$CURRENT_MATCHES" -eq 1 ]; then STATUS=unhealthy; fi ;; \
esac; \
printf "UNDERCHAT_BALANCE_PROBE_V1 status=%s current_id=%s current_image_id=%s desired_id=%s current_matches=%s healthy=%s backup_id=%s phase=%s state_target_ref=%s\\n" \
  "$STATUS" "\${CURRENT_ID:-none}" "\${CURRENT_IMAGE_ID:-none}" "\${DESIRED_ID:-none}" "$CURRENT_MATCHES" "$HEALTHY" "\${BACKUP_ID:-none}" "$PHASE" "$STATE_TARGET_REF"'`;
}

/**
 * Host-side state machine. It is intentionally self-contained and installed
 * as a root-owned script before execution through a transient systemd unit.
 * The unit survives an SSH/control-plane disconnect; a later pass resumes from
 * the atomic journal and exact container IDs.
 */
export function getBalanceRolloutHostScript(): string {
  return `#!/usr/bin/env bash
set -Eeuo pipefail

PATH=${TRUSTED_HOST_PATH}
export PATH
hash -r
unset DOCKER_CONTEXT
DOCKER_HOST=unix:///var/run/docker.sock
export DOCKER_HOST

DESIRED_REF="\${1:-}"
SERVER_ID="\${2:-}"
WEB_PORT="\${3:-}"
READINESS_TIMEOUT_SECONDS="\${4:-420}"
STABILITY_WINDOW_SECONDS="\${5:-120}"
RETRY_COOLDOWN_SECONDS="\${6:-900}"

STATE_DIR=/var/lib/underchat/balance-rollout
STATE_FILE="$STATE_DIR/state.env"
LOG_FILE=/var/log/underchat/balance-rollout.log
CURRENT_NAME=${BALANCE_CONTAINER_NAME}
BACKUP_NAME=${BALANCE_ROLLBACK_CONTAINER_NAME}
RUNTIME_ENV_FILE=
ENV_JSON_FILE=
DOCKER_CONFIG_DIR=
CAPTURED_ENV_CONTAINER_ID=

mkdir -p "$STATE_DIR" "$(dirname "$LOG_FILE")"
chmod 0700 "$STATE_DIR"
[ ! -L "$STATE_DIR" ] && [ "$(stat -c %u "$STATE_DIR")" = 0 ] ||
  exit 66
touch "$LOG_FILE"
chmod 0600 "$LOG_FILE"
exec >>"$LOG_FILE" 2>&1
# Lock the verified root-owned directory inode itself. /var/lock is commonly
# world-writable and a predictable lock path there could be pre-created as a
# symlink before this root process opens it.
exec 9<"$STATE_DIR"
if ! flock -n 9; then
  printf '%s event=lock_busy\\n' "$(date -u +%FT%TZ)"
  exit 75
fi
# Keep the systemd pipe separate from command-local heredocs. The registry
# credential payload is consumed once, before any candidate operation.
exec 8<&0

# A SIGKILL cannot run traps. The host flock proves no rollout is active, so
# root-owned leftovers from a previous interrupted invocation can be removed
# before fresh secret material is captured.
find "$STATE_DIR" -xdev -maxdepth 1 -type f -user root \
  \\( -name 'runtime-env.*' -o -name 'env-json.*' \\) -delete
find "$STATE_DIR" -xdev -mindepth 2 -maxdepth 2 -type f -user root \
  -path "$STATE_DIR/docker-config.*/config.json" -delete
find "$STATE_DIR" -xdev -mindepth 1 -maxdepth 1 -type d -user root \
  -name 'docker-config.*' -empty -delete

cleanup_runtime_files() {
  if [ -n "$RUNTIME_ENV_FILE" ]; then
    rm -f -- "$RUNTIME_ENV_FILE"
  fi
  if [ -n "$ENV_JSON_FILE" ]; then
    rm -f -- "$ENV_JSON_FILE"
  fi
  if [ -n "$DOCKER_CONFIG_DIR" ]; then
    rm -f -- "$DOCKER_CONFIG_DIR/config.json"
    rmdir -- "$DOCKER_CONFIG_DIR" 2>/dev/null || true
  fi
}
trap cleanup_runtime_files EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP

log() {
  printf '%s %s\\n' "$(date -u +%FT%TZ)" "$*"
}

fail() {
  log "event=failed code=$1"
  exit "\${2:-1}"
}

[[ "$DESIRED_REF" =~ ^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$ ]] ||
  fail invalid_immutable_reference 64
case "$SERVER_ID" in
  *[!A-Fa-f0-9-]*|'') fail invalid_server_id 64 ;;
esac
case "$WEB_PORT" in
  *[!0-9]*|'') fail invalid_web_port 64 ;;
esac
for numeric_value in "$READINESS_TIMEOUT_SECONDS" "$STABILITY_WINDOW_SECONDS" "$RETRY_COOLDOWN_SECONDS"; do
  case "$numeric_value" in *[!0-9]*|'') fail invalid_duration 64 ;; esac
done

PHASE=none
TOKEN=
TARGET_REF=
TARGET_ID=
OLD_ID=
OLD_IMAGE_ID=
NEW_ID=
READY_AT=0
READY_RESTART_COUNT=-1
FAILED_AT=0

load_state() {
  [ -r "$STATE_FILE" ] || return 0
  [ ! -L "$STATE_FILE" ] &&
    [ "$(stat -c %u "$STATE_FILE")" = 0 ] &&
    [ "$(stat -c %a "$STATE_FILE")" = 600 ] ||
    fail invalid_state_file_permissions 70
  # The file is root-owned, mode 0600 and written only by write_state.
  # shellcheck disable=SC1090
  source "$STATE_FILE"
}

write_state() {
  local temporary="$STATE_FILE.tmp.$$"
  umask 077
  {
    printf 'PHASE=%q\\n' "$PHASE"
    printf 'TOKEN=%q\\n' "$TOKEN"
    printf 'TARGET_REF=%q\\n' "$TARGET_REF"
    printf 'TARGET_ID=%q\\n' "$TARGET_ID"
    printf 'OLD_ID=%q\\n' "$OLD_ID"
    printf 'OLD_IMAGE_ID=%q\\n' "$OLD_IMAGE_ID"
    printf 'NEW_ID=%q\\n' "$NEW_ID"
    printf 'READY_AT=%q\\n' "$READY_AT"
    printf 'READY_RESTART_COUNT=%q\\n' "$READY_RESTART_COUNT"
    printf 'FAILED_AT=%q\\n' "$FAILED_AT"
  } >"$temporary"
  chmod 0600 "$temporary"
  mv -f "$temporary" "$STATE_FILE"
}

exact_container_id() {
  docker ps -aq --no-trunc --filter "name=^/$1$" | head -n 1
}

container_name() {
  docker inspect --format '{{.Name}}' "$1" 2>/dev/null || true
}

container_image_id() {
  docker inspect --format '{{.Image}}' "$1" 2>/dev/null || true
}

container_token() {
  docker inspect --format '{{if index .Config.Labels "underchat.balance.rollout-token"}}{{index .Config.Labels "underchat.balance.rollout-token"}}{{end}}' "$1" 2>/dev/null || true
}

assert_exact_name() {
  local container_id="$1"
  local expected_name="$2"
  [ -n "$container_id" ] || return 1
  [ "$(container_name "$container_id")" = "/$expected_name" ]
  [ "$(exact_container_id "$expected_name")" = "$container_id" ]
}

assert_candidate_identity() {
  local container_id="$1"
  assert_exact_name "$container_id" "$CURRENT_NAME" &&
    [ "$(container_token "$container_id")" = "$TOKEN" ] &&
    [ "$(container_image_id "$container_id")" = "$TARGET_ID" ]
}

is_nonterminal_phase() {
  case "$1" in
    prepared|old_backed_up|candidate_started|candidate_ready_pending_confirmation|rollback_started|finalize_started) return 0 ;;
    *) return 1 ;;
  esac
}

is_named_balance_image_reference() {
  case "$1" in
    "$CURRENT_NAME":*|"$CURRENT_NAME"@sha256:*|*/"$CURRENT_NAME":*|*/"$CURRENT_NAME"@sha256:*) return 0 ;;
    *) return 1 ;;
  esac
}

assert_backup_identity() {
  local container_id="$1"
  assert_exact_name "$container_id" "$BACKUP_NAME" &&
    [ "$container_id" = "$OLD_ID" ] &&
    [ "$(container_image_id "$container_id")" = "$OLD_IMAGE_ID" ]
}

assert_existing_balance_runtime_identity() {
  local container_id="$1"
  assert_exact_name "$container_id" "$CURRENT_NAME" || return 1

  local configured_image component_label rollout_token
  configured_image="$(docker inspect --format '{{.Config.Image}}' "$container_id" 2>/dev/null || true)"
  component_label="$(docker inspect --format '{{if index .Config.Labels "underchat.component"}}{{index .Config.Labels "underchat.component"}}{{end}}' "$container_id" 2>/dev/null || true)"
  rollout_token="$(container_token "$container_id")"
  if is_named_balance_image_reference "$configured_image"; then
    :
  elif [[ "$configured_image" =~ ^sha256:[a-f0-9]{64}$ ]] &&
    [ "$component_label" = balance-api ] && [ -n "$rollout_token" ]; then
    :
  else
    return 1
  fi

  [ "$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id" 2>/dev/null |
    sed -n 's/^SERVER_ID=//p' | tail -n 1)" = "$SERVER_ID" ] ||
    return 1
  [ "$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id" 2>/dev/null |
    sed -n 's/^DOCKER_HOST=//p' | tail -n 1)" = unix:///var/run/docker.sock ] ||
    return 1
  docker inspect --format '{{range .Mounts}}{{printf "%s:%s\\n" .Source .Destination}}{{end}}' "$container_id" 2>/dev/null |
    grep -Fx '/var/run/docker.sock:/var/run/docker.sock' >/dev/null ||
    return 1
  [ "$(docker inspect --format '{{if index .NetworkSettings.Networks "underchat"}}underchat{{end}}' "$container_id" 2>/dev/null || true)" = underchat ] ||
    return 1
  local web_host_ip grpc_host_ip
  web_host_ip="$(docker inspect --format '{{(index (index .HostConfig.PortBindings "3003/tcp") 0).HostIp}}' "$container_id" 2>/dev/null || true)"
  grpc_host_ip="$(docker inspect --format '{{(index (index .HostConfig.PortBindings "50051/tcp") 0).HostIp}}' "$container_id" 2>/dev/null || true)"
  case "$web_host_ip" in ''|0.0.0.0) ;; *) return 1 ;; esac
  case "$grpc_host_ip" in ''|0.0.0.0) ;; *) return 1 ;; esac
  [ "$(docker inspect --format '{{(index (index .HostConfig.PortBindings "3003/tcp") 0).HostPort}}' "$container_id" 2>/dev/null || true)" = "$WEB_PORT" ] ||
    return 1
  [ "$(docker inspect --format '{{(index (index .HostConfig.PortBindings "50051/tcp") 0).HostPort}}' "$container_id" 2>/dev/null || true)" = 50051 ] ||
    return 1
}

assert_existing_balance_identity() {
  local container_id="$1"
  assert_existing_balance_runtime_identity "$container_id" &&
    [ "$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$container_id" 2>/dev/null || true)" = always ]
}

assert_journaled_old_current_identity() {
  local container_id="$1"
  local restart_policy
  case "$PHASE" in prepared|rollback_started) ;; *) return 1 ;; esac
  [ -n "$OLD_ID" ] && [ "$container_id" = "$OLD_ID" ] &&
    [ "$(container_image_id "$container_id")" = "$OLD_IMAGE_ID" ] &&
    assert_existing_balance_runtime_identity "$container_id" ||
    return 1
  restart_policy="$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$container_id" 2>/dev/null || true)"
  case "$restart_policy" in always|no) return 0 ;; *) return 1 ;; esac
}

validate_journaled_target_local() {
  local local_target_id
  [[ "$TARGET_ID" =~ ^sha256:[a-f0-9]{64}$ ]] || return 1
  local_target_id="$(docker image inspect --format '{{.Id}}' "$TARGET_ID" 2>/dev/null || true)"
  [ "$local_target_id" = "$TARGET_ID" ]
}

capture_runtime_env() {
  local container_id="$1"
  local expected_name="$2"
  local before_image after_id after_image
  assert_exact_name "$container_id" "$expected_name" || return 1
  before_image="$(container_image_id "$container_id")"
  [ -n "$before_image" ] || return 1

  ENV_JSON_FILE="$(mktemp "$STATE_DIR/env-json.XXXXXX")"
  RUNTIME_ENV_FILE="$(mktemp "$STATE_DIR/runtime-env.XXXXXX")"
  chmod 0600 "$ENV_JSON_FILE" "$RUNTIME_ENV_FILE"
  docker inspect --format '{{json .Config.Env}}' "$container_id" >"$ENV_JSON_FILE" ||
    return 1
  after_id="$(exact_container_id "$expected_name")"
  after_image="$(container_image_id "$container_id")"
  [ "$after_id" = "$container_id" ] && [ "$after_image" = "$before_image" ] ||
    return 1

  if ! python3 - "$ENV_JSON_FILE" "$RUNTIME_ENV_FILE" <<'PY'
import json
import re
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as source:
        values = json.load(source)
    if not isinstance(values, list):
        raise ValueError
    with open(sys.argv[2], "w", encoding="utf-8", newline="") as target:
        for entry in values:
            if not isinstance(entry, str) or "\\n" in entry or "\\r" in entry:
                raise ValueError
            key, separator, value = entry.partition("=")
            if separator != "=" or re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key) is None:
                raise ValueError
            target.write(f"{key}={value}")
            target.write("\\n")
except Exception:
    sys.exit(1)
PY
  then
    return 1
  fi
  chmod 0600 "$RUNTIME_ENV_FILE"
  grep -Fx "SERVER_ID=$SERVER_ID" "$RUNTIME_ENV_FILE" >/dev/null ||
    return 1
  CAPTURED_ENV_CONTAINER_ID="$container_id"
}

prepare_runtime_env() {
  local current_id backup_id
  current_id="$(exact_container_id "$CURRENT_NAME")"
  backup_id="$(exact_container_id "$BACKUP_NAME")"
  if [ -n "$current_id" ]; then
    if [ -n "$NEW_ID" ] && [ "$current_id" = "$NEW_ID" ]; then
      assert_candidate_identity "$current_id" ||
        fail runtime_env_candidate_identity_mismatch 70
    elif [ "$current_id" = "$OLD_ID" ] &&
      { [ "$PHASE" = prepared ] || [ "$PHASE" = rollback_started ]; }; then
      assert_journaled_old_current_identity "$current_id" ||
        fail runtime_env_journaled_old_identity_mismatch 70
    else
      assert_existing_balance_identity "$current_id" ||
        fail runtime_env_current_identity_mismatch 70
    fi
    capture_runtime_env "$current_id" "$CURRENT_NAME" ||
      fail runtime_env_capture_failed 66
    return 0
  fi
  if [ -n "$backup_id" ]; then
    assert_backup_identity "$backup_id" ||
      fail runtime_env_backup_identity_mismatch 70
    capture_runtime_env "$backup_id" "$BACKUP_NAME" ||
      fail runtime_env_capture_failed 66
    return 0
  fi
  fail runtime_env_source_missing 66
}

apply_runtime_environment_overrides() {
  [ -n "$RUNTIME_ENV_FILE" ] || fail runtime_env_missing_before_credentials 66
  if ! python3 - "$RUNTIME_ENV_FILE" /dev/fd/8 <<'PY'
import json
import os
import re
import stat
import sys

TARGET_KEYS = (
    "HARBOR_REGISTRY",
    "HARBOR_NAMESPACE",
    "HARBOR_USERNAME",
    "HARBOR_PASSWORD",
)
MAX_PAYLOAD_BYTES = 32 * 1024
temporary = f"{sys.argv[1]}.credentials.{os.getpid()}"

try:
    with open(sys.argv[2], "rb", buffering=0) as source:
        payload = source.read(MAX_PAYLOAD_BYTES + 1)
    if not payload or len(payload) > MAX_PAYLOAD_BYTES:
        raise ValueError
    document = json.loads(payload.decode("utf-8"))
    if not isinstance(document, dict) or set(document) != set(TARGET_KEYS):
        raise ValueError

    for key in TARGET_KEYS:
        value = document[key]
        if (
            not isinstance(value, str)
            or not value
            or any(character in value for character in ("\\0", "\\n", "\\r"))
            or len(value.encode("utf-8")) > 16 * 1024
        ):
            raise ValueError

    metadata = os.lstat(sys.argv[1])
    if (
        not stat.S_ISREG(metadata.st_mode)
        or metadata.st_uid != os.geteuid()
        or stat.S_IMODE(metadata.st_mode) != 0o600
        or metadata.st_nlink != 1
    ):
        raise ValueError

    retained = []
    with open(sys.argv[1], encoding="utf-8", newline="") as source:
        for raw_line in source:
            if not raw_line.endswith("\\n"):
                raise ValueError
            entry = raw_line.removesuffix("\\n")
            key, separator, _value = entry.partition("=")
            if separator != "=" or re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key) is None:
                raise ValueError
            if key not in TARGET_KEYS:
                retained.append(entry)

    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(temporary, flags, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as target:
        for entry in retained:
            target.write(entry)
            target.write("\\n")
        for key in TARGET_KEYS:
            target.write(f"{key}={document[key]}\\n")
        target.flush()
        os.fsync(target.fileno())
    os.replace(temporary, sys.argv[1])
except Exception:
    try:
        os.unlink(temporary)
    except FileNotFoundError:
        pass
    sys.exit(1)
PY
  then
    fail runtime_environment_overrides_invalid 66
  fi
  exec 8<&-
  chmod 0600 "$RUNTIME_ENV_FILE"
  [ ! -L "$RUNTIME_ENV_FILE" ] &&
    [ "$(stat -c %u "$RUNTIME_ENV_FILE")" = 0 ] &&
    [ "$(stat -c %a "$RUNTIME_ENV_FILE")" = 600 ] ||
    fail registry_runtime_env_permissions_invalid 70
  for credential_key in HARBOR_REGISTRY HARBOR_NAMESPACE HARBOR_USERNAME HARBOR_PASSWORD; do
    [ "$(grep -c "^$credential_key=" "$RUNTIME_ENV_FILE")" -eq 1 ] ||
      fail runtime_environment_overrides_apply_failed 66
  done
}

prepare_registry_auth() {
  local registry namespace
  # Docker/Node resolve duplicate environment keys with the last value. Mirror
  # that behavior so registry authorization cannot validate a stale first
  # occurrence while the candidate observes another effective registry.
  registry="$(sed -n 's/^HARBOR_REGISTRY=//p' "$RUNTIME_ENV_FILE" | tail -n 1)"
  [ -n "$registry" ] || fail registry_credentials_missing 66
  registry="\${registry#http://}"
  registry="\${registry#https://}"
  registry="\${registry%/}"
  case "$DESIRED_REF" in "$registry"/*) ;; *) fail registry_reference_mismatch 66 ;; esac
  namespace="$(sed -n 's/^HARBOR_NAMESPACE=//p' "$RUNTIME_ENV_FILE" | tail -n 1)"
  [ -n "$namespace" ] || fail registry_namespace_missing 66
  case "$DESIRED_REF" in
    "$registry/$namespace/"*) ;;
    *) fail registry_namespace_reference_mismatch 66 ;;
  esac

  DOCKER_CONFIG_DIR="$(mktemp -d "$STATE_DIR/docker-config.XXXXXX")"
  chmod 0700 "$DOCKER_CONFIG_DIR"
  if ! python3 - "$RUNTIME_ENV_FILE" "$DOCKER_CONFIG_DIR/config.json" "$registry" <<'PY'
import base64
import json
import os
import sys

try:
    values = {}
    with open(sys.argv[1], encoding="utf-8") as source:
        for raw_line in source:
            line = raw_line.removesuffix("\\n")
            key, separator, value = line.partition("=")
            if separator == "=":
                values[key] = value
    username = values.get("HARBOR_USERNAME", "")
    password = values.get("HARBOR_PASSWORD", "")
    if not username or not password:
        raise ValueError
    encoded = base64.b64encode(f"{username}:{password}".encode()).decode("ascii")
    descriptor = os.open(sys.argv[2], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as target:
        json.dump({"auths": {sys.argv[3]: {"auth": encoded}}}, target)
except Exception:
    sys.exit(1)
PY
  then
    fail registry_auth_config_failed 69
  fi
}

basic_http_ready() {
  curl -fsS --max-time 4 "http://127.0.0.1:$WEB_PORT/v1/health/check" >/dev/null 2>&1
}

target_runtime_ready() {
  local container_id="$1"
  [ -n "$container_id" ] &&
    assert_existing_balance_identity "$container_id" &&
    [ "$(container_image_id "$container_id")" = "$TARGET_ID" ] &&
    [ "$(docker inspect --format '{{.State.Running}}' "$container_id" 2>/dev/null || true)" = true ] ||
    return 1
  [ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id" 2>/dev/null || true)" = healthy ] ||
    return 1
  local response
  response="$(curl -fsS --max-time 4 "http://127.0.0.1:$WEB_PORT/v1/health/check" 2>/dev/null)" ||
    return 1
  printf '%s' "$response" |
    python3 -c "$(printf '%s' '${BALANCE_HEALTH_VALIDATOR_BASE64}' | base64 -d)" >/dev/null 2>&1 ||
    return 1
  timeout 3 bash -c '</dev/tcp/127.0.0.1/50051' >/dev/null 2>&1 ||
    return 1
}

candidate_ready_once() {
  [ -n "$NEW_ID" ] &&
    assert_candidate_identity "$NEW_ID" &&
    target_runtime_ready "$NEW_ID"
}

confirm_candidate_ready() {
  local expected_restart
  expected_restart="$(docker inspect --format '{{.RestartCount}}' "$NEW_ID" 2>/dev/null || echo -1)"
  local attempt
  for attempt in 1 2 3; do
    candidate_ready_once || return 1
    [ "$(docker inspect --format '{{.RestartCount}}' "$NEW_ID" 2>/dev/null || echo -2)" = "$expected_restart" ] ||
      return 1
    [ "$attempt" -eq 3 ] || sleep 5
  done
}

wait_candidate_ready() {
  local deadline=$(( $(date +%s) + READINESS_TIMEOUT_SECONDS ))
  local consecutive=0
  local observed_restart=-1
  while [ "$(date +%s)" -le "$deadline" ]; do
    if candidate_ready_once; then
      local current_restart
      current_restart="$(docker inspect --format '{{.RestartCount}}' "$NEW_ID" 2>/dev/null || echo -1)"
      if [ "$observed_restart" = "$current_restart" ]; then
        consecutive=$((consecutive + 1))
      else
        observed_restart="$current_restart"
        consecutive=1
      fi
      if [ "$consecutive" -ge 3 ]; then
        READY_AT="$(date +%s)"
        READY_RESTART_COUNT="$current_restart"
        return 0
      fi
    else
      consecutive=0
      observed_restart=-1
    fi
    sleep 5
  done
  return 1
}

wait_rollback_ready() {
  local deadline=$(( $(date +%s) + 120 ))
  local consecutive=0
  while [ "$(date +%s)" -le "$deadline" ]; do
    if [ -n "$OLD_ID" ] &&
      assert_exact_name "$OLD_ID" "$CURRENT_NAME" &&
      [ "$(docker inspect --format '{{.State.Running}}' "$OLD_ID" 2>/dev/null || true)" = true ] &&
      basic_http_ready; then
      consecutive=$((consecutive + 1))
      [ "$consecutive" -ge 3 ] && return 0
    else
      consecutive=0
    fi
    sleep 5
  done
  return 1
}

validate_reserved_ports() {
  local expected_current_id="$1"
  local port_container_id
  while IFS= read -r port_container_id; do
    [ -n "$port_container_id" ] || continue
    if [ -z "$expected_current_id" ] || [ "$port_container_id" != "$expected_current_id" ]; then
      fail foreign_reserved_port_owner 65
    fi
  done < <({
    docker ps -q --no-trunc --filter "publish=$WEB_PORT"
    docker ps -q --no-trunc --filter "publish=50051"
  } | sort -u)
}

remove_candidate_exact() {
  local candidate_id
  candidate_id="$(exact_container_id "$CURRENT_NAME")"
  [ -n "$candidate_id" ] || return 0
  if ! assert_candidate_identity "$candidate_id"; then
    fail candidate_identity_mismatch 70
  fi
  docker update --restart=no "$candidate_id" >/dev/null
  docker rm -f "$candidate_id" >/dev/null
}

restore_backup_exact() {
  local backup_id
  backup_id="$(exact_container_id "$BACKUP_NAME")"
  if [ -z "$backup_id" ] || ! assert_backup_identity "$backup_id"; then
    fail rollback_identity_mismatch 70
  fi
  if [ -n "$(exact_container_id "$CURRENT_NAME")" ]; then
    fail rollback_current_name_occupied 70
  fi
  docker rename "$backup_id" "$CURRENT_NAME"
  docker update --restart=always "$backup_id" >/dev/null
  docker start "$backup_id" >/dev/null
}

rollback_exact() {
  PHASE=rollback_started
  FAILED_AT="$(date +%s)"
  write_state

  # A candidate that became fully ready during recovery wins. This avoids
  # discarding a valid generation only because the control connection died.
  if confirm_candidate_ready; then
    PHASE=candidate_ready_pending_confirmation
    READY_AT="$(date +%s)"
    READY_RESTART_COUNT="$(docker inspect --format '{{.RestartCount}}' "$NEW_ID")"
    write_state
    log "event=candidate_recovered token=$TOKEN"
    return 0
  fi

  remove_candidate_exact
  if [ -n "$OLD_ID" ]; then
    restore_backup_exact
    if ! wait_rollback_ready; then
      fail rollback_health_failed 71
    fi
  fi
  PHASE=rolled_back
  FAILED_AT="$(date +%s)"
  NEW_ID=
  write_state
  log "event=rolled_back token=$TOKEN old_id=$OLD_ID"
  return 1
}

mark_local_rollback_complete() {
  PHASE=rolled_back
  FAILED_AT="$(date +%s)"
  NEW_ID=
  write_state
}

rollback_after_local_target_loss() {
  local current_id backup_id
  current_id="$(exact_container_id "$CURRENT_NAME")"
  backup_id="$(exact_container_id "$BACKUP_NAME")"
  PHASE=rollback_started
  FAILED_AT="$(date +%s)"
  write_state

  if [ -n "$OLD_ID" ] && [ "$current_id" = "$OLD_ID" ]; then
    [ -z "$backup_id" ] || fail local_target_loss_duplicate_backup 70
    assert_journaled_old_current_identity "$OLD_ID" ||
      fail local_target_loss_old_identity_mismatch 70
    docker update --restart=always "$OLD_ID" >/dev/null
    if [ "$(docker inspect --format '{{.State.Running}}' "$OLD_ID" 2>/dev/null || true)" != true ]; then
      docker start "$OLD_ID" >/dev/null
    fi
    wait_rollback_ready || fail rollback_health_failed 71
    mark_local_rollback_complete
    log "event=local_target_loss_old_preserved token=$TOKEN old_id=$OLD_ID"
    return 42
  fi

  if [ -n "$current_id" ]; then
    if [ -z "$NEW_ID" ] &&
      [ "$(container_token "$current_id")" = "$TOKEN" ] &&
      [ "$(container_image_id "$current_id")" = "$TARGET_ID" ]; then
      NEW_ID="$current_id"
      write_state
    fi
    [ "$current_id" = "$NEW_ID" ] && assert_candidate_identity "$NEW_ID" ||
      fail local_target_loss_candidate_identity_mismatch 70
  fi

  if [ -n "$OLD_ID" ]; then
    [ "$backup_id" = "$OLD_ID" ] && assert_backup_identity "$backup_id" ||
      fail local_target_loss_backup_identity_mismatch 70
  else
    [ -z "$backup_id" ] || fail local_target_loss_unexpected_backup 70
  fi

  if [ -n "$current_id" ]; then
    remove_candidate_exact
  fi
  if [ -n "$OLD_ID" ]; then
    restore_backup_exact
    wait_rollback_ready || fail rollback_health_failed 71
  fi
  mark_local_rollback_complete
  log "event=local_target_loss_rolled_back token=$TOKEN old_id=$OLD_ID"
  return 42
}

recover_interrupted_old_before_remote() {
  local current_id backup_id
  current_id="$(exact_container_id "$CURRENT_NAME")"
  backup_id="$(exact_container_id "$BACKUP_NAME")"

  case "$PHASE" in
    prepared)
      [ -n "$OLD_ID" ] || return 0
      if [ "$current_id" = "$OLD_ID" ]; then
        [ -z "$backup_id" ] || fail prepared_duplicate_backup 70
        assert_journaled_old_current_identity "$OLD_ID" ||
          fail prepared_current_identity_mismatch 70
        docker update --restart=always "$OLD_ID" >/dev/null
        if [ "$(docker inspect --format '{{.State.Running}}' "$OLD_ID" 2>/dev/null || true)" != true ]; then
          docker start "$OLD_ID" >/dev/null
        fi
        wait_rollback_ready || fail prepared_old_health_failed 71
        log "event=prepared_old_restored_before_remote token=$TOKEN old_id=$OLD_ID"
        return 0
      fi
      if [ -z "$current_id" ] && [ "$backup_id" = "$OLD_ID" ]; then
        assert_backup_identity "$backup_id" ||
          fail prepared_backup_identity_mismatch 70
        restore_backup_exact
        wait_rollback_ready || fail prepared_old_health_failed 71
        log "event=prepared_backup_restored_before_remote token=$TOKEN old_id=$OLD_ID"
        return 0
      fi
      if [ -n "$current_id" ] &&
        [ "$(container_token "$current_id")" = "$TOKEN" ] &&
        [ "$(container_image_id "$current_id")" = "$TARGET_ID" ]; then
        return 0
      fi
      fail prepared_runtime_missing 70
      ;;
    rollback_started)
      if [ -n "$OLD_ID" ] && [ "$current_id" = "$OLD_ID" ]; then
        [ -z "$backup_id" ] || fail rollback_duplicate_backup 70
        assert_journaled_old_current_identity "$OLD_ID" ||
          fail restored_rollback_identity_mismatch 70
        docker update --restart=always "$OLD_ID" >/dev/null
        if [ "$(docker inspect --format '{{.State.Running}}' "$OLD_ID" 2>/dev/null || true)" != true ]; then
          docker start "$OLD_ID" >/dev/null
        fi
        wait_rollback_ready || fail rollback_health_failed 71
        mark_local_rollback_complete
        log "event=rollback_restored_before_remote token=$TOKEN old_id=$OLD_ID"
        exit 42
      fi
      if [ -z "$current_id" ]; then
        if [ -n "$OLD_ID" ]; then
          [ "$backup_id" = "$OLD_ID" ] || fail rollback_identity_mismatch 70
          assert_backup_identity "$backup_id" || fail rollback_identity_mismatch 70
          restore_backup_exact
          wait_rollback_ready || fail rollback_health_failed 71
        else
          [ -z "$backup_id" ] || fail rollback_unexpected_backup 70
        fi
        mark_local_rollback_complete
        log "event=rollback_completed_before_remote token=$TOKEN old_id=$OLD_ID"
        exit 42
      fi
      ;;
  esac
}

recover_rollback_candidate_locally() {
  local current_id backup_id
  current_id="$(exact_container_id "$CURRENT_NAME")"
  backup_id="$(exact_container_id "$BACKUP_NAME")"
  [ -n "$current_id" ] || fail rollback_candidate_missing 70
  if [ -z "$NEW_ID" ] &&
    [ "$(container_token "$current_id")" = "$TOKEN" ] &&
    [ "$(container_image_id "$current_id")" = "$TARGET_ID" ]; then
    NEW_ID="$current_id"
    write_state
  fi
  [ "$current_id" = "$NEW_ID" ] && assert_candidate_identity "$NEW_ID" ||
    fail rollback_candidate_identity_mismatch 70

  if confirm_candidate_ready; then
    PHASE=candidate_ready_pending_confirmation
    READY_AT="$(date +%s)"
    READY_RESTART_COUNT="$(docker inspect --format '{{.RestartCount}}' "$NEW_ID")"
    write_state
    log "event=candidate_recovered_before_remote token=$TOKEN"
    return 0
  fi

  if [ -n "$OLD_ID" ]; then
    [ "$backup_id" = "$OLD_ID" ] && assert_backup_identity "$backup_id" ||
      fail rollback_identity_mismatch 70
  else
    [ -z "$backup_id" ] || fail rollback_unexpected_backup 70
  fi
  remove_candidate_exact
  if [ -n "$OLD_ID" ]; then
    restore_backup_exact
    wait_rollback_ready || fail rollback_health_failed 71
  fi
  mark_local_rollback_complete
  log "event=rollback_recovered_before_remote token=$TOKEN"
  return 42
}

complete_started_finalization() {
  local backup_id current_id
  [[ "$TARGET_ID" =~ ^sha256:[a-f0-9]{64}$ ]] ||
    fail finalize_target_content_id_invalid 70
  current_id="$(exact_container_id "$CURRENT_NAME")"
  [ -n "$NEW_ID" ] && [ "$current_id" = "$NEW_ID" ] &&
    assert_candidate_identity "$NEW_ID" &&
    assert_existing_balance_identity "$NEW_ID" ||
    fail finalize_candidate_identity_mismatch 70

  if ! docker tag "$TARGET_ID" ${BALANCE_CONTAINER_NAME}:latest; then
    fail finalize_tag_failed 69
  fi

  backup_id="$(exact_container_id "$BACKUP_NAME")"
  if [ -n "$backup_id" ]; then
    if ! assert_backup_identity "$backup_id"; then
      fail finalize_backup_identity_mismatch 70
    fi
    if [ "$(docker inspect --format '{{.State.Running}}' "$backup_id" 2>/dev/null || true)" = true ]; then
      fail finalize_backup_unexpectedly_running 70
    fi
    docker rm "$backup_id" >/dev/null
  fi
  PHASE=complete
  write_state
  log "event=completed token=$TOKEN target_id=$TARGET_ID"
}

finalize_candidate() {
  [ -n "$NEW_ID" ] && assert_candidate_identity "$NEW_ID" &&
    target_runtime_ready "$NEW_ID" ||
    fail finalize_candidate_not_ready 71
  PHASE=finalize_started
  write_state
  complete_started_finalization
}

start_candidate_exact() {
  [ -r "$RUNTIME_ENV_FILE" ] || fail runtime_env_missing_before_start 66
  [ -z "$(exact_container_id "$CURRENT_NAME")" ] ||
    fail candidate_name_occupied 70
  if [ -n "$OLD_ID" ]; then
    local backup_id
    backup_id="$(exact_container_id "$BACKUP_NAME")"
    if [ -z "$backup_id" ] || ! assert_backup_identity "$backup_id"; then
      fail candidate_rollback_missing 70
    fi
  fi

  if ! NEW_ID="$(docker run -d --name "$CURRENT_NAME" \
    --restart always \
    --stop-timeout 10 \
    --label underchat.component=balance-api \
    --label "underchat.balance.rollout-token=$TOKEN" \
    --label "underchat.balance.target-content=$TARGET_ID" \
    -p "$WEB_PORT:3003" \
    -p 50051:50051 \
    -v /var/run/docker.sock:/var/run/docker.sock \
    --env-file "$RUNTIME_ENV_FILE" \
    --network underchat \
    -e DOCKER_HOST=unix:///var/run/docker.sock \
    -e "SERVER_ID=$SERVER_ID" \
    "$TARGET_ID")"; then
    NEW_ID=
    write_state
    rollback_exact
    return $?
  fi
  [[ "$NEW_ID" =~ ^[a-f0-9]{64}$ ]] ||
    fail invalid_candidate_container_id 70
  assert_candidate_identity "$NEW_ID" || fail candidate_identity_mismatch 70
  PHASE=candidate_started
  write_state

  if ! wait_candidate_ready; then
    rollback_exact
    return $?
  fi
  PHASE=candidate_ready_pending_confirmation
  write_state
  log "event=candidate_ready token=$TOKEN new_id=$NEW_ID"
}

handle_pending_candidate() {
  local current_id
  current_id="$(exact_container_id "$CURRENT_NAME")"
  if [ -n "$current_id" ] && [ -z "$NEW_ID" ] &&
    [ "$(container_token "$current_id")" = "$TOKEN" ] &&
    [ "$(container_image_id "$current_id")" = "$TARGET_ID" ]; then
    NEW_ID="$current_id"
    write_state
  fi

  if [ -z "$NEW_ID" ] || ! assert_candidate_identity "$NEW_ID"; then
    if [ -n "$(exact_container_id "$BACKUP_NAME")" ]; then
      PHASE=rollback_started
      write_state
      restore_backup_exact
      PHASE=rolled_back
      FAILED_AT="$(date +%s)"
      write_state
      log "event=recovered_missing_candidate token=$TOKEN"
      return 1
    fi
    fail missing_candidate_and_rollback 70
  fi

  if [ "$PHASE" = candidate_started ] || [ "$PHASE" = old_backed_up ] || [ "$PHASE" = prepared ]; then
    if ! wait_candidate_ready; then
      rollback_exact
      return $?
    fi
    PHASE=candidate_ready_pending_confirmation
    write_state
    log "event=candidate_ready token=$TOKEN new_id=$NEW_ID"
    return 0
  fi

  if ! confirm_candidate_ready; then
    rollback_exact
    return $?
  fi

  local current_restart now
  current_restart="$(docker inspect --format '{{.RestartCount}}' "$NEW_ID" 2>/dev/null || echo -1)"
  now="$(date +%s)"
  if [ "$current_restart" != "$READY_RESTART_COUNT" ] || [ "$READY_AT" -le 0 ]; then
    READY_AT="$now"
    READY_RESTART_COUNT="$current_restart"
    write_state
    log "event=stability_window_reset token=$TOKEN restart_count=$current_restart"
    return 0
  fi
  if [ $((now - READY_AT)) -lt "$STABILITY_WINDOW_SECONDS" ]; then
    log "event=awaiting_stability token=$TOKEN"
    return 0
  fi

  finalize_candidate
}

load_state
LOADED_TARGET_REF="$TARGET_REF"

case "$PHASE" in
  none|complete|rolled_back|prepared|old_backed_up|candidate_started|candidate_ready_pending_confirmation|rollback_started|finalize_started) ;;
  *) fail invalid_rollout_phase 70 ;;
esac

if is_nonterminal_phase "$PHASE"; then
  [ "$TARGET_REF" = "$DESIRED_REF" ] ||
    fail different_rollout_still_pending 75
fi

if [ "$PHASE" = rolled_back ] && [ "$LOADED_TARGET_REF" = "$DESIRED_REF" ] &&
  [ "$FAILED_AT" -gt 0 ] &&
  [ $(( $(date +%s) - FAILED_AT )) -lt "$RETRY_COOLDOWN_SECONDS" ]; then
  log "event=retry_cooldown target_ref=$LOADED_TARGET_REF"
  exit 0
fi

if ! test -S /var/run/docker.sock; then fail docker_socket_missing 66; fi
if ! docker network inspect underchat >/dev/null 2>&1; then fail docker_network_missing 66; fi

if [ "$PHASE" = finalize_started ]; then
  complete_started_finalization
  exit $?
fi

recover_interrupted_old_before_remote
if is_nonterminal_phase "$PHASE" && ! validate_journaled_target_local; then
  log "event=journal_target_missing_locally phase=$PHASE target_id=$TARGET_ID"
  rollback_after_local_target_loss
  exit $?
fi

prepare_runtime_env
apply_runtime_environment_overrides

if is_nonterminal_phase "$PHASE"; then
  case "$PHASE" in
    prepared)
      RECOVERY_CURRENT_ID="$(exact_container_id "$CURRENT_NAME")"
      RECOVERY_BACKUP_ID="$(exact_container_id "$BACKUP_NAME")"
      if [ -n "$RECOVERY_CURRENT_ID" ] &&
        [ "$(container_token "$RECOVERY_CURRENT_ID")" = "$TOKEN" ] &&
        [ "$(container_image_id "$RECOVERY_CURRENT_ID")" = "$TARGET_ID" ]; then
        NEW_ID="$RECOVERY_CURRENT_ID"
        PHASE=candidate_started
        write_state
        handle_pending_candidate
        exit $?
      fi
      if [ -n "$OLD_ID" ] && [ "$RECOVERY_CURRENT_ID" = "$OLD_ID" ]; then
        assert_journaled_old_current_identity "$OLD_ID" ||
          fail prepared_current_identity_mismatch 70
        validate_reserved_ports "$OLD_ID"
        docker update --restart=no "$OLD_ID" >/dev/null
        if ! timeout 25 docker stop -t 10 "$OLD_ID" >/dev/null; then
          docker kill "$OLD_ID" >/dev/null
        fi
        docker rename "$OLD_ID" "$BACKUP_NAME"
        RECOVERY_BACKUP_ID="$OLD_ID"
      elif [ -n "$OLD_ID" ] && [ "$RECOVERY_BACKUP_ID" = "$OLD_ID" ]; then
        assert_backup_identity "$RECOVERY_BACKUP_ID" ||
          fail prepared_backup_identity_mismatch 70
      elif [ -n "$OLD_ID" ]; then
        fail prepared_runtime_missing 70
      elif [ -n "$RECOVERY_CURRENT_ID" ] || [ -n "$RECOVERY_BACKUP_ID" ]; then
        fail prepared_unexpected_runtime 70
      fi
      PHASE=old_backed_up
      write_state
      start_candidate_exact
      exit $?
      ;;
    old_backed_up)
      RECOVERY_CURRENT_ID="$(exact_container_id "$CURRENT_NAME")"
      if [ -n "$RECOVERY_CURRENT_ID" ]; then
        if assert_candidate_identity "$RECOVERY_CURRENT_ID"; then
          NEW_ID="$RECOVERY_CURRENT_ID"
          write_state
          handle_pending_candidate
          exit $?
        fi
        fail old_backed_up_current_identity_mismatch 70
      fi
      start_candidate_exact
      exit $?
      ;;
    candidate_started|candidate_ready_pending_confirmation)
      handle_pending_candidate
      exit $?
      ;;
    rollback_started)
      recover_rollback_candidate_locally
      exit $?
      ;;
  esac
fi

prepare_registry_auth
if ! timeout 300 docker --config "$DOCKER_CONFIG_DIR" pull "$DESIRED_REF"; then
  fail immutable_image_pull_failed 69
fi
RESOLVED_TARGET_ID="$(docker image inspect --format '{{.Id}}' "$DESIRED_REF" 2>/dev/null || true)"
[[ "$RESOLVED_TARGET_ID" =~ ^sha256:[a-f0-9]{64}$ ]] ||
  fail invalid_target_content_id 69
docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$RESOLVED_TARGET_ID" 2>/dev/null |
  grep -Fx "$DESIRED_REF" >/dev/null ||
  fail target_manifest_digest_not_verified 69

TARGET_REF="$DESIRED_REF"
TARGET_ID="$RESOLVED_TARGET_ID"

CURRENT_ID="$(exact_container_id "$CURRENT_NAME")"
BACKUP_ID="$(exact_container_id "$BACKUP_NAME")"
if [ -n "$BACKUP_ID" ]; then
  fail unjournaled_rollback_container 70
fi
if [ "$CURRENT_ID" != "$CAPTURED_ENV_CONTAINER_ID" ]; then
  fail runtime_changed_after_env_capture 70
fi

if [ -n "$CURRENT_ID" ] &&
  target_runtime_ready "$CURRENT_ID"; then
  CURRENT_TOKEN="$(container_token "$CURRENT_ID")"
  if [ -n "$CURRENT_TOKEN" ]; then
    TOKEN="$CURRENT_TOKEN"
    NEW_ID="$CURRENT_ID"
  else
    CURRENT_CONFIGURED_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$CURRENT_ID" 2>/dev/null || true)"
    is_named_balance_image_reference "$CURRENT_CONFIGURED_IMAGE" ||
      fail terminal_legacy_identity_mismatch 70
    TOKEN=
    NEW_ID=
  fi
  OLD_ID=
  OLD_IMAGE_ID=
  READY_AT="$(date +%s)"
  READY_RESTART_COUNT="$(docker inspect --format '{{.RestartCount}}' "$CURRENT_ID" 2>/dev/null || echo -1)"
  if ! docker tag "$TARGET_ID" ${BALANCE_CONTAINER_NAME}:latest; then
    fail already_current_tag_failed 69
  fi
  PHASE=complete
  write_state
  log "event=already_current target_id=$TARGET_ID"
  exit 0
fi

TOKEN="$(cat /proc/sys/kernel/random/uuid)"
OLD_ID="$CURRENT_ID"
OLD_IMAGE_ID=
NEW_ID=
READY_AT=0
READY_RESTART_COUNT=-1
FAILED_AT=0
PHASE=prepared
if [ -n "$OLD_ID" ]; then
  OLD_IMAGE_ID="$(container_image_id "$OLD_ID")"
  assert_existing_balance_identity "$OLD_ID" ||
    fail current_identity_mismatch 70
fi
write_state

validate_reserved_ports "$OLD_ID"
if [ -n "$OLD_ID" ]; then
  docker update --restart=no "$OLD_ID" >/dev/null
	  if ! timeout 25 docker stop -t 10 "$OLD_ID" >/dev/null; then
    docker kill "$OLD_ID" >/dev/null
  fi
  [ "$(docker inspect --format '{{.State.Running}}' "$OLD_ID" 2>/dev/null || true)" = false ] ||
    fail previous_balance_did_not_stop 70
  docker rename "$OLD_ID" "$BACKUP_NAME"
fi
PHASE=old_backed_up
write_state

start_candidate_exact
`;
}

/**
 * Installs the versioned host reconciler atomically and executes it in a
 * bounded transient systemd unit. The remote service keeps running if the SSH
 * stream disappears; the next control-plane pass inspects its journal.
 */
export function getReconcileBalanceContainerCommand({
  imageReference,
  readinessTimeoutMs,
  retryCooldownMs,
  serverId,
  stabilityWindowMs,
  webPort,
}: IReconcileBalanceContainerCommandInput): string {
  assertImmutableImageReference(imageReference);
  assertServerId(serverId);
  assertWebPort(webPort);
  assertDuration('Balance readiness timeout', readinessTimeoutMs);
  assertDuration('Balance stability window', stabilityWindowMs);
  assertDuration('Balance retry cooldown', retryCooldownMs);

  const hostScript = getBalanceRolloutHostScript();
  const encodedScript = Buffer.from(hostScript, 'utf8').toString('base64');
  const scriptDigest = createHash('sha256').update(hostScript).digest('hex');
  const readinessSeconds = durationSeconds(readinessTimeoutMs);
  const stabilitySeconds = durationSeconds(stabilityWindowMs);
  const retryCooldownSeconds = durationSeconds(retryCooldownMs);
  const runtimeMaxSeconds = readinessSeconds + 510;

  return `bash -lc 'set -Eeuo pipefail; \
install -d -m 0700 /var/lib/underchat/balance-rollout; \
TEMP_SCRIPT="${BALANCE_ROLLOUT_SCRIPT_PATH}.tmp.$$"; \
printf "%s" "${encodedScript}" | base64 -d >"$TEMP_SCRIPT"; \
printf "%s  %s\\n" "${scriptDigest}" "$TEMP_SCRIPT" | sha256sum -c - >/dev/null; \
install -o root -g root -m 0755 "$TEMP_SCRIPT" "${BALANCE_ROLLOUT_SCRIPT_PATH}"; \
rm -f "$TEMP_SCRIPT"; \
if systemctl is-active --quiet "${BALANCE_ROLLOUT_UNIT}"; then \
  cat >/dev/null; \
  printf "UNDERCHAT_BALANCE_ROLLOUT_V1 status=in_progress\\n"; \
  exit 0; \
fi; \
systemctl reset-failed "${BALANCE_ROLLOUT_UNIT}" >/dev/null 2>&1 || true; \
systemd-run --quiet --collect --pipe --wait \
  --unit="${BALANCE_ROLLOUT_UNIT}" \
  --property=Type=oneshot \
  --property=KillMode=control-group \
  --property=RuntimeMaxSec=${runtimeMaxSeconds} \
  "${BALANCE_ROLLOUT_SCRIPT_PATH}" \
  "${imageReference}" "${serverId}" "${webPort}" \
  "${readinessSeconds}" "${stabilitySeconds}" "${retryCooldownSeconds}"; \
printf "UNDERCHAT_BALANCE_ROLLOUT_V1 status=completed_or_pending\\n"'`;
}
