import { Static, Type } from '@sinclair/typebox';

export const sessionStorageMigrationStateSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('capturing'),
  Type.Literal('staged'),
  Type.Literal('cutting_over'),
  Type.Literal('starting'),
  Type.Literal('validating'),
  Type.Literal('retry_wait'),
  Type.Literal('restoring'),
  Type.Literal('recovery_required'),
  Type.Literal('restored'),
  Type.Literal('cleanup_pending'),
  Type.Literal('deleting_volume'),
  Type.Literal('completed'),
]);

export const sessionStorageMigrationEvidenceSchema = Type.Object({
  authenticated: Type.Optional(Type.Boolean()),
  session_ready: Type.Optional(Type.Boolean()),
  can_send: Type.Optional(Type.Boolean()),
  can_receive_runtime: Type.Optional(Type.Boolean()),
  native_connection_valid: Type.Optional(Type.Boolean()),
  kafka_ready: Type.Optional(Type.Boolean()),
  command_ingress_ready: Type.Optional(Type.Boolean()),
  command_ingress_authorized: Type.Optional(Type.Boolean()),
  runtime_generation: Type.Optional(Type.Integer()),
  revision_id: Type.Optional(Type.Integer()),
  phone_matches: Type.Optional(Type.Boolean()),
  identity_matches: Type.Optional(Type.Boolean()),
  volume_absent: Type.Optional(Type.Boolean()),
});

export const sessionStorageMigrationSummarySchema = Type.Object({
  migration_id: Type.String({ format: 'uuid' }),
  state: sessionStorageMigrationStateSchema,
  phase: sessionStorageMigrationStateSchema,
  attempt_count: Type.Integer({ minimum: 0, maximum: 3 }),
  max_attempts: Type.Literal(3),
  created_at: Type.String(),
  updated_at: Type.String(),
  attempt_started_at: Type.Union([Type.String(), Type.Null()]),
  attempt_deadline_at: Type.Union([Type.String(), Type.Null()]),
  next_attempt_at: Type.Union([Type.String(), Type.Null()]),
  source_volume_preserved: Type.Boolean(),
  target_revision_id: Type.Union([Type.Integer(), Type.Null()]),
  target_runtime_generation: Type.Union([Type.Integer(), Type.Null()]),
  target_validated_at: Type.Union([Type.String(), Type.Null()]),
  cleanup_pending: Type.Boolean(),
  restored_at: Type.Union([Type.String(), Type.Null()]),
  volume_deleted_at: Type.Union([Type.String(), Type.Null()]),
  completed_at: Type.Union([Type.String(), Type.Null()]),
  evidence: sessionStorageMigrationEvidenceSchema,
  last_error_code: Type.Union([Type.String(), Type.Null()]),
});

export type SessionStorageMigrationSummary = Static<
  typeof sessionStorageMigrationSummarySchema
>;
