#!/bin/sh

# This probe measures the local HTTP process/event loop and an explicitly
# quarantined, context-ignoring SDK runtime or native Kafka member that cannot
# be safely reused after its disconnect deadline. Ordinary WhatsApp, Kafka,
# Redis, Balance and other external dependency failures remain readiness
# concerns and never make Docker restart a live runtime.

health_url="${UNDERCHAT_LIVENESS_HEALTH_URL:-http://127.0.0.1:3005/v1/health/check}"
failure_file="${UNDERCHAT_LIVENESS_FAILURE_FILE:-/tmp/underchat-worker-liveness-failures}"
pid_file="${UNDERCHAT_LIVENESS_PID_FILE:-/run/underchat-worker-main.pid}"
local_fallback_after=5
startup_fallback_after=10

target_pid=''
expected_start_token=''
expected_command=''
if [ -r "${pid_file}" ]; then
  IFS=':' read -r target_pid expected_start_token expected_command <"${pid_file}" ||
    true
fi

case "${target_pid}" in
  ''|*[!0-9]*) exit 1 ;;
esac
if [ "${target_pid}" -le 1 ] || [ -z "${expected_start_token}" ] ||
  [ -z "${expected_command}" ]; then
  # Without Docker's init process the entrypoint itself is PID1. Linux protects
  # the namespace init from this signal, so fail closed and let the external
  # durable reconciler own recovery.
  exit 1
fi

current_start_token="$(awk '{print $22}' "/proc/${target_pid}/stat" 2>/dev/null || true)"
current_command_path="$(
  tr '\000' '\n' <"/proc/${target_pid}/cmdline" 2>/dev/null |
    sed -n '1p' || true
)"
current_command="$(basename "${current_command_path}" 2>/dev/null || true)"
if [ "${current_start_token}" != "${expected_start_token}" ] ||
  [ "${current_command}" != "${expected_command}" ] ||
  ! kill -0 "${target_pid}" 2>/dev/null; then
  exit 1
fi

runtime_token="${target_pid}-${current_start_token}"
stored_token=''
failures=0
healthy_baseline=0
if [ -r "${failure_file}" ]; then
  IFS=':' read -r stored_token failures healthy_baseline <"${failure_file}" ||
    true
fi

if [ "${stored_token}" != "${runtime_token}" ]; then
  failures=0
  healthy_baseline=0
fi

if curl -fsS \
  --connect-timeout 1 \
  --max-time 2 \
  "${health_url}" >/dev/null; then
  printf '%s:0:1\n' "${runtime_token}" >"${failure_file}.tmp"
  mv -f "${failure_file}.tmp" "${failure_file}"
  exit 0
fi

case "${failures}" in
  ''|*[!0-9]*) failures=0 ;;
esac

if [ "${healthy_baseline}" != '1' ]; then
  # A brand-new process gets a larger startup budget than an established
  # runtime. Ten failed checks leave enough time for Docker to leave its
  # start-period and expose `unhealthy` to the durable reconciler. The local
  # SIGKILL remains a bounded fallback if schedule_api is also unavailable.
  failures=$((failures + 1))
  printf '%s:%s:0\n' "${runtime_token}" "${failures}" >"${failure_file}.tmp"
  mv -f "${failure_file}.tmp" "${failure_file}"
  if [ "${failures}" -ge "${startup_fallback_after}" ]; then
    printf '%s\n' \
      'underchat.worker_liveness.local_fallback reason=local_startup_unresponsive consecutive_failures=10 signal=SIGKILL' \
      >&2
    kill -KILL "${target_pid}" 2>/dev/null || true
  fi
  exit 1
fi

failures=$((failures + 1))
printf '%s:%s:1\n' "${runtime_token}" "${failures}" >"${failure_file}.tmp"
mv -f "${failure_file}.tmp" "${failure_file}"

if [ "${failures}" -ge "${local_fallback_after}" ]; then
  # schedule_api sees Docker unhealthy after three failures and gets two more
  # probe intervals to fence/enqueue the durable recreate. If that path is
  # unavailable, kill the verified worker child. Docker's init process exits
  # with it and `unless-stopped` restarts the same container/volume/generation.
  printf '%s\n' \
    'underchat.worker_liveness.local_fallback reason=local_event_loop_unresponsive consecutive_failures=5 signal=SIGKILL' \
    >&2
  kill -KILL "${target_pid}" 2>/dev/null || true
fi

exit 1
