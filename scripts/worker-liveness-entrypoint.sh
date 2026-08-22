#!/bin/sh
set -eu

if [ "$#" -eq 0 ]; then
  echo 'worker-liveness-entrypoint: missing worker command' >&2
  exit 64
fi

pid_file="${UNDERCHAT_LIVENESS_PID_FILE:-/run/underchat-worker-main.pid}"
pid_file_tmp="${pid_file}.tmp"
pid_dir="$(dirname "${pid_file}")"
main_pid="$$"
start_token="$(awk '{print $22}' "/proc/${main_pid}/stat" 2>/dev/null || true)"
expected_command="$(basename "$1")"

if [ -z "${start_token}" ] || [ -z "${expected_command}" ]; then
  echo 'worker-liveness-entrypoint: unable to capture process identity' >&2
  exit 70
fi

mkdir -p "${pid_dir}"
printf '%s:%s:%s\n' \
  "${main_pid}" \
  "${start_token}" \
  "${expected_command}" >"${pid_file_tmp}"
chmod 0600 "${pid_file_tmp}"
mv -f "${pid_file_tmp}" "${pid_file}"

exec "$@"
