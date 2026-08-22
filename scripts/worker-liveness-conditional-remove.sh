#!/bin/sh

# Compare-and-remove fence for a worker container that was observed unhealthy.
#
# Docker has no native compare-and-delete primitive. This host-side operation
# closes the important restart race by disabling the exact container's restart
# policy before taking the final snapshot. It then either removes that same
# immutable ID, or restores `unless-stopped` (and starts it when needed) before
# returning a non-destructive result.

set -u
umask 077

if [ "$#" -ne 14 ]; then
  printf '%s\n' '{"status":"error","reason":"invalid_argument_count"}'
  exit 0
fi

container_id=$1
expected_started_at=$2
expected_restart_count=$3
expected_health_status=$4
expected_paused=$5
expected_worker_id=$6
expected_account_id=$7
expected_server_id=$8
expected_worker_type_id=$9
expected_runtime_generation=${10}
force_remove=${11}
expected_warm_pool_id=${12}
expected_session_storage=${13}
retired_lifecycle_operation_id=${14}

case "$container_id" in
  *[!0-9a-f]*|'')
    printf '%s\n' '{"status":"error","reason":"invalid_container_id"}'
    exit 0
    ;;
esac
if [ "${#container_id}" -ne 64 ]; then
  printf '%s\n' '{"status":"error","reason":"invalid_container_id"}'
  exit 0
fi
case "$expected_restart_count:$expected_runtime_generation" in
  *[!0-9:]*|:*|*:)
    printf '%s\n' '{"status":"error","reason":"invalid_numeric_fence"}'
    exit 0
    ;;
esac
case "$expected_health_status" in
  unhealthy|healthy|starting|none) ;;
  *)
    printf '%s\n' '{"status":"error","reason":"invalid_health_fence"}'
    exit 0
    ;;
esac
case "$expected_paused" in
  true|false) ;;
  *)
    printf '%s\n' '{"status":"error","reason":"invalid_paused_fence"}'
    exit 0
    ;;
esac
case "$force_remove" in
  true|false) ;;
  *)
    printf '%s\n' '{"status":"error","reason":"invalid_force_policy"}'
    exit 0
    ;;
esac
if [ -n "$retired_lifecycle_operation_id" ]; then
  if [ "$force_remove" != "true" ] ||
    ! printf '%s\n' "$retired_lifecycle_operation_id" |
      grep -Eq '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'; then
    printf '%s\n' '{"status":"error","reason":"invalid_retirement_proof"}'
    exit 0
  fi
fi

current_uid=$(id -u)
state_dir_override=${UNDERCHAT_LIVENESS_STATE_DIR:-}
if [ -z "$state_dir_override" ] && [ "$current_uid" -ne 0 ]; then
  printf '%s\n' '{"status":"error","reason":"root_required"}'
  exit 0
fi

