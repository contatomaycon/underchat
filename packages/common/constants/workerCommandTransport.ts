export const WORKER_COMMAND_SCHEMA_VERSION = 1 as const;

export const WORKER_COMMAND_STREAM = 'UC_WORKER_COMMANDS_V1' as const;
export const WORKER_COMMAND_SUBJECT_PREFIX = 'uc.worker.command' as const;
export const WORKER_COMMAND_SUBJECT_WILDCARD =
  `${WORKER_COMMAND_SUBJECT_PREFIX}.*` as const;

export const WORKER_DEFERRED_STREAM = 'UC_WORKER_DEFERRED_V1' as const;
export const WORKER_DEFERRED_SCHEDULE_SUBJECT_PREFIX =
  'uc.worker.deferred.schedule' as const;
export const WORKER_DEFERRED_SCHEDULE_SUBJECT_WILDCARD =
  `${WORKER_DEFERRED_SCHEDULE_SUBJECT_PREFIX}.>` as const;
export const WORKER_DEFERRED_READY_SUBJECT_PREFIX =
  'uc.worker.deferred.ready' as const;
export const WORKER_DEFERRED_READY_SUBJECT_WILDCARD =
  `${WORKER_DEFERRED_READY_SUBJECT_PREFIX}.*` as const;
export const WORKER_DEFERRED_RELAY_DURABLE =
  'uc_worker_deferred_relay_v1' as const;
export const WORKER_DEFERRED_PARK_DELAY_MS = 1_000;
export const WORKER_DEFERRED_PUBACK_TIMEOUT_MS = 5_000;

export const WORKER_FAILURE_STREAM = 'UC_WORKER_FAILURES_V1' as const;
export const WORKER_FAILURE_SUBJECT_PREFIX = 'uc.worker.failure' as const;
export const WORKER_FAILURE_SUBJECT_WILDCARD =
  `${WORKER_FAILURE_SUBJECT_PREFIX}.*` as const;

export const WORKER_EPOCH_KV_BUCKET = 'UC_WORKER_EPOCH_V1' as const;

export const WORKER_COMMAND_MAX_AGE_MS = 5 * 60 * 1000;
export const WORKER_COMMAND_DUPLICATE_WINDOW_MS = 5 * 60 * 1000;
export const WORKER_COMMAND_PUBLIC_RETRY_WINDOW_MS = 2 * 60 * 1000;
export const WORKER_COMMAND_MAX_BYTES = 64 * 1024;

export const WORKER_COMMAND_PUBACK_TIMEOUT_MS = 5 * 1000;
export const WORKER_COMMAND_RETRY_DELAYS_MS = [
  100, 250, 500, 1000, 2000,
] as const;

export const WORKER_COMMAND_STREAM_LIMITS = Object.freeze({
  maxAgeMs: WORKER_COMMAND_MAX_AGE_MS,
  duplicateWindowMs: WORKER_COMMAND_DUPLICATE_WINDOW_MS,
  maxBytes: 8 * 1024 * 1024 * 1024,
  maxMessages: 4_000_000,
  maxMessagesPerSubject: 10_000,
  replicas: 3,
  retention: 'workqueue' as const,
});

export const WORKER_FAILURE_STREAM_LIMITS = Object.freeze({
  maxAgeMs: 24 * 60 * 60 * 1000,
  maxBytes: 1024 * 1024 * 1024,
  replicas: 3,
});

export const WORKER_COMMAND_TYPES = [
  'direct_send',
  'schedule_send',
  'notification_send',
  'mark_read',
  'worker_config',
  'provider_command',
  'webhook_integration',
] as const;

export const WORKER_COMMAND_ENVELOPE_V1_FIELDS = [
  'schema_version',
  'command_id',
  'operation_id',
  'retry_of',
  'account_id',
  'worker_id',
  'command_type',
  'entity_key',
  'entity_sequence',
  'predecessor_operation_id',
  'origin_epoch',
  'issued_at',
  'deadline_at',
  'payload_version',
  'payload_digest',
  'payload',
  'traceparent',
  'source',
] as const;

export const WORKER_COMMAND_PUBLISH_RECEIPT_V1_FIELDS = [
  'command_id',
  'operation_id',
  'stream',
  'stream_sequence',
  'duplicate',
  'accepted_at',
  'expires_at',
] as const;
