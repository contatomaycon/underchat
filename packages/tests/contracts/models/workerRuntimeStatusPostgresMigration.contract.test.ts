import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260801120000.sql'),
  'utf8'
);
const model = readFileSync(
  resolve(
    process.cwd(),
    'packages/models/worker/workerWhatsappSession.model.ts'
  ),
  'utf8'
);

const functionStart = migration.indexOf(
  'CREATE OR REPLACE FUNCTION public.apply_worker_runtime_status('
);
const functionEnd = migration.indexOf(
  'CREATE OR REPLACE FUNCTION public.request_worker_self_heal(',
  functionStart
);
const applyStatusSql = migration.slice(functionStart, functionEnd);

const ONLINE = '019a930d-c6f6-766d-9c84-30af6ecc33b2';
const DISPONIBLE = '019a930d-c6f6-766d-9c84-3904383fe742';
const RECREATING = '019a930d-c6f6-766d-9c84-46093814d8e0';
const CREATING = '019a930d-c6f6-766d-9c84-52e87789979b';

describe('apply_worker_runtime_status PostgreSQL contract', () => {
  it('preserves pre-fence events as sequence zero without accepting half a fence', () => {
    expect(applyStatusSql).toContain(
      'IF (v_connection_epoch_text IS NULL) <> (v_connection_sequence IS NULL) THEN'
    );
    expect(applyStatusSql).toContain(
      'IF v_requires_connection_fence AND v_connection_sequence IS NULL THEN'
    );
    expect(applyStatusSql).toContain(
      'v_runtime."connection_sequence", v_capability_hash, v_event_type'
    );
    expect(applyStatusSql).not.toContain(
      'v_runtime."connection_sequence" <= 0'
    );
    expect(migration).toContain(
      'CHECK ("runtime_generation" > 0 AND "connection_sequence" >= 0)'
    );
  });

  it('requires the exact active fence and all four readiness signals for online', () => {
    expect(applyStatusSql).toContain(
      `v_status_id = '${ONLINE}'::uuid\n    OR lower(COALESCE(p_status->>'requires_connection_fence', 'false')) = 'true'`
    );
    expect(applyStatusSql).toContain(
      'v_runtime."connection_epoch" IS DISTINCT FROM v_connection_epoch_text'
    );
    expect(applyStatusSql).toContain(
      'v_runtime."connection_sequence" IS DISTINCT FROM v_connection_sequence'
    );
    for (const readinessField of [
      'session_ready',
      'can_send',
      'can_receive_runtime',
      'authenticated',
    ]) {
      expect(applyStatusSql).toContain(
        `lower(COALESCE(p_status->>'${readinessField}', 'false')) = 'true'`
      );
    }
  });

  it('allows strong online to advance creating/recreating lifecycle and defers non-online events', () => {
    expect(applyStatusSql).toContain(
      'IF v_mutates_status AND v_lifecycle_operation_id IS NOT NULL THEN'
    );
    expect(applyStatusSql).toContain(
      `IF v_status_id <> '${ONLINE}'::uuid THEN\n      outcome := 'deferred'`
    );
    expect(applyStatusSql).toContain(`'${RECREATING}'::uuid`);
    expect(applyStatusSql).toContain(`'${CREATING}'::uuid`);
    expect(applyStatusSql).toContain(
      `v_current_worker_status_id NOT IN (\n      '${ONLINE}'::uuid,\n      '${RECREATING}'::uuid,\n      '${CREATING}'::uuid`
    );
    expect(applyStatusSql).toContain(
      `ELSIF v_mutates_status\n    AND v_status_id <> '${ONLINE}'::uuid\n    AND v_current_worker_status_id IN (`
    );
  });

  it('defers transient regressions and rejects a stale or nullable runtime identity', () => {
    expect(applyStatusSql).toContain(
      "COALESCE(p_status->>'code', '') IN ('203', '408', '428', '503', '515')"
    );
    expect(applyStatusSql).toContain(
      'v_transient_connection_event OR NOT v_strong_degradation'
    );
    expect(applyStatusSql).toContain(
      'v_runtime."source_provider" IS DISTINCT FROM lower(trim(p_provider))'
    );
    expect(applyStatusSql).toContain(
      'v_runtime."runtime_capability_hash" IS DISTINCT FROM v_capability_hash'
    );
    expect(applyStatusSql).toContain(
      'v_runtime."session_writer_epoch" IS DISTINCT FROM p_writer_epoch'
    );
    expect(applyStatusSql).toMatch(
      /v_runtime\."connection_epoch" IS DISTINCT FROM v_connection_epoch_text[\s\S]+outcome := 'stale'/
    );
  });

  it('clears channel identity on explicit logout without deleting its runtime fence', () => {
    expect(applyStatusSql).toContain(
      "v_disconnected_user :=\n    lower(COALESCE(p_status->>'disconnected_user', 'false')) = 'true'"
    );
    expect(applyStatusSql).toContain(
      '"number" = CASE\n        WHEN v_disconnected_user THEN NULL'
    );
    expect(applyStatusSql).toContain(
      '"container_id" = CASE\n        WHEN v_disconnected_user THEN NULL'
    );
    expect(applyStatusSql).toContain(
      '"connection_date" = CASE\n        WHEN v_disconnected_user THEN NULL'
    );
    expect(applyStatusSql).not.toMatch(
      /UPDATE public\."worker_runtime"[\s\S]+v_disconnected_user/
    );
  });

  it('writes telemetry to the outbox without mutating worker status', () => {
    expect(applyStatusSql).toContain(
      "v_mutates_status := v_event_type = 'status'"
    );
    expect(applyStatusSql).toMatch(
      /IF v_mutates_status THEN\s+UPDATE public\."worker"/
    );
    expect(applyStatusSql).toContain(
      'v_capability_hash, v_event_type,\n    p_status'
    );
    for (const source of [migration, model]) {
      expect(source).toContain('worker_runtime_event_outbox_event_type_check');
      expect(source).toContain("IN ('status', 'telemetry')");
      expect(source).toContain(
        'worker_runtime_event_outbox_payload_object_check'
      );
    }
  });

  it('renews connection timestamps on every accepted strong-online event', () => {
    expect(applyStatusSql).toContain(
      `"last_connection_check_at" = CASE\n        WHEN v_status_id = '${ONLINE}'::uuid\n          THEN clock_timestamp()`
    );
    expect(applyStatusSql).toContain(
      `WHEN v_status_id = '${ONLINE}'::uuid\n          THEN clock_timestamp()\n        ELSE w."connection_date"`
    );
    expect(applyStatusSql).toContain(
      `WHEN v_status_id <> '${DISPONIBLE}'::uuid\n          AND v_phone IS NOT NULL THEN v_phone`
    );
  });
});
