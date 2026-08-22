#!/bin/sh
set -eu

readonly COMMANDS_STREAM='UC_WORKER_COMMANDS_V1'
readonly FAILURES_STREAM='UC_WORKER_FAILURES_V1'
readonly DEFERRED_STREAM='UC_WORKER_DEFERRED_V1'
readonly EPOCH_BUCKET='UC_WORKER_EPOCH_V1'
readonly COMMANDS_CONFIG='/config/streams/worker-commands.json'
readonly FAILURES_CONFIG='/config/streams/worker-failures.json'
readonly DEFERRED_CONFIG='/config/streams/worker-deferred.json'
readonly EXPECTED_SERVER_COUNT=3
readonly WAIT_ATTEMPTS=90
readonly RUNTIME_EPOCH_DIRECT_GET_PROBE_KEY='worker.__acl_probe'
readonly RUNTIME_EPOCH_DIRECT_GET_PROBE_VALUE='{"schema_version":1,"probe":true}'

log() {
  printf '%s\n' "under-nats-init: $*"
}

wait_for_cluster() {
  attempt=1
  while [ "$attempt" -le "$WAIT_ATTEMPTS" ]; do
    if nats server ping "$EXPECTED_SERVER_COUNT" --user "$NATS_SYSTEM_USER" --password "$NATS_SYSTEM_PASSWORD" >/dev/null 2>&1 \
      && nats server request jetstream --leader 1 --user "$NATS_SYSTEM_USER" --password "$NATS_SYSTEM_PASSWORD" >/dev/null 2>&1 \
      && nats account info >/dev/null 2>&1; then
      log 'three servers and the JetStream metadata leader are ready'
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 2
  done

  log 'cluster quorum or JetStream metadata leader did not become ready'
  return 1
}

validate_stream_config() {
  config_path="$1"
  nats stream add --config "$config_path" --validate >/dev/null
}

ensure_stream() {
  stream_name="$1"
  config_path="$2"

  validate_stream_config "$config_path"
  if nats stream info "$stream_name" --json >/dev/null 2>&1; then
    # Reconcile mutable fields to the complete declarative contract. The edit is
    # non-destructive and fails when an immutable/protected field cannot be made
    # compliant; verify_contract below then proves the effective configuration.
    nats stream edit "$stream_name" --config "$config_path" --force >/dev/null
    log "stream $stream_name already existed; mutable contract reconciled and verified"
    return 0
  fi

  nats stream add --config "$config_path" --defaults >/dev/null
  log "created stream $stream_name"
}

ensure_epoch_bucket() {
  if nats kv info "$EPOCH_BUCKET" >/dev/null 2>&1; then
    nats kv edit "$EPOCH_BUCKET" \
      --description 'Monotonic worker generation fence; no TTL' \
      --history 1 \
      --ttl 0s \
      --replicas 3 \
      --max-value-size 1KiB \
      --max-bucket-size 64MiB \
      --compress >/dev/null
    log "KV bucket $EPOCH_BUCKET already existed; mutable contract reconciled and verified"
    return 0
  fi

  nats kv add "$EPOCH_BUCKET" \
    --description 'Monotonic worker generation fence; no TTL' \
    --history 1 \
    --storage file \
    --ttl 0s \
    --replicas 3 \
    --max-value-size 1KiB \
    --max-bucket-size 64MiB \
    --compress >/dev/null
  log "created KV bucket $EPOCH_BUCKET"
}

