import { Value } from '@sinclair/typebox/value';
import { workerConnectionHealthResponseSchema } from '@core/schema/worker/workerConnectionLogs/response.schema';

const healthResponse = {
  generated_at: '2026-08-16T14:00:00.000Z',
  channel: {
    id: 'worker-1',
    name: 'Canal',
    number: '+5561999999999',
    worker_status: { id: 'status-1', name: 'online' },
    server_name: 'Servidor 1',
    connection_date: '2026-08-16T10:00:00.000Z',
    last_connection_check_at: '2026-08-16T13:59:00.000Z',
    created_at: '2026-08-13T10:00:00.000Z',
    updated_at: '2026-08-16T13:59:00.000Z',
  },
  current_status: {
    status: 'online',
    connected: true,
    authenticated: true,
    session_valid: true,
    recoverable: true,
    qr_available: false,
    changed_at: '2026-08-16T10:00:00.000Z',
    reason: null,
    error_code: null,
    sequence: 10,
    source_id: 'source-1',
    online_acknowledged: true,
    runtime_generation: 2,
  },
  session: {
    state: 'ready',
    generation: 2,
    active_revision_id: '12',
    active_revision_status: 'active',
    active_revision_size_bytes: 4096,
    schema_version: 17,
    last_persisted_at: '2026-08-16T13:55:00.000Z',
    last_error_at: null,
    revision_promoted_at: '2026-08-16T10:00:00.000Z',
    revision_count: 3,
    failed_revision_count: 0,
    protected_record_count: 42,
    artifact_count: 0,
    artifact_size_bytes: 0,
    device_registered: true,
  },
  lease: {
    active: true,
    acquired_at: '2026-08-16T10:00:00.000Z',
    heartbeat_at: '2026-08-16T13:59:50.000Z',
    expires_at: '2026-08-16T14:01:00.000Z',
  },
  metrics: {
    period_hours: 24,
    window_started_at: '2026-08-15T14:00:00.000Z',
    window_ended_at: '2026-08-16T14:00:00.000Z',
    availability_percentage: 99.9,
    observed_seconds: 86400,
    online_seconds: 86314,
    offline_seconds: 86,
    status_changes: 2,
    disconnections: 1,
    reconnections: 1,
    current_uptime_seconds: 14400,
    last_downtime_seconds: 86,
  },
  timeline: [
    {
      started_at: '2026-08-16T13:00:00.000Z',
      availability_percentage: 100,
      observed_seconds: 3600,
      online_seconds: 3600,
      event_count: 1,
    },
  ],
  events: [
    {
      id: '10',
      status: 'online',
      connected: true,
      authenticated: true,
      session_valid: true,
      recoverable: true,
      observed_at: '2026-08-16T13:00:00.000Z',
      reason: null,
      error_code: null,
      code: '200',
      runtime_generation: 2,
    },
  ],
  logs: [],
  logs_has_more: false,
} as const;

describe('Worker connection health response contract', () => {
  it('accepts the secret-free observability shape', () => {
    expect(
      Value.Check(workerConnectionHealthResponseSchema, healthResponse)
    ).toBe(true);
  });

  it('does not expose storage or provider implementation details', () => {
    expect(healthResponse.channel).not.toHaveProperty('provider');
    expect(healthResponse.channel).not.toHaveProperty('provider_name');
    expect(healthResponse.channel).not.toHaveProperty('session_storage');
    expect(healthResponse.lease).not.toHaveProperty('provider');
    expect(healthResponse.events[0]).not.toHaveProperty('provider');
  });
});
