import { Static, Type } from '@sinclair/typebox';

export const workerConnectionLogItemSchema = Type.Object({
  status: Type.Union([Type.String(), Type.Null()]),
  code: Type.Union([Type.String(), Type.Number(), Type.Null()]),
  message: Type.Union([Type.String(), Type.Null()]),
  date: Type.String(),
});

const nullableStringSchema = Type.Union([Type.String(), Type.Null()]);
const nullableNumberSchema = Type.Union([Type.Number(), Type.Null()]);
const nullableBooleanSchema = Type.Union([Type.Boolean(), Type.Null()]);

export const workerConnectionHealthResponseSchema = Type.Object({
  generated_at: Type.String(),
  channel: Type.Object({
    id: Type.String(),
    name: Type.String(),
    number: nullableStringSchema,
    worker_status: Type.Object({
      id: Type.String(),
      name: nullableStringSchema,
    }),
    server_name: nullableStringSchema,
    connection_date: nullableStringSchema,
    last_connection_check_at: nullableStringSchema,
    created_at: nullableStringSchema,
    updated_at: nullableStringSchema,
  }),
  current_status: Type.Union([
    Type.Object({
      status: Type.String(),
      connected: Type.Boolean(),
      authenticated: Type.Boolean(),
      session_valid: nullableBooleanSchema,
      recoverable: Type.Boolean(),
      qr_available: Type.Boolean(),
      changed_at: Type.String(),
      reason: nullableStringSchema,
      error_code: nullableStringSchema,
      sequence: Type.Number(),
      source_id: nullableStringSchema,
      online_acknowledged: Type.Boolean(),
      runtime_generation: nullableNumberSchema,
    }),
    Type.Null(),
  ]),
  session: Type.Object({
    state: Type.String(),
    generation: Type.Number(),
    active_revision_id: nullableStringSchema,
    active_revision_status: nullableStringSchema,
    active_revision_size_bytes: nullableNumberSchema,
    schema_version: nullableNumberSchema,
    last_persisted_at: nullableStringSchema,
    last_error_at: nullableStringSchema,
    revision_promoted_at: nullableStringSchema,
    revision_count: Type.Number(),
    failed_revision_count: Type.Number(),
    protected_record_count: Type.Number(),
    artifact_count: Type.Number(),
    artifact_size_bytes: Type.Number(),
    device_registered: Type.Boolean(),
  }),
  lease: Type.Object({
    active: Type.Boolean(),
    acquired_at: nullableStringSchema,
    heartbeat_at: nullableStringSchema,
    expires_at: nullableStringSchema,
  }),
  metrics: Type.Object({
    period_hours: Type.Number(),
    window_started_at: Type.String(),
    window_ended_at: Type.String(),
    availability_percentage: nullableNumberSchema,
    observed_seconds: Type.Number(),
    online_seconds: Type.Number(),
    offline_seconds: Type.Number(),
    status_changes: Type.Number(),
    disconnections: Type.Number(),
    reconnections: Type.Number(),
    current_uptime_seconds: nullableNumberSchema,
    last_downtime_seconds: nullableNumberSchema,
  }),
  timeline: Type.Array(
    Type.Object({
      started_at: Type.String(),
      availability_percentage: nullableNumberSchema,
      observed_seconds: Type.Number(),
      online_seconds: Type.Number(),
      event_count: Type.Number(),
    })
  ),
  events: Type.Array(
    Type.Object({
      id: Type.String(),
      status: Type.String(),
      connected: Type.Boolean(),
      authenticated: Type.Boolean(),
      session_valid: nullableBooleanSchema,
      recoverable: Type.Boolean(),
      observed_at: Type.String(),
      reason: nullableStringSchema,
      error_code: nullableStringSchema,
      code: Type.Union([Type.String(), Type.Number(), Type.Null()]),
      runtime_generation: Type.Number(),
    })
  ),
  logs: Type.Array(workerConnectionLogItemSchema),
  logs_has_more: Type.Boolean(),
});

export type WorkerConnectionLogItem = Static<
  typeof workerConnectionLogItemSchema
>;

export type WorkerConnectionHealthResponse = Static<
  typeof workerConnectionHealthResponseSchema
>;

/** @deprecated Use WorkerConnectionHealthResponse. */
export type WorkerConnectionLogsResponse = WorkerConnectionHealthResponse;