state_dir=${state_dir_override:-/run/lock/underchat-worker-liveness}
case "$state_dir" in
  /*) ;;
  *)
    printf '%s\n' '{"status":"error","reason":"state_directory_unsafe"}'
    exit 0
    ;;
esac
if [ -L "$state_dir" ] ||
  ! mkdir -p "$state_dir" ||
  ! chmod 0700 "$state_dir"; then
  printf '%s\n' '{"status":"error","reason":"state_directory_unavailable"}'
  exit 0
fi
state_dir_owner=$(stat -c '%u' "$state_dir" 2>/dev/null || true)
if [ "$state_dir_owner" != "$current_uid" ]; then
  printf '%s\n' '{"status":"error","reason":"state_directory_unsafe"}'
  exit 0
fi

lock_path="${state_dir}/${container_id}.lock"
inspect_error_path="${state_dir}/${container_id}.$$.inspect"
remove_error_path="${state_dir}/${container_id}.$$.remove"
restart_fenced=0

docker_bounded() {
  timeout --signal=TERM --kill-after=1s 2s docker "$@"
}

is_exact_not_found() {
  error_path=$1
  grep -Eiq "^(Error response from daemon: |Error: )?No such (object|container):? ${container_id}\r?$" "$error_path"
}

restore_restart_policy() {
  restore_attempt=1
  while [ "$restore_attempt" -le 3 ]; do
    if docker_bounded inspect "$container_id" >/dev/null 2>"$inspect_error_path"; then
      if docker_bounded update --restart=unless-stopped "$container_id" >/dev/null 2>"$inspect_error_path"; then
        current_running=$(docker_bounded inspect --format '{{.State.Running}}' "$container_id" 2>"$inspect_error_path") ||
          current_running=
        if [ "$current_running" = "true" ]; then
          return 0
        fi
        if [ "$current_running" = "false" ] &&
          docker_bounded start "$container_id" >/dev/null 2>"$inspect_error_path"; then
          return 0
        fi
      fi
    elif is_exact_not_found "$inspect_error_path"; then
      return 0
    fi

    if [ "$restore_attempt" -lt 3 ]; then
      sleep "$restore_attempt"
    fi
    restore_attempt=$((restore_attempt + 1))
  done
  return 1
}

cleanup() {
  cleanup_status=0
  if [ "$restart_fenced" -eq 1 ]; then
    restore_restart_policy >/dev/null 2>&1 || cleanup_status=$?
  fi
  rm -f "$inspect_error_path" "$remove_error_path"
  return "$cleanup_status"
}

trap cleanup EXIT
trap 'exit 143' HUP INT TERM

exec 9>"$lock_path"
if ! flock -x -w 10 9; then
  printf '%s\n' '{"status":"error","reason":"lock_timeout"}'
  exit 0
fi

# Set the flag before the update so even a partially successful Docker request
# is restored by the trap.
restart_fenced=1
if ! docker_bounded update --restart=no "$container_id" >/dev/null 2>"$inspect_error_path"; then
  if is_exact_not_found "$inspect_error_path"; then
    restart_fenced=0
    printf '%s\n' '{"status":"removed","reason":"already_absent"}'
  else
    printf '%s\n' '{"status":"error","reason":"restart_policy_fence_failed"}'
  fi
  exit 0
fi

snapshot_format='{{.Id}}|{{.Name}}|{{.State.StartedAt}}|{{.RestartCount}}|{{with index .State "Health"}}{{index . "Status"}}{{else}}none{{end}}|{{.State.Paused}}|{{.State.Running}}|{{index .Config.Labels "underchat.worker_id"}}|{{index .Config.Labels "underchat.account_id"}}|{{index .Config.Labels "underchat.server_id"}}|{{index .Config.Labels "underchat.worker_type_id"}}|{{index .Config.Labels "underchat.runtime_generation"}}|{{index .Config.Labels "underchat.warm_pool_id"}}|{{index .Config.Labels "underchat.warm_standby"}}|{{index .Config.Labels "underchat.session_storage"}}'
if ! snapshot=$(docker_bounded inspect --format "$snapshot_format" "$container_id" 2>"$inspect_error_path"); then
  if is_exact_not_found "$inspect_error_path"; then
    restart_fenced=0
    printf '%s\n' '{"status":"removed","reason":"already_absent"}'
  else
    printf '%s\n' '{"status":"error","reason":"inspect_failed"}'
  fi
  exit 0
fi

old_ifs=$IFS
IFS='|'
read -r observed_id observed_name observed_started_at observed_restart_count \
  observed_health_status observed_paused observed_running observed_worker_id \
  observed_account_id observed_server_id observed_worker_type_id \
  observed_runtime_generation observed_warm_pool_id observed_warm_standby \
  observed_session_storage <<EOF
$snapshot
EOF
IFS=$old_ifs

active_identity=false
if [ "$observed_worker_id" = "$expected_worker_id" ] &&
  [ "$observed_account_id" = "$expected_account_id" ] &&
  [ "$observed_runtime_generation" = "$expected_runtime_generation" ]; then
  active_identity=true
fi
postgres_warm_identity=false
if [ "$expected_session_storage" = "postgres" ] &&
  [ -n "$expected_warm_pool_id" ] &&
  [ -z "$observed_worker_id" ] &&
  [ -z "$observed_account_id" ] &&
  [ -z "$observed_runtime_generation" ] &&
  [ "$observed_warm_pool_id" = "$expected_warm_pool_id" ] &&
  [ "$observed_warm_standby" = "true" ] &&
  [ "$observed_session_storage" = "postgres" ]; then
  postgres_warm_identity=true
fi

if [ "$observed_id" != "$container_id" ] ||
  [ "$observed_name" != "/$expected_worker_id" ] ||
  [ "$observed_server_id" != "$expected_server_id" ] ||
  [ "$observed_worker_type_id" != "$expected_worker_type_id" ] ||
  { [ "$active_identity" != "true" ] && [ "$postgres_warm_identity" != "true" ]; }; then
  if restore_restart_policy; then
    restart_fenced=0
    printf '%s\n' '{"status":"stale","reason":"identity_changed"}'
  else
    printf '%s\n' '{"status":"error","reason":"restart_policy_restore_failed"}'
  fi
  exit 0
fi

observation_changed=false
if [ "$observed_started_at" != "$expected_started_at" ] ||
  [ "$observed_restart_count" != "$expected_restart_count" ] ||
  [ "$observed_health_status" != "$expected_health_status" ] ||
  [ "$observed_paused" != "$expected_paused" ]; then
  observation_changed=true
fi

# Only Docker health=healthy proves local liveness recovery. A generic force
# request may bound a runtime that remains `starting`, but it must never turn
# provider, Kafka, or control-plane readiness into permission to remove a
# locally healthy process. The sole exception is an explicit lifecycle
# operation supplied after the manager has durably retired this exact runtime's
# database/session authority. `none` is a legacy/uninstrumented runtime that the
# recreate may safely replace while preserving its session volume.
if [ "$observed_running" = "true" ] &&
  [ "$observed_paused" = "false" ] &&
  [ "$observed_health_status" = "healthy" ] &&
  [ -z "$retired_lifecycle_operation_id" ]; then
  if restore_restart_policy; then
    restart_fenced=0
    if [ "$observation_changed" = "true" ]; then
      printf '{"status":"recovered","reason":"runtime_recovered","observed_restart_count":%s}\n' "$observed_restart_count"
    else
      printf '{"status":"recovered","reason":"health_recovered","observed_restart_count":%s}\n' "$observed_restart_count"
    fi
  else
    printf '%s\n' '{"status":"error","reason":"restart_policy_restore_failed"}'
  fi
  exit 0
fi

if [ "$observed_running" = "true" ] &&
  [ "$observed_paused" = "false" ] &&
  [ "$observed_health_status" = "starting" ] &&
  [ "$force_remove" = "false" ]; then
  if restore_restart_policy; then
    restart_fenced=0
    printf '{"status":"pending","reason":"health_starting","observed_restart_count":%s}\n' "$observed_restart_count"
  else
    printf '%s\n' '{"status":"error","reason":"restart_policy_restore_failed"}'
  fi
  exit 0
fi

# The identity is still exact and the freshly fenced snapshot remains
# unhealthy, paused or exited. StartedAt/RestartCount may have advanced during
# a failed local restart; restart=no makes this fresh snapshot stable enough to
# remove the same immutable ID.
if docker_bounded rm -f "$container_id" >/dev/null 2>"$remove_error_path"; then
  restart_fenced=0
  if [ -n "$retired_lifecycle_operation_id" ]; then
    printf '%s\n' '{"status":"removed","reason":"retired_runtime_fence_matched"}'
  elif [ "$observation_changed" = "true" ]; then
    printf '%s\n' '{"status":"removed","reason":"still_unhealthy_after_restart"}'
  else
    printf '%s\n' '{"status":"removed","reason":"fence_matched"}'
  fi
  exit 0
fi

# Docker can apply rm and lose the response. A confirmed missing exact ID is an
# idempotent success, allowing the lifecycle redrive to create its replacement.
if ! docker_bounded inspect "$container_id" >/dev/null 2>"$inspect_error_path" &&
  is_exact_not_found "$inspect_error_path"; then
  restart_fenced=0
  printf '%s\n' '{"status":"removed","reason":"ambiguous_remove_confirmed_absent"}'
  exit 0
fi

printf '%s\n' '{"status":"error","reason":"remove_failed"}'
exit 0