verify_contract() {
  commands_json="$(nats stream info "$COMMANDS_STREAM" --json)"
  failures_json="$(nats stream info "$FAILURES_STREAM" --json)"
  deferred_json="$(nats stream info "$DEFERRED_STREAM" --json)"
  kv_json="$(nats stream info "KV_${EPOCH_BUCKET}" --json)"

  printf '%s' "$commands_json" | jq -e '
    .config.name == "UC_WORKER_COMMANDS_V1" and
    .config.subjects == ["uc.worker.command.*"] and
    .config.retention == "workqueue" and
    .config.max_consumers == 2000 and
    .config.max_msgs == 4000000 and
    .config.max_bytes == 8589934592 and
    .config.max_age == 300000000000 and
    .config.max_msgs_per_subject == 10000 and
    .config.max_msg_size == 65536 and
    .config.storage == "file" and
    .config.compression == "s2" and
    .config.num_replicas == 3 and
    .config.discard == "new" and
    .config.duplicate_window == 300000000000 and
    .config.deny_delete == true and
    .config.deny_purge == true and
    .config.discard_new_per_subject == true
  ' >/dev/null

  printf '%s' "$failures_json" | jq -e '
    .config.name == "UC_WORKER_FAILURES_V1" and
    .config.subjects == ["uc.worker.failure.*"] and
    .config.retention == "limits" and
    .config.max_bytes == 1073741824 and
    .config.max_age == 86400000000000 and
    .config.max_msg_size == 65536 and
    .config.storage == "file" and
    .config.compression == "s2" and
    .config.num_replicas == 3 and
    .config.discard == "new" and
    .config.deny_delete == true and
    .config.deny_purge == true
  ' >/dev/null

  printf '%s' "$deferred_json" | jq -e '
    .config.name == "UC_WORKER_DEFERRED_V1" and
    .config.subjects == ["uc.worker.deferred.schedule.>", "uc.worker.deferred.ready.*"] and
    .config.retention == "workqueue" and
    .config.max_consumers == 8 and
    .config.max_bytes == -1 and
    .config.max_age == 300000000000 and
    .config.max_msg_size == 65536 and
    .config.storage == "file" and
    .config.compression == "s2" and
    .config.num_replicas == 3 and
    .config.discard == "old" and
    .config.duplicate_window == 300000000000 and
    .config.deny_delete == true and
    .config.deny_purge == false and
    .config.allow_rollup_hdrs == true and
    .config.allow_msg_ttl == true and
    .config.allow_msg_schedules == true
  ' >/dev/null

  printf '%s' "$kv_json" | jq -e '
    .config.name == "KV_UC_WORKER_EPOCH_V1" and
    .config.max_msgs_per_subject == 1 and
    .config.max_bytes == 67108864 and
    .config.max_age == 0 and
    .config.max_msg_size == 1024 and
    .config.storage == "file" and
    .config.compression == "s2" and
    .config.num_replicas == 3
  ' >/dev/null

  nats server check jetstream --replicas --replica-seen-critical 10s --replica-lag-critical 0 >/dev/null
  log 'stream, KV and replica contract verified'
}

verify_runtime_epoch_direct_get() {
  if [ -z "${NATS_RUNTIME_USER:-}" ] || [ -z "${NATS_RUNTIME_PASSWORD:-}" ]; then
    log 'runtime credentials are required to verify the epoch KV direct-get ACL'
    return 1
  fi

  # Kvm.Get()/KeyValue.Get() in the TypeScript and Go runtimes uses this
  # optimized JetStream endpoint. A stream/KV healthcheck does not exercise
  # the caller ACL, so probe it explicitly before declaring bootstrap ready.
  nats kv put \
    "$EPOCH_BUCKET" \
    "$RUNTIME_EPOCH_DIRECT_GET_PROBE_KEY" \
    "$RUNTIME_EPOCH_DIRECT_GET_PROBE_VALUE" >/dev/null

  runtime_value="$({
    NATS_USER="$NATS_RUNTIME_USER" \
      NATS_PASSWORD="$NATS_RUNTIME_PASSWORD" \
      nats request \
      --raw \
      --timeout 3s \
      '$JS.API.DIRECT.GET.KV_UC_WORKER_EPOCH_V1.$KV.UC_WORKER_EPOCH_V1.worker.__acl_probe' \
      ''
  } 2>/dev/null || true)"

  # Cleanup is administrative and must happen even when the runtime ACL is
  # incomplete. The fixed probe key is never part of a worker epoch chain.
  nats kv purge --force \
    "$EPOCH_BUCKET" \
    "$RUNTIME_EPOCH_DIRECT_GET_PROBE_KEY" >/dev/null

  if [ "$runtime_value" != "$RUNTIME_EPOCH_DIRECT_GET_PROBE_VALUE" ]; then
    log 'runtime epoch KV direct-get ACL verification failed'
    return 1
  fi

  log 'runtime epoch KV direct-get ACL verified'
}

wait_for_cluster
ensure_stream "$COMMANDS_STREAM" "$COMMANDS_CONFIG"
ensure_stream "$FAILURES_STREAM" "$FAILURES_CONFIG"
ensure_stream "$DEFERRED_STREAM" "$DEFERRED_CONFIG"
ensure_epoch_bucket
verify_contract
verify_runtime_epoch_direct_get
