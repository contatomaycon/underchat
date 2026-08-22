#!/usr/bin/env bash
set -euo pipefail

session_log_since="${WHATSAPP_SESSION_LOG_SINCE:-5m}"
declare -a session_log_containers=()

while IFS= read -r container_id; do
  [[ -n "$container_id" ]] && session_log_containers+=("$container_id")
done < <(
  {
    docker ps --filter label=underchat.worker_id --quiet
    docker ps --filter name=under-manager --quiet
    if [[ -n "${WHATSAPP_SESSION_LOG_CONTAINERS:-}" ]]; then
      tr ',' '\n' <<<"$WHATSAPP_SESSION_LOG_CONTAINERS"
    fi
  } | awk 'NF && !seen[$0]++'
)

if (( ${#session_log_containers[@]} == 0 )); then
  echo "No running Underchat manager/worker containers were found." >&2
  exit 1
fi

declare -a session_log_pids=()
cleanup_session_log_followers() {
  if (( ${#session_log_pids[@]} > 0 )); then
    kill "${session_log_pids[@]}" 2>/dev/null || true
  fi
}
trap cleanup_session_log_followers EXIT INT TERM

for container_id in "${session_log_containers[@]}"; do
  container_name="$(
    docker inspect --format '{{.Name}}' "$container_id" | sed 's#^/##'
  )"
  docker logs --since "$session_log_since" --follow "$container_id" 2>&1 |
    awk -v container="$container_name" '
      index($0, "[whatsapp-session-debug]") {
        print "[" container "] " $0
        fflush()
      }
    ' &
  session_log_pids+=("$!")
done

wait
