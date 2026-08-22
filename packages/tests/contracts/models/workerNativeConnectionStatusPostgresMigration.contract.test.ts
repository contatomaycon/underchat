import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const wrapperMigration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260804120000.sql'),
  'utf8'
);
const projectionMigration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260804130000.sql'),
  'utf8'
);
const hotPath = projectionMigration.slice(
  projectionMigration.indexOf(
    'CREATE OR REPLACE FUNCTION public.apply_worker_runtime_status('
  )
);

describe('provider-native WhatsApp status PostgreSQL contract', () => {
  it('keeps the pre-existing fence private behind the SECURITY DEFINER wrapper', () => {
    expect(wrapperMigration).toContain(
      ') RENAME TO apply_worker_runtime_status_fenced_internal;'
    );
    expect(projectionMigration).toContain('SECURITY DEFINER');
    expect(projectionMigration).toContain(
      'SET search_path = pg_catalog, public'
    );
    expect(projectionMigration).toContain(
      'REVOKE ALL ON FUNCTION public.apply_worker_runtime_status_fenced_internal('
    );
    expect(projectionMigration).toContain('FROM whatsapp_session_runtime;');
    expect(projectionMigration).toContain(
      'GRANT EXECUTE ON FUNCTION public.apply_worker_runtime_status('
    );
  });

  it('requires a complete, secret-free canonical envelope', () => {
    expect(hotPath).toContain(
      "IF (p_status ? 'connection_status') <>\n     (p_status ? 'connection_status_source_id') THEN"
    );
    for (const field of [
      'connected',
      'authenticated',
      'sessionValid',
      'recoverable',
      'qrAvailable',
    ]) {
      expect(hotPath).toContain(`v_status->'${field}'`);
    }
    expect(hotPath).toContain(
      "v_status->>'provider' IS DISTINCT FROM lower(trim(p_provider))"
    );
    expect(hotPath).toContain('IF v_native_sequence > 9007199254740991 THEN');
    expect(hotPath).toContain("v_status->>'reason' !~");
    expect(hotPath).toContain("v_status->>'errorCode' !~");
    expect(hotPath).toContain(
      "v_payload, '{connection_status}', v_status, true"
    );
    expect(hotPath).toContain("WHEN p_status->'connection_status' ? 'reason'");
    expect(hotPath).not.toContain("'cookie', p_status->'connection_status'");
  });

  it('materializes source lineage and orders admission without history scans', () => {
    for (const column of [
      'native_connection_status',
      'native_connection_public_status',
      'native_connection_status_source_id',
      'native_connection_status_sequence',
      'native_connection_status_outbox_id',
      'native_connection_status_lease_owner_id',
      'native_connection_status_fencing_token',
      'native_connection_status_changed_at_high_watermark',
      'native_connection_status_retired_source_ids',
      'native_connection_online_acknowledged',
    ]) {
      expect(projectionMigration).toContain(`"${column}"`);
    }
    expect(hotPath).toContain('v_source_id = ANY(v_retired_source_ids)');
    expect(hotPath).toContain('v_changed_at < v_changed_at_high_watermark');
    expect(hotPath).toContain('v_native_sequence < v_current_native_sequence');
    expect(hotPath).toContain('array_append(');
    expect(hotPath).not.toContain(
      'FROM public."worker_runtime_event_outbox" AS historical'
    );
    expect(hotPath).not.toContain('ORDER BY outbox."outbox_id" DESC');
    expect(projectionMigration).toContain(
      'DROP INDEX public."worker_runtime_event_outbox_native_status_idx";'
    );
  });

  it('resets the projection atomically whenever the runtime identity changes', () => {
    expect(projectionMigration).toContain(
      'CREATE TRIGGER "worker_runtime_native_connection_reset_trg"'
    );
    for (const field of [
      'runtime_generation',
      'source_provider',
      'session_writer_epoch',
      'connection_epoch',
      'connection_sequence',
      'session_storage',
    ]) {
      expect(projectionMigration).toContain(
        `OLD."${field}" IS DISTINCT FROM NEW."${field}"`
      );
    }
  });

  it('is fail-closed for ONLINE and rechecks the live lease after the inner write', () => {
    for (const readinessField of [
      'session_ready',
      'can_send',
      'can_receive_runtime',
      'authenticated',
    ]) {
      expect(hotPath).toContain(
        `p_status->'${readinessField}' IS DISTINCT FROM 'true'::jsonb`
      );
    }
    expect(hotPath).toContain("NULLIF(trim(p_status->>'phone'), '') IS NULL");
    expect(hotPath).toContain('FOR SHARE;');
    expect(hotPath).toContain('lease."owner_id" = v_lease_owner_id');
    expect(hotPath).toContain('lease."fencing_token" = v_fencing_token');
    expect(hotPath).toContain(
      'lease."expires_at" > clock_timestamp() + interval \'5 seconds\''
    );
    expect(hotPath).toContain(
      "v_preflight_storage = 'legacy_volume'\n      AND (v_lease_owner_id IS NOT NULL OR v_fencing_token IS NOT NULL)"
    );
    expect(hotPath).toContain(
      "v_preflight_storage = 'postgres'\n      AND (v_lease_owner_id IS NULL OR v_fencing_token IS NULL)"
    );
    expect(hotPath).toContain(
      "RAISE EXCEPTION 'whatsapp session lease expired before online ack'"
    );
    expect(hotPath).toContain(
      "RAISE EXCEPTION 'runtime session backend changed during status admission'"
    );
    for (const proof of [
      "-> 'connected' = 'true'::jsonb",
      "-> 'authenticated' = 'true'::jsonb",
      "-> 'sessionValid' = 'true'::jsonb",
      "-> 'qrAvailable' = 'false'::jsonb",
    ]) {
      expect(projectionMigration).toContain(proof);
    }
  });

  it('uses one control-plane lock order and claims candidates across replicas', () => {
    const workerLock = hotPath.indexOf('FROM public."worker" AS w');
    const runtimeLock = hotPath.indexOf(
      'FROM public."worker_runtime" AS runtime',
      workerLock
    );
    const leaseLock = hotPath.indexOf(
      'FROM public."whatsapp_session_lease" AS lease',
      runtimeLock
    );
    expect(workerLock).toBeGreaterThanOrEqual(0);
    expect(runtimeLock).toBeGreaterThan(workerLock);
    expect(leaseLock).toBeGreaterThan(runtimeLock);
    expect(projectionMigration).toContain('FOR UPDATE OF worker SKIP LOCKED');
    expect(projectionMigration).toContain(
      'CREATE TRIGGER "whatsapp_session_lease_late_renewal_guard_trg"'
    );
    expect(projectionMigration).toContain(
      'OLD."expires_at" <= clock_timestamp() + interval \'5 seconds\''
    );
  });

  it('keeps exact lease proof technical and deduplicates identical native facts', () => {
    expect(hotPath).toContain(
      "- 'connection_status_lease_owner_id'\n    - 'connection_status_fencing_token'"
    );
    expect(hotPath).toContain('v_current_native_status = v_status');
    expect(hotPath).toContain("outcome := 'duplicate';");
    expect(hotPath).toContain("'^[1-9][0-9]{0,15}$'");
    expect(projectionMigration).toContain('CHECK (COALESCE((');
    expect(projectionMigration).toContain(
      'array_position(\n        "native_connection_status_retired_source_ids",\n        NULL\n      ) IS NULL'
    );
    expect(hotPath).toContain(
      'outbox."event_id" = COALESCE(v_inner_event_id, p_event_id)'
    );
    expect(hotPath).not.toContain('outbox."event_id" = event_id');
  });

  it('keeps telemetry non-mutating and only projects native degradation online to offline', () => {
    expect(hotPath).toContain(
      "v_payload := v_payload - 'worker_status_id' - 'disconnected_user';"
    );
    expect(hotPath).toContain(
      "v_current_worker_status_id =\n      '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid"
    );
    expect(hotPath).toContain('AND v_lifecycle_operation_id IS NULL');
    expect(hotPath).toContain(
      'SET "worker_status_id" =\n          \'019a930d-c6f6-766d-9c84-3696c2cd5ed8\'::uuid'
    );
    expect(hotPath).toContain('SET "event_type" = \'status\'');
    expect(hotPath).toContain("v_event_type = 'telemetry'");
    expect(hotPath).toContain('OR v_business_mutation_pending');
    expect(hotPath).toContain(
      "v_event_type = 'status'\n      AND v_status->>'status' <> 'online'"
    );
    expect(hotPath).not.toContain("v_event_type := 'telemetry'");
  });

  it('persists a trusted decimal outbox order and acknowledged latch', () => {
    expect(hotPath).toContain("'{connection_status_order}'");
    expect(hotPath).toContain('to_jsonb(v_outbox_id::text)');
    expect(hotPath).toContain("'{connection_online_acknowledged}'");
    expect(hotPath).toContain(
      'runtime."native_connection_status_sequence" = v_native_sequence'
    );
    expect(hotPath).toContain(
      'AND runtime."native_connection_online_acknowledged"'
    );
  });

  it('materializes an idempotent realtime downgrade when the exact lease expires silently', () => {
    expect(projectionMigration).not.toContain(
      'CREATE INDEX "worker_runtime_postgres_online_ack_idx"'
    );
    expect(projectionMigration).not.toContain(
      'ON public."whatsapp_session_lease" ("expires_at")'
    );
    expect(projectionMigration).toContain(
      'CREATE OR REPLACE FUNCTION public.reconcile_expired_whatsapp_online_acks('
    );
    expect(projectionMigration).toContain('FOR UPDATE OF worker SKIP LOCKED');
    expect(projectionMigration).toContain('AND NOT COALESCE((');
    expect(projectionMigration).toContain(
      '"native_connection_status_outbox_id" = v_outbox_id'
    );
    expect(projectionMigration).toContain(
      '"native_connection_online_acknowledged" = false'
    );
    expect(projectionMigration).toContain("'status', 'lease_lost'");
    expect(projectionMigration).toContain(
      "'connection_status', v_public_status"
    );
    expect(projectionMigration).toContain("'provider_state', 'lease_lost'");
    expect(projectionMigration).toContain("'reason', 'session_lease_expired'");
    expect(projectionMigration).toContain(`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`);
    expect(projectionMigration).toContain("'code', 408");
    expect(projectionMigration).toContain(
      'p_lease_margin_ms integer DEFAULT 5000'
    );
    expect(projectionMigration).toContain(
      "WHEN v_final_worker_status_id =\n        '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid\n        THEN 'telemetry'"
    );
    expect(projectionMigration).toContain(
      'REVOKE ALL ON FUNCTION public.reconcile_expired_whatsapp_online_acks('
    );
    expect(projectionMigration).toContain(
      'GRANT EXECUTE ON FUNCTION public.reconcile_expired_whatsapp_online_acks('
    );
    expect(projectionMigration).toContain(') TO CURRENT_USER;');
    expect(projectionMigration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.reconcile_expired_whatsapp_online_acks\([\s\S]*?TO whatsapp_session_runtime;/u
    );
  });
});
