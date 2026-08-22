import { Type } from '@sinclair/typebox';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';

const healthResponseDataSchema = Type.Any();

const nullableString = Type.Union([Type.String(), Type.Null()]);
const nullableBoolean = Type.Union([Type.Boolean(), Type.Null()]);
const nullableNumber = Type.Union([Type.Number(), Type.Null()]);
const workerCommandFailureSchema = Type.Object({
  error_name: Type.String(),
  error_code: Type.String(),
  observed_at: Type.Optional(Type.String({ format: 'date-time' })),
});
const workerCommandPlaneComponentSchema = Type.Object({
  name: Type.Union([
    Type.Literal('deferred_relay'),
    Type.Literal('queued_reconciler'),
    Type.Literal('deadline_reconciler'),
    Type.Literal('message_recovery_drainer'),
  ]),
  required: Type.Literal(true),
  leadership: Type.Union([
    Type.Literal('electing'),
    Type.Literal('leader'),
    Type.Literal('standby'),
    Type.Literal('stopped'),
  ]),
  leader: Type.Boolean(),
  election_healthy: Type.Boolean(),
  running: Type.Boolean(),
  ready: Type.Boolean(),
  blocking: Type.Boolean(),
  state: Type.Union([
    Type.Literal('electing'),
    Type.Literal('standby'),
    Type.Literal('starting'),
    Type.Literal('ready'),
    Type.Literal('failed'),
    Type.Literal('stopped'),
  ]),
  last_transition_at: Type.String({ format: 'date-time' }),
  last_error: Type.Union([workerCommandFailureSchema, Type.Null()]),
  failure_count: Type.Integer({ minimum: 0 }),
  nats: Type.Object({
    required: Type.Boolean(),
    state: Type.Union([
      Type.Literal('not_applicable'),
      Type.Literal('standby'),
      Type.Literal('checking'),
      Type.Literal('ready'),
      Type.Literal('failed'),
    ]),
    connected: nullableBoolean,
    contract_valid: nullableBoolean,
    contracts: Type.Array(
      Type.Union([
        Type.Literal('commands'),
        Type.Literal('deferred'),
        Type.Literal('failures'),
        Type.Literal('epoch'),
      ])
    ),
    checked_at: nullableString,
    last_error: Type.Union([workerCommandFailureSchema, Type.Null()]),
  }),
});

const workerCommandTelemetrySchema = Type.Object({
  publish: Type.Object({
    outcomes: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
    by_command_type: Type.Record(
      Type.String(),
      Type.Record(Type.String(), Type.Integer({ minimum: 0 }))
    ),
    public_retry_requests: Type.Integer({ minimum: 0 }),
    technical_retries: Type.Integer({ minimum: 0 }),
    puback_latency_ms: Type.Object({
      count: Type.Integer({ minimum: 0 }),
      sum_ms: Type.Number({ minimum: 0 }),
      max_ms: Type.Number({ minimum: 0 }),
      buckets: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
    }),
  }),
  deferred: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
  gauges: Type.Object({
    admission_identities: nullableNumber,
    deadline_records: nullableNumber,
    sample_errors: Type.Integer({ minimum: 0 }),
    observed_at: nullableString,
  }),
  last_activity_at: nullableString,
});

const sessionStorageMigrationTelemetrySchema = Type.Object({
  transitions: Type.Record(
    Type.String(),
    Type.Record(Type.String(), Type.Integer({ minimum: 0 }))
  ),
  attempts: Type.Record(
    Type.String(),
    Type.Record(Type.String(), Type.Integer({ minimum: 0 }))
  ),
  failures: Type.Record(
    Type.String(),
    Type.Record(Type.String(), Type.Integer({ minimum: 0 }))
  ),
  restorations: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
  cleanup: Type.Record(
    Type.String(),
    Type.Record(Type.String(), Type.Integer({ minimum: 0 }))
  ),
  attempt_duration_ms: Type.Record(
    Type.String(),
    Type.Object({
      count: Type.Integer({ minimum: 0 }),
      sum_ms: Type.Number({ minimum: 0 }),
      max_ms: Type.Number({ minimum: 0 }),
      buckets: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
    })
  ),
  last_activity_at: nullableString,
});

const managerHealthDataSchema = Type.Object({
  ready: Type.Boolean(),
  command_plane: Type.Object({
    schema_version: Type.Literal(1),
    ready: Type.Boolean(),
    role: Type.Union([
      Type.Literal('leader'),
      Type.Literal('standby'),
      Type.Literal('mixed'),
      Type.Literal('electing'),
    ]),
    required_components: Type.Integer({ minimum: 4, maximum: 4 }),
    leader_components: Type.Integer({ minimum: 0, maximum: 4 }),
    standby_components: Type.Integer({ minimum: 0, maximum: 4 }),
    blocking_components: Type.Array(
      Type.Union([
        Type.Literal('deferred_relay'),
        Type.Literal('queued_reconciler'),
        Type.Literal('deadline_reconciler'),
        Type.Literal('message_recovery_drainer'),
      ])
    ),
    observed_at: Type.String({ format: 'date-time' }),
    components: Type.Array(workerCommandPlaneComponentSchema, {
      minItems: 4,
      maxItems: 4,
    }),
  }),
  worker_command_operational_barrier: Type.Object({
    available: Type.Boolean(),
    ready: Type.Boolean(),
    state: Type.Union([
      Type.Literal('active'),
      Type.Literal('paused'),
      Type.Literal('unavailable'),
    ]),
    generation: nullableNumber,
    active_permits: nullableNumber,
    checked_at: Type.String({ format: 'date-time' }),
    last_error: Type.Union([workerCommandFailureSchema, Type.Null()]),
  }),
  worker_command_telemetry: workerCommandTelemetrySchema,
  session_storage_migration_telemetry: sessionStorageMigrationTelemetrySchema,
});

const managerHealthResponseSchema = Type.Object({
  status: Type.Boolean(),
  message: Type.String(),
  data: managerHealthDataSchema,
});

export const healthCheckSchema = {
  description: 'Verifica a saúde da aplicação',
  tags: [ETagSwagger.health],
  produces: ['application/json'],
  response: {
    200: Type.Object(
      {
        status: Type.Boolean(),
        message: Type.String(),
        data: healthResponseDataSchema,
      },
      { description: 'Successful' }
    ),
    503: Type.Object(
      {
        status: Type.Boolean(),
        message: Type.String(),
        data: healthResponseDataSchema,
      },
      { description: 'Service Unavailable' }
    ),
    500: Type.Object(
      {
        status: Type.Boolean(),
        message: Type.String(),
        data: healthResponseDataSchema,
      },
      { description: 'Internal Server Error' }
    ),
  },
};

export const managerHealthCheckSchema = {
  description:
    'Verifica a saude do manager e o readiness local do command plane JetStream',
  tags: [ETagSwagger.health],
  produces: ['application/json'],
  response: {
    200: Type.Composite([managerHealthResponseSchema], {
      description: 'Command plane ready or healthy standby',
    }),
    503: Type.Composite([managerHealthResponseSchema], {
      description: 'Leader component, barrier or dependency unavailable',
    }),
    500: Type.Object(
      {
        status: Type.Boolean(),
        message: Type.String(),
        data: Type.Any(),
      },
      { description: 'Internal Server Error' }
    ),
  },
};
