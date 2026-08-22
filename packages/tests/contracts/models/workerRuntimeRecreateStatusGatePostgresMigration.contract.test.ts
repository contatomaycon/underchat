import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260816002000.sql'),
  'utf8'
);

describe('worker runtime recreate status gate PostgreSQL migration', () => {
  it('reconciles only the exact pre-applied wrapper state', () => {
    expect(migration).toContain(
      "pg_catalog.to_regprocedure(\n    'public.apply_worker_runtime_status(uuid,uuid,text,integer,uuid,text,text,jsonb,uuid)'"
    );
    expect(migration).toContain('IF v_base IS NULL THEN');
    expect(migration).toContain("'v_requires_recreate_bootstrap'");
    expect(migration).toContain(
      "'FROM public.apply_worker_runtime_status_recreate_bootstrap_base('"
    );
    expect(migration).toContain(
      "'FROM public.apply_worker_runtime_status_pairing_status_base('"
    );
    expect(migration).toContain(
      "MESSAGE = 'apply_worker_runtime_status recreate bootstrap base name collision'"
    );
  });

  it('wraps the current status function without exposing its internal base', () => {
    expect(migration).toContain(
      ') RENAME TO apply_worker_runtime_status_recreate_bootstrap_base;'
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.apply_worker_runtime_status_recreate_bootstrap_base('
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.apply_worker_runtime_status('
    );
    expect(migration).toContain(
      'FROM public.apply_worker_runtime_status_recreate_bootstrap_base('
    );
  });

  it('uses worker then runtime row locks and gates only ONLINE recreate events', () => {
    expect(migration).toMatch(
      /FROM public\.worker AS owner[\s\S]+FOR UPDATE;[\s\S]+FROM public\.worker_runtime AS runtime[\s\S]+FOR UPDATE;/
    );
    expect(migration).toContain("v_event_type = 'status'");
    expect(migration).toContain(
      "v_requested_status =\n      '019a930d-c6f6-766d-9c84-30af6ecc33b2'"
    );
    expect(migration).toContain("'019a930d-c6f6-766d-9c84-46093814d8e0'::uuid");
    expect(migration).toContain("outcome := 'deferred';");
  });

  it('requires the exact current bootstrap marker and no retirement marker', () => {
    for (const fragment of [
      'v_runtime.recreate_bootstrap_operation_id IS NOT DISTINCT FROM',
      'v_runtime.recreate_bootstrap_runtime_generation IS NOT DISTINCT FROM',
      'lower(trim(v_runtime.recreate_bootstrap_container_id))',
      'v_runtime.recreate_bootstrap_started_at IS NOT NULL',
      'v_runtime.recreate_retired_operation_id IS NULL',
      'v_runtime.recreate_retired_runtime_generation IS NULL',
      'v_runtime.recreate_retired_container_id IS NULL',
      'v_runtime.recreate_retired_at IS NULL',
    ]) {
      expect(migration).toContain(fragment);
    }
  });

  it('keeps the runtime role as the only external executor', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.apply_worker_runtime_status(\n  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid\n) FROM PUBLIC;'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.apply_worker_runtime_status(\n  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid\n) TO whatsapp_session_runtime;'
    );
  });
});
