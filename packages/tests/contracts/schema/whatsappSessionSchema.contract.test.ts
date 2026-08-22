import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationPath = 'atlas/prod/20260802144500.sql';
const baseMigration = fs.readFileSync(
  path.resolve(root, migrationPath),
  'utf8'
);
const canonicalV17Migration = fs.readFileSync(
  path.resolve(root, 'atlas/prod/20260803120000.sql'),
  'utf8'
);
const preDrainFailureMigration = fs.readFileSync(
  path.resolve(root, 'atlas/prod/20260807173000.sql'),
  'utf8'
);
const profileAnchorMigration = fs.readFileSync(
  path.resolve(root, 'atlas/prod/20260809100000.sql'),
  'utf8'
);
const lifecycleBoundaryMigration = fs.readFileSync(
  path.resolve(root, 'atlas/prod/20260811120000.sql'),
  'utf8'
);
const lifecycleScopeMigration = fs.readFileSync(
  path.resolve(root, 'atlas/prod/20260811121000.sql'),
  'utf8'
);
const migration = `${baseMigration}\n${canonicalV17Migration}\n${preDrainFailureMigration}\n${lifecycleBoundaryMigration}\n${lifecycleScopeMigration}`;

const sessionRevisionTables = [
  'whatsapp_provider_record',
  'whatsapp_artifact',
  'whatsapp_device',
  'whatsapp_identity_keys',
  'whatsapp_pre_keys',
  'whatsapp_pq_pre_keys',
  'whatsapp_pq_pre_key_state',
  'whatsapp_signal_sessions',
  'whatsapp_sender_keys',
  'whatsapp_app_state_sync_keys',
  'whatsapp_app_state_version',
  'whatsapp_app_state_mutation_macs',
  'whatsapp_contacts',
  'whatsapp_chat_settings',
  'whatsapp_message_secrets',
  'whatsapp_privacy_tokens',
  'whatsapp_nct_salt',
  'whatsapp_lid_map',
  'whatsapp_event_buffer',
  'whatsapp_retry_buffer',
] as const;

function tableDefinition(table: string): string {
  const marker = `CREATE TABLE "public"."${table}"`;
  const start = migration.indexOf(marker);
  if (start < 0) {
    throw new Error(`missing table ${table}`);
  }
  const next = migration.indexOf('\nCREATE TABLE ', start + marker.length);
  return migration.slice(start, next < 0 ? migration.length : next);
}

function functionDefinition(functionName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${functionName}(`;
  const start = migration.indexOf(marker);
  if (start < 0) {
    throw new Error(`missing function ${functionName}`);
  }
  const end = migration.indexOf('\n$function$;', start);
  if (end < 0) {
    throw new Error(`unterminated function ${functionName}`);
  }
  return migration.slice(start, end + '\n$function$;'.length);
}

function latestFunctionDefinition(functionName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${functionName}(`;
  const start = migration.lastIndexOf(marker);
  if (start < 0) {
    throw new Error(`missing function ${functionName}`);
  }
  const end = migration.indexOf('\n$function$;', start);
  if (end < 0) {
    throw new Error(`unterminated function ${functionName}`);
  }
  return migration.slice(start, end + '\n$function$;'.length);
}

function promotionImplementationDefinition(): string {
  const rename = migration.lastIndexOf(
    'RENAME TO promote_whatsapp_session_revision_v17_impl'
  );
  const marker =
    'CREATE OR REPLACE FUNCTION public.promote_whatsapp_session_revision(';
  const start = migration.lastIndexOf(marker, rename);
  if (start < 0 || rename < 0) {
    throw new Error('private promotion implementation was not found');
  }
  const end = migration.indexOf('\n$function$;', start);
  return migration.slice(start, end + '\n$function$;'.length);
}

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(root, relativePath), 'utf8');
}

describe('unified WhatsApp session schema', () => {
  it('locks lifecycle workers through an authenticated definer boundary', () => {
    const lifecycle = latestFunctionDefinition(
      'begin_whatsapp_session_lifecycle'
    );
    expect(lifecycle).toContain('public.begin_whatsapp_worker_operation(');
    expect(lifecycle).toContain('FROM public.worker AS worker');
    expect(lifecycle).toContain('FOR UPDATE OF worker, runtime');
    expect(lifecycle).toContain("worker.session_storage = 'postgres'");
    expect(lifecycleScopeMigration).toContain(
      'SECURITY DEFINER\nSET search_path'
    );
    expect(lifecycleScopeMigration).toContain(
      'REVOKE ALL ON FUNCTION public.begin_whatsapp_session_lifecycle(\n  uuid, uuid, text, integer, uuid, text, text\n) FROM PUBLIC'
    );
    expect(lifecycleScopeMigration).toContain(
      'GRANT EXECUTE ON FUNCTION public.begin_whatsapp_session_lifecycle(\n  uuid, uuid, text, integer, uuid, text, text\n) TO whatsapp_session_runtime'
    );
  });

  it('adds WWebJS profile authority without changing canonical schema v17', () => {
    expect(profileAnchorMigration).toContain(
      'CREATE TABLE public.whatsapp_wwebjs_profile_anchor'
    );
    expect(profileAnchorMigration).toContain(
      'CONSTRAINT whatsapp_wwebjs_profile_anchor_artifact_fk'
    );
    expect(profileAnchorMigration).toContain(
      'CREATE UNIQUE INDEX whatsapp_wwebjs_profile_anchor_active_uidx'
    );
    expect(profileAnchorMigration).not.toContain(
      'UPDATE public.whatsapp_store_version'
    );
    expect(profileAnchorMigration).not.toContain(
      'ALTER TABLE public.whatsapp_store_version'
    );
  });

  it('drops the unowned legacy LID cache instead of copying it across sessions', () => {
    for (const dialect of ['postgres', 'sqlite']) {
      const upgrade = read(
        `apps/worker_whatsmeow/forks/whatsmeow/store/sqlstore/upgrades/17-canonical-session-codec.${dialect}.sql`
      );
      expect(upgrade).toContain('no recoverable device/session owner');
      expect(upgrade).toContain('DELETE FROM whatsapp_lid_map;');
    }
  });

  it('keeps the shared store version cursor as a singleton row', () => {
    expect(tableDefinition('whatsapp_store_version')).toContain(
      'CONSTRAINT "whatsapp_store_version_pk" PRIMARY KEY ("version")'
    );
    expect(canonicalV17Migration).toContain(
      'CHECK (version = 17 AND compat = 17)'
    );
  });

  it.each(sessionRevisionTables)(
    '%s owns every row by session and revision',
    (table) => {
      const definition = tableDefinition(table);
      expect(definition).toContain('"session_id" uuid NOT NULL');
      expect(definition).toContain('"revision_id" bigint NOT NULL');
      expect(definition).toMatch(
        /(?:PRIMARY KEY|FOREIGN KEY) \("session_id", "revision_id"/u
      );
    }
  );

  it('keeps external WhatsApp identifiers non-unique across channels', () => {
    expect(tableDefinition('whatsapp_device')).toContain(
      'ON "public"."whatsapp_device" ("jid", "session_id")'
    );
    expect(tableDefinition('whatsapp_device')).not.toMatch(
      /UNIQUE[^;]*(?:"jid"|"lid"|"provider")/u
    );
    expect(tableDefinition('whatsapp_lid_map')).toContain(
      'UNIQUE ("session_id", "revision_id", "pn")'
    );
    expect(migration).not.toMatch(
      /UNIQUE\s*(?:INDEX[^\n]*ON[^\n]*|)\s*\((?:"jid"|"lid"|"pn"|"provider")\)/u
    );
  });

  it('reserves a companion fingerprint for its session throughout handoff and failure states', () => {
    expect(canonicalV17Migration).toContain(
      'CREATE UNIQUE INDEX whatsapp_session_active_device_fingerprint_uidx'
    );
    expect(canonicalV17Migration).toContain(
      'active_device_fingerprint_version,\n  active_device_fingerprint'
    );
    expect(canonicalV17Migration).toContain(
      'underchat-whatsapp-device-fingerprint-v2'
    );
    expect(canonicalV17Migration).not.toMatch(
      /active_device_fingerprint_uidx[^;]*state[^;]*ready/u
    );
    expect(canonicalV17Migration).toContain(
      'CREATE TABLE public.whatsapp_companion_reservation'
    );
    expect(canonicalV17Migration).toContain(
      'CONSTRAINT whatsapp_companion_reservation_pk PRIMARY KEY (\n    fingerprint_version, device_fingerprint'
    );
    expect(canonicalV17Migration).toContain(
      'CREATE TRIGGER whatsapp_device_companion_reservation_v17_trigger'
    );
    expect(canonicalV17Migration).toContain(
      'whatsapp companion identity is reserved by another session'
    );
    expect(canonicalV17Migration).toContain(
      "IF NEW.state = 'empty'\n    AND NEW.active_revision_id IS NULL"
    );
  });

  it('separates ADV capability from fingerprint identity and rejects orphan values', () => {
    expect(canonicalV17Migration).toContain(
      'ADD COLUMN adv_secret_available boolean'
    );
    expect(canonicalV17Migration).toContain(
      'CONSTRAINT whatsapp_device_adv_secret_check'
    );
    expect(canonicalV17Migration).toMatch(
      /adv_secret_available[\s\S]+octet_length\(adv_key\) = 32[\s\S]+num_nulls/u
    );
    expect(canonicalV17Migration).toContain(
      'device_fingerprint IS NOT NULL\n      AND fingerprint_version IS NOT NULL'
    );
    expect(canonicalV17Migration).toContain(
      'active_device_fingerprint IS NOT NULL\n      AND active_device_fingerprint_version IS NOT NULL'
    );
  });

  it('owns Signal scope inside the session/revision primary key', () => {
    expect(canonicalV17Migration).toContain(
      "ADD COLUMN scope text NOT NULL DEFAULT 'default'"
    );
    expect(canonicalV17Migration).toContain(
      'PRIMARY KEY (session_id, revision_id, their_id, scope)'
    );
    expect(canonicalV17Migration).toContain(
      "CHECK (scope IN ('default', 'status', 'pq'))"
    );
  });

  it('stores portable ML-KEM material with strict revision-local bounds', () => {
    const keys = tableDefinition('whatsapp_pq_pre_keys');
    const state = tableDefinition('whatsapp_pq_pre_key_state');

    expect(keys).toContain(
      'PRIMARY KEY ("session_id", "revision_id", "key_id")'
    );
    expect(keys).toContain("key_kind IN ('one_time', 'last_resort')");
    expect(keys).toContain('octet_length(public_key) = 1568');
    expect(keys).toContain('octet_length(private_key) = 3168');
    expect(keys).toContain('octet_length(signature) = 64');
    expect(keys).toContain('key_id >= 0 AND key_id < 16777215');
    expect(state).toContain('PRIMARY KEY ("session_id", "revision_id")');
    expect(state).toContain("codec_version = 1 AND algorithm = 'ML-KEM-1024'");
    expect(state).toContain(
      'next_pre_key_id >= 0 AND next_pre_key_id < 16777215'
    );
    expect(state).toContain(
      'last_server_count IS NOT NULL\n      AND last_server_count_timestamp_ms IS NOT NULL'
    );

    expect(canonicalV17Migration).toContain(
      'CREATE UNIQUE INDEX "whatsapp_pq_pre_keys_last_resort_uidx"\nON "public"."whatsapp_pq_pre_keys" ("session_id", "revision_id")'
    );
    expect(canonicalV17Migration).toContain(
      'CREATE INDEX "whatsapp_pq_pre_keys_pending_idx"'
    );
    expect(canonicalV17Migration).toContain(
      "WHERE (key_kind = 'one_time' AND sent_to_server = false)"
    );

    for (const table of ['whatsapp_pq_pre_keys', 'whatsapp_pq_pre_key_state']) {
      expect(canonicalV17Migration).toContain(
        `ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`
      );
      expect(canonicalV17Migration).toContain(`ON public.${table}\nUSING (`);
    }
    expect(canonicalV17Migration).toContain(
      'public.whatsapp_pq_pre_keys,\n  public.whatsapp_pq_pre_key_state\nTO whatsapp_session_runtime;'
    );
  });

  it('caps canonical Signal and sender-key payloads at the database boundary', () => {
    expect(canonicalV17Migration).toContain(
      'CONSTRAINT whatsapp_signal_sessions_payload_check'
    );
    expect(canonicalV17Migration).toContain(
      'octet_length(session) BETWEEN 1 AND 8388608'
    );
    expect(canonicalV17Migration).toContain(
      'CONSTRAINT whatsapp_sender_keys_payload_check'
    );
    expect(canonicalV17Migration).toContain(
      'octet_length(sender_key) BETWEEN 1 AND 2097152'
    );
    for (const constraint of [
      'whatsapp_device_adv_details_size_check',
      'whatsapp_app_state_sync_keys_payload_check',
      'whatsapp_message_secrets_payload_check',
      'whatsapp_privacy_tokens_payload_check',
      'whatsapp_nct_salt_payload_check',
      'whatsapp_event_buffer_plaintext_check',
      'whatsapp_retry_buffer_plaintext_check',
      'whatsapp_provider_record_payload_check',
      'whatsapp_artifact_manifest_size_check',
    ]) {
      expect(canonicalV17Migration).toContain(`CONSTRAINT ${constraint}`);
    }
    expect(canonicalV17Migration).toContain(
      'octet_length(payload) BETWEEN 1 AND 8388608'
    );
    expect(canonicalV17Migration).toContain(
      'octet_length(manifest::text) <= 1048576'
    );
  });

  it('bridges lifecycle-created WWeb handoff revisions to the native profile manifest format', () => {
    const guard = functionDefinition('enforce_whatsapp_revision_schema_v17');
    expect(guard).toContain("NEW.provider = 'wwebjs'");
    expect(guard).toContain("NEW.source = 'handoff'");
    expect(guard).toContain("NEW.format = 'whatsapp-canonical-v1'");
    expect(guard).toContain("NEW.format := 'wwebjs-profile-manifest-v1'");
  });

  it('indexes artifact chunk blob references in session-first order', () => {
    expect(migration).toContain(
      'CREATE INDEX "whatsapp_artifact_chunk_blob_idx" ON "public"."whatsapp_artifact_chunk" ("session_id", "sha256")'
    );
  });

  it('keeps deduplicated artifact bytes revision-visible and content-addressed', () => {
    const blob = tableDefinition('whatsapp_artifact_blob');
    expect(blob).toContain('whatsapp_artifact_blob_digest_check');
    expect(blob).toContain(
      "encode(public.digest(payload, 'sha256'::text), 'hex'::text)"
    );
    expect(migration).toContain('whatsapp_artifact_is_visible');
    expect(migration).toContain('whatsapp_artifact_blob_is_visible');
    expect(migration).toContain(
      'CREATE POLICY whatsapp_artifact_blob_runtime_select'
    );
    expect(migration).toContain(
      'CREATE POLICY whatsapp_artifact_blob_runtime_insert'
    );
    expect(migration).toContain(
      'CREATE POLICY whatsapp_artifact_chunk_runtime'
    );
    const visibility = functionDefinition('whatsapp_artifact_is_visible');
    expect(visibility).toContain(
      "artifact.revision_id = nullif(\n        current_setting('app.whatsapp_revision_id', true), ''"
    );
    expect(visibility).not.toContain('source_revision_id');
    expect(migration).not.toMatch(
      /ALTER POLICY whatsapp_session_isolation ON public\."whatsapp_artifact_(?:blob|chunk)"/u
    );
  });

  it('allows at most one active revision per session', () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "whatsapp_session_revision_active_uidx" ON "public"."whatsapp_session_revision" ("session_id") WHERE ((status)::text = \'active\'::text)'
    );
  });

  it('uses an irreversible two-phase WWebJS activation boundary', () => {
    expect(canonicalV17Migration).toContain(
      'ADD COLUMN point_of_no_return_at timestamptz'
    );
    expect(canonicalV17Migration).toContain(
      'ADD COLUMN pre_activation_artifact_id uuid'
    );
    expect(canonicalV17Migration).toContain("'promoting', 'activating'");

    const commit = latestFunctionDefinition(
      'commit_whatsapp_session_activation'
    );
    expect(commit).toContain('promote_whatsapp_session_revision_v17_impl');
    expect(commit).toContain("SET state = 'activating'");
    expect(commit).toContain(
      'pre_activation_artifact_id = v_pre_activation_artifact_id'
    );
    expect(commit).toContain("IS DISTINCT FROM 'null'");

    const finalize = latestFunctionDefinition(
      'finalize_whatsapp_session_activation'
    );
    expect(finalize).toContain(
      "app_state_hydration_required')\n      IS DISTINCT FROM 'false'"
    );
    expect(finalize).toContain(
      "pq_bootstrap_required')\n      IS DISTINCT FROM 'false'"
    );
    expect(finalize).toContain(
      'artifact.artifact_id = v_ready_checkpoint_artifact_id'
    );
    expect(finalize).toContain(
      'artifact.checksum_sha256 = v_ready_checkpoint_checksum'
    );
    expect(finalize).toContain(
      'DELETE FROM public.whatsapp_provider_record AS marker'
    );
    expect(finalize).toContain("SET state = 'ready'");
    expect(finalize).toContain("SET state = 'completed'");

    const promote = latestFunctionDefinition(
      'promote_whatsapp_session_revision'
    );
    expect(promote).toContain(
      'WWebJS handoff requires offline activation commit and connected finalization'
    );
  });

  it('makes rollback strictly pre-CAS and rejects active/completed candidates', () => {
    const rollback = latestFunctionDefinition(
      'rollback_whatsapp_session_revision'
    );
    expect(rollback).toContain("AND status IN ('staging', 'validating');");
    expect(rollback).not.toContain("'validating', 'promoting', 'completed'");
    expect(rollback).not.toContain(
      "status IN ('staging', 'validating', 'active')"
    );
    expect(rollback).toContain(
      'AND active_revision_id = p_previous_revision_id'
    );
  });

  it('queues revision GC without exposing the queue to runtime workers', () => {
    const queue = tableDefinition('whatsapp_session_gc_queue');
    expect(queue).toContain('PRIMARY KEY ("session_id", "revision_id")');
    expect(queue).toContain(
      'FOREIGN KEY ("session_id", "revision_id") REFERENCES "public"."whatsapp_session_revision" ("session_id", "revision_id")'
    );
    expect(migration).toContain(
      'CREATE INDEX "whatsapp_session_gc_queue_dispatch_idx"'
    );
    expect(migration).toContain(
      'CREATE INDEX "whatsapp_session_gc_queue_claim_expiry_idx"'
    );
    expect(migration).toContain("interval '72 hours'");
    expect(migration).toContain("interval '7 days'");
    expect(migration).toContain(
      'ALTER TABLE public."whatsapp_session_gc_queue" FORCE ROW LEVEL SECURITY'
    );
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public.whatsapp_session_gc_queue'
    );
    expect(migration).not.toMatch(
      /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)[\s\S]{0,500}public\.whatsapp_session_gc_queue[\s\S]{0,100}TO whatsapp_session_runtime/u
    );
  });

  it('structurally ties every revision to its owning WhatsApp session', () => {
    expect(migration).toContain(
      'CONSTRAINT "whatsapp_session_revision_session_fk"'
    );
    expect(migration).toContain(
      'FOREIGN KEY ("session_id") REFERENCES "public"."whatsapp_session" ("session_id")'
    );
    expect(migration).not.toContain(
      'CONSTRAINT "whatsapp_session_revision_worker_fk"'
    );
  });

  it('indexes terminal handoffs for rollback-window collection', () => {
    expect(migration).toContain(
      'CREATE INDEX "whatsapp_session_handoff_gc_idx" ON "public"."whatsapp_session_handoff" ("completed_at", "session_id", "handoff_id")'
    );
    expect(migration).toContain(
      "WHERE ((state)::text = ANY ((ARRAY['completed'::character varying, 'failed'::character varying])::text[]))"
    );
  });

  it('durably schedules manager compensation in the rollback transaction', () => {
    const handoff = tableDefinition('whatsapp_session_handoff');
    expect(handoff).toContain(
      '"recovery_state" character varying(20) NOT NULL DEFAULT \'none\''
    );
    expect(handoff).toContain('"recovery_operation_id" uuid NULL');
    expect(handoff).toContain('"recovery_from_generation" integer NULL');
    expect(handoff).toContain('"recovery_claim_token" uuid NULL');
    expect(handoff).toContain(
      'CONSTRAINT "whatsapp_session_handoff_recovery_claim_check"'
    );
    expect(migration).toContain(
      'CREATE INDEX "whatsapp_session_handoff_recovery_idx"'
    );
    expect(migration).toContain(
      'CREATE TRIGGER whatsapp_session_handoff_recovery_trigger'
    );

    const scheduler = functionDefinition('schedule_whatsapp_handoff_recovery');
    expect(scheduler).toContain(
      "NEW.state = 'failed' AND OLD.state IS DISTINCT FROM 'failed'"
    );
    expect(scheduler).toContain("NEW.recovery_state := 'pending'");
    expect(scheduler).toContain('gen_random_uuid()');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.schedule_whatsapp_handoff_recovery() FROM PUBLIC'
    );

    const runtimeGrantStart = migration.indexOf(
      'GRANT UPDATE (\n  state,\n  error_code,\n  updated_at\n) ON TABLE public.whatsapp_session_handoff'
    );
    expect(runtimeGrantStart).toBeGreaterThan(-1);
    const runtimeGrant = migration.slice(
      runtimeGrantStart,
      runtimeGrantStart + 240
    );
    expect(runtimeGrant).not.toContain('recovery_state');
    expect(runtimeGrant).not.toContain('recovery_operation_id');

    const rollback = latestFunctionDefinition(
      'rollback_whatsapp_session_revision'
    );
    expect(rollback).toContain("SET state = 'failed'");
    expect(rollback).toContain(
      'AND source_revision_id = p_previous_revision_id'
    );
    expect(rollback).toContain(
      'AND target_revision_id = p_candidate_revision_id'
    );
  });

  it('prevents revision GC from deleting an unfinished handoff recovery', () => {
    const collector = read(
      'packages/services/whatsappSessionGarbageCollector.service.ts'
    );
    expect(collector).toContain("handoff.recovery_state !== 'completed'");
    expect(collector).toContain(
      "handoff.recovery_state IN ('completed', 'cancelled', 'blocked')"
    );
  });

  it('uses a row lease, fencing and exact transaction-local RLS scope', () => {
    expect(migration).toContain(
      'CREATE TABLE "public"."whatsapp_session_lease"'
    );
    expect(migration).toContain('lease.fencing_token + 1');
    expect(migration).toContain('lease.expires_at > clock_timestamp()');
    expect(migration).toContain(
      'CREATE TRIGGER whatsapp_session_create_lease_row_v17_trigger'
    );
    for (const functionName of [
      'acquire_whatsapp_session_lease',
      'renew_whatsapp_session_lease',
    ]) {
      const leaseFunction = latestFunctionDefinition(functionName);
      const lockIndex = leaseFunction.indexOf('FOR UPDATE;');
      const clockIndex = leaseFunction.indexOf('v_now := clock_timestamp();');
      expect(lockIndex).toBeGreaterThanOrEqual(0);
      expect(clockIndex).toBeGreaterThan(lockIndex);
    }
    expect(migration).toContain('FOR SHARE OF lease, session, revision');
    expect(migration).toContain(
      'ALTER TABLE public."whatsapp_session_lease" FORCE ROW LEVEL SECURITY'
    );
    expect(migration).toContain(
      "current_setting('app.whatsapp_session_id', true)"
    );
    expect(migration).toContain(
      "current_setting('app.whatsapp_revision_id', true)"
    );
    expect(migration).toContain('whatsapp_runtime_scope_is_valid()');
    expect(migration).toContain(
      "current_setting('app.whatsapp_owner_id', true)"
    );
    expect(migration).toContain(
      "current_setting('app.whatsapp_capability', true)"
    );
    expect(migration).toContain('whatsapp_runtime_scope_secret');
    expect(migration).toContain('issue_whatsapp_runtime_scope_signature');
    expect(migration).toContain(
      "current_setting('app.whatsapp_scope_signature', true)"
    );
    expect(migration).toContain('pg_backend_pid()::text');
    expect(migration).toContain('txid_current()::text');
    expect(migration).toContain('public.hmac(');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.issue_whatsapp_runtime_scope_signature() FROM PUBLIC'
    );
    expect(migration).not.toContain('app.whatsapp_definer_scope');
  });

  it('rotates the authorized handoff source read fence with the target runtime', () => {
    const activation = functionDefinition('activate_whatsapp_runtime_fence');
    expect(activation).toContain('SELECT handoff."source_revision_id"');
    expect(activation).toContain(
      'handoff."target_provider" = lower(trim(p_provider))'
    );
    expect(activation).toContain('SET "writer_generation" = p_generation');
  });

  it('reserves terminal revision and handoff states for lifecycle functions', () => {
    const guard = functionDefinition(
      'enforce_whatsapp_runtime_state_transition'
    );
    expect(guard).toContain("OLD.status = 'staging'");
    expect(guard).toContain("NEW.status = 'validating'");
    expect(guard).not.toContain("NEW.status = 'active'");
    expect(guard).not.toContain("NEW.status = 'failed'");
    expect(guard).toContain("WHEN 'promoting' THEN 6");
    expect(guard).not.toContain("WHEN 'completed' THEN");
    expect(guard).not.toContain("WHEN 'failed' THEN");
    expect(migration).toContain(
      'CREATE TRIGGER whatsapp_session_revision_runtime_state_guard'
    );
    expect(migration).toContain(
      'CREATE TRIGGER whatsapp_session_handoff_runtime_state_guard'
    );
  });

  it('binds revision and handoff DML to the exact signed revision scope', () => {
    const revisionPolicy = migration.slice(
      migration.indexOf(
        'ALTER POLICY whatsapp_session_isolation ON public."whatsapp_session_revision"'
      ),
      migration.indexOf(
        'ALTER POLICY whatsapp_session_isolation ON public."whatsapp_session"'
      )
    );
    expect(revisionPolicy).toContain(
      "revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)"
    );
    expect(migration).toContain(
      'CREATE POLICY whatsapp_session_handoff_runtime_update'
    );
    expect(migration).toContain(
      "target_revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)"
    );
  });

  it('authenticates session entry points with the raw capability, never its stored hash', () => {
    for (const functionName of [
      'acquire_whatsapp_session_lease',
      'renew_whatsapp_session_lease',
      'release_whatsapp_session_lease',
      'begin_whatsapp_session_operation',
      'begin_whatsapp_session_mutation',
      'begin_whatsapp_handoff_source_read',
      'open_whatsapp_session_revision',
      'create_whatsapp_session_candidate',
      'clear_whatsapp_session',
    ]) {
      const definition = functionDefinition(functionName);
      expect(definition).toContain('p_capability text');
      expect(definition).toContain(
        "v_capability_hash := encode(public.digest(p_capability, 'sha256'), 'hex')"
      );
      expect(definition).toContain('length(p_capability) < 32');
      expect(definition).toContain('length(p_capability) > 512');
      expect(definition).not.toContain('p_capability_hash text');
      expect(definition).not.toMatch(/capability_hash\s*=\s*p_capability\b/u);
      expect(definition).not.toMatch(/p_capability_hash\s+IS\s+NULL\s+OR/u);
    }

    for (const functionName of [
      'finalize_whatsapp_session_pairing',
      'rollback_whatsapp_session_revision',
      'commit_whatsapp_session_activation',
      'finalize_whatsapp_session_activation',
    ]) {
      const definition = latestFunctionDefinition(functionName);
      expect(definition).toContain('p_capability text');
      expect(definition).toMatch(/p_generation,\s+p_epoch,\s+p_capability/u);
      expect(definition).not.toMatch(
        /begin_whatsapp_session_operation\([^)]*\bNULL\b[^)]*\)/u
      );
    }
    expect(promotionImplementationDefinition()).toContain(
      'PERFORM public.begin_whatsapp_session_mutation('
    );
    expect(
      latestFunctionDefinition('promote_whatsapp_session_revision')
    ).toContain('promote_whatsapp_session_revision_v17_impl');
  });

  it('separates read scopes from mutation scopes with a fixed lock order', () => {
    const read = functionDefinition('begin_whatsapp_session_operation');
    const mutation = functionDefinition('begin_whatsapp_session_mutation');

    expect(read).toContain('FOR SHARE OF lease, session, revision');
    expect(read).not.toContain('FOR UPDATE OF session');
    expect(read).not.toContain('FOR UPDATE OF revision');

    const leaseLock = mutation.indexOf('FOR SHARE OF lease');
    const sessionLock = mutation.indexOf('FOR UPDATE OF session');
    const revisionLock = mutation.indexOf('FOR UPDATE OF revision');
    expect(leaseLock).toBeGreaterThan(0);
    expect(sessionLock).toBeGreaterThan(leaseLock);
    expect(revisionLock).toBeGreaterThan(sessionLock);
    expect(mutation).toContain(
      "v_capability_hash := encode(public.digest(p_capability, 'sha256'), 'hex')"
    );
    expect(mutation).toContain(
      "set_config('app.whatsapp_session_id', p_session_id::text, true)"
    );
    expect(mutation).toContain(
      "set_config('app.whatsapp_revision_id', p_revision_id::text, true)"
    );
    expect(mutation).toContain('issue_whatsapp_runtime_scope_signature()');

    const verifier = fs.readFileSync(
      path.resolve(root, 'scripts/verify-whatsapp-session-postgres.mjs'),
      'utf8'
    );
    expect(verifier).toContain('const beginOperation = async');
    expect(verifier).toContain('const beginMutation = async');
    expect(verifier).toContain('await beginOperation(clientA');
    expect(verifier).toContain('await beginMutation(clientA');
    expect(verifier).toContain(
      'const verifySameProviderSecureImportLifecycle = async'
    );
    expect(verifier).toContain(
      "log('same_provider_secure_import_lifecycle_verified'"
    );
  });

  it('routes every lifecycle DML function through the mutation boundary', () => {
    for (const functionName of [
      'finalize_whatsapp_session_pairing',
      'rollback_whatsapp_session_revision',
      'commit_whatsapp_session_activation',
      'finalize_whatsapp_session_activation',
    ]) {
      const definition = latestFunctionDefinition(functionName);
      expect(definition).toContain(
        'PERFORM public.begin_whatsapp_session_mutation('
      );
      expect(definition).not.toContain(
        'PERFORM public.begin_whatsapp_session_operation('
      );
    }
    expect(promotionImplementationDefinition()).toContain(
      'PERFORM public.begin_whatsapp_session_mutation('
    );
    expect(
      latestFunctionDefinition('promote_whatsapp_session_revision')
    ).toContain('promote_whatsapp_session_revision_v17_impl');

    const functionNames = new Set(
      [
        ...migration.matchAll(
          /CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\(/gu
        ),
      ].map((match) => match[1])
    );
    for (const functionName of functionNames) {
      const definition = latestFunctionDefinition(functionName);
      const operationCall = definition.indexOf(
        'PERFORM public.begin_whatsapp_session_operation('
      );
      if (operationCall < 0) continue;
      expect(definition.slice(operationCall)).not.toMatch(
        /^\s*(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE\s+)/gmu
      );
    }
  });

  it('keeps same-provider secure imports independent from worker lifecycle state', () => {
    const lifecycleBranches = new Map<string, string>();

    for (const functionName of [
      'promote_whatsapp_session_revision_v17_impl',
      'rollback_whatsapp_session_revision',
    ]) {
      const definition =
        functionName === 'promote_whatsapp_session_revision_v17_impl'
          ? promotionImplementationDefinition()
          : latestFunctionDefinition(functionName);
      const sameProviderStart = definition.indexOf(
        'IF v_source_provider = v_target_provider\n' +
          "    AND v_target_source = 'secure_import'\n" +
          '    AND v_lifecycle_operation_id IS NULL\n' +
          '  THEN'
      );
      const lifecycleStart = definition.indexOf(
        '\n  ELSE\n    UPDATE public.worker AS worker',
        sameProviderStart
      );
      const workerBranchEnd = definition.indexOf(
        '\n\n  UPDATE public.whatsapp_session_handoff',
        lifecycleStart
      );

      expect(sameProviderStart).toBeGreaterThan(-1);
      expect(lifecycleStart).toBeGreaterThan(sameProviderStart);
      expect(workerBranchEnd).toBeGreaterThan(lifecycleStart);

      const sameProviderBranch = definition.slice(
        sameProviderStart,
        lifecycleStart
      );
      const lifecycleBranch = definition.slice(lifecycleStart, workerBranchEnd);

      expect(definition).toContain(
        'target_revision.source, handoff.lifecycle_operation_id'
      );
      expect(sameProviderBranch).toContain(
        'worker.worker_type_id = v_source_worker_type'
      );
      expect(sameProviderBranch).toContain(
        "worker.session_storage = 'postgres'"
      );
      expect(sameProviderBranch).toContain('worker.deleted_at IS NULL');
      expect(sameProviderBranch).not.toContain('UPDATE public.worker');
      expect(sameProviderBranch).not.toContain('worker.worker_status_id');
      expect(sameProviderBranch).not.toContain('worker.lifecycle_operation_id');

      expect(lifecycleBranch).toContain('UPDATE public.worker AS worker');
      expect(lifecycleBranch).toContain('worker.worker_status_id =');
      expect(lifecycleBranch).toContain(
        'worker.lifecycle_operation_id = v_lifecycle_operation_id'
      );
      expect(lifecycleBranch).toContain("worker.session_storage = 'postgres'");
      lifecycleBranches.set(functionName, lifecycleBranch);
    }

    expect(
      lifecycleBranches.get('promote_whatsapp_session_revision_v17_impl')
    ).toContain('SET worker_type_id = v_target_worker_type');
    expect(
      lifecycleBranches.get('rollback_whatsapp_session_revision')
    ).toContain('SET worker_type_id = v_source_worker_type');
  });

  it('reserves every cross-provider candidate for the manager-authorized lifecycle handoff', () => {
    const runtimeCandidate = functionDefinition(
      'create_whatsapp_session_candidate'
    );
    expect(runtimeCandidate).toContain(
      "lower(trim(p_source)) <> 'secure_import'"
    );
    expect(runtimeCandidate).toContain(
      'v_source_provider <> lower(trim(p_target_provider))'
    );
    expect(runtimeCandidate).toContain(
      'cross-provider candidate requires manager-authorized handoff'
    );

    const managerHandoff = functionDefinition(
      'request_whatsapp_provider_handoff'
    );
    expect(managerHandoff).toContain("worker.session_storage = 'postgres'");
    expect(managerHandoff).toContain(
      'worker.lifecycle_operation_id = p_lifecycle_operation_id'
    );
    expect(managerHandoff).toContain(
      'worker.worker_type_id = v_source_worker_type'
    );
    expect(managerHandoff).toContain(
      'SET worker_type_id = v_target_worker_type'
    );
    expect(managerHandoff).toContain(
      'empty whatsapp provider switch requires an absent runtime reservation'
    );
    expect(managerHandoff).toMatch(
      /FROM public\.worker_runtime AS runtime\s+WHERE runtime\.worker_id = p_session_id\s+\)/u
    );
  });

  it('keeps the source authoritative until an explicit drain proof and atomic promotion', () => {
    const handoff = tableDefinition('whatsapp_session_handoff');
    expect(handoff).toContain('"source_checkpoint_checksum_sha256"');
    expect(handoff).toContain('"source_checkpoint_size_bytes"');
    expect(handoff).toContain('"source_checkpoint_record_count"');
    expect(handoff).toContain('"source_drained_at"');

    const acknowledge = functionDefinition(
      'acknowledge_whatsapp_handoff_source_drained'
    );
    for (const releasedField of [
      'lease.owner_id IS NOT NULL',
      'lease.provider IS NOT NULL',
      'lease.epoch IS NOT NULL',
      'lease.acquired_at IS NOT NULL',
      'lease.heartbeat_at IS NOT NULL',
      'lease.expires_at IS NOT NULL',
    ]) {
      expect(acknowledge).toContain(releasedField);
    }
    expect(acknowledge).toContain("SET state = 'transforming'");
    expect(acknowledge).toContain(
      'source_checkpoint_checksum_sha256 = p_checkpoint_checksum_sha256'
    );
    expect(acknowledge).toContain(
      'source_checkpoint_record_count = p_checkpoint_record_count'
    );
    expect(acknowledge).not.toContain(
      'revision.checksum_sha256 = p_checkpoint_checksum_sha256'
    );

    const acquire = functionDefinition('acquire_whatsapp_session_lease');
    expect(acquire).toContain(
      "source_handoff.state IN ('requested', 'draining')"
    );
    expect(acquire).toContain(
      "target_handoff.state IN ('transforming', 'hydrating', 'validating', 'promoting')"
    );

    const promotion = promotionImplementationDefinition();
    expect(promotion).toContain('SET worker_type_id = v_target_worker_type');
    expect(promotion).toContain('worker.worker_type_id = v_source_worker_type');
    const rollback = latestFunctionDefinition(
      'rollback_whatsapp_session_revision'
    );
    expect(rollback).toContain('SET worker_type_id = v_source_worker_type');
  });

  it('atomically returns a terminal pre-drain failure to the active source and schedules recovery', () => {
    const failure = functionDefinition(
      'fail_whatsapp_handoff_before_source_drain'
    );
    expect(failure).toContain('SECURITY DEFINER');
    expect(failure).toContain("SET search_path TO 'pg_catalog', 'public'");

    const workerLock = failure.indexOf('FROM public.worker AS worker');
    const runtimeLock = failure.indexOf(
      'FROM public.worker_runtime AS runtime'
    );
    const leaseLock = failure.indexOf(
      'FROM public.whatsapp_session_lease AS lease'
    );
    const sessionLock = failure.indexOf(
      'FROM public.whatsapp_session AS session'
    );
    const sourceRevisionLock = failure.indexOf(
      'FROM public.whatsapp_session_revision AS revision'
    );
    const targetRevisionLock = failure.indexOf(
      'FROM public.whatsapp_session_revision AS revision',
      sourceRevisionLock + 1
    );
    const handoffLock = failure.indexOf(
      'FROM public.whatsapp_session_handoff AS handoff'
    );
    expect(workerLock).toBeGreaterThanOrEqual(0);
    expect(runtimeLock).toBeGreaterThan(workerLock);
    expect(leaseLock).toBeGreaterThan(runtimeLock);
    expect(sessionLock).toBeGreaterThan(leaseLock);
    expect(sourceRevisionLock).toBeGreaterThan(sessionLock);
    expect(targetRevisionLock).toBeGreaterThan(sourceRevisionLock);
    expect(handoffLock).toBeGreaterThan(targetRevisionLock);
    for (const lockStart of [
      workerLock,
      runtimeLock,
      leaseLock,
      sessionLock,
      sourceRevisionLock,
      targetRevisionLock,
      handoffLock,
    ]) {
      expect(failure.slice(lockStart, lockStart + 650)).toContain(
        'FOR UPDATE;'
      );
    }

    expect(failure).toContain(
      "v_source_revision.status IS DISTINCT FROM 'active'"
    );
    expect(failure).toContain(
      'v_lease.generation IS DISTINCT FROM p_runtime_generation'
    );
    expect(failure).toContain('v_lease.expires_at > clock_timestamp()');
    expect(failure).toContain('v_lease.owner_id IS NULL');
    expect(failure).toContain('v_lease.provider IS NOT NULL');
    expect(failure).toContain('v_lease.expires_at IS NOT NULL');
    expect(failure).toContain(
      "v_handoff.state NOT IN ('requested', 'draining')"
    );
    expect(failure).toContain(
      'v_handoff.source_checkpoint_checksum_sha256 IS NOT NULL'
    );
    expect(failure).toContain('v_handoff.source_drained_at IS NOT NULL');
    expect(failure).toContain('v_handoff.point_of_no_return_at IS NOT NULL');
    expect(failure).toContain(
      'v_handoff.pre_activation_artifact_id IS NOT NULL'
    );
    expect(failure).toContain("SET status = 'failed'");
    expect(failure).toContain("SET state = 'ready'");
    expect(failure).toContain("SET state = 'failed'");
    expect(failure).toContain("v_handoff.state = 'failed'");
    expect(failure).toContain(
      "v_handoff.recovery_state IN ('pending', 'dispatching', 'running')"
    );
    expect(preDrainFailureMigration).toContain(
      'REVOKE ALL ON FUNCTION public.fail_whatsapp_handoff_before_source_drain('
    );
    expect(preDrainFailureMigration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.fail_whatsapp_handoff_before_source_drain/u
    );
  });

  it('serializes promotion, preserves equivalent provider JIDs and fences destructive clear', () => {
    const promotion = promotionImplementationDefinition();
    expect(promotion).toContain('FOR UPDATE OF handoff');
    expect(promotion).toContain(
      'whatsapp session handoff changed before completion'
    );
    expect(promotion).toContain('normalize_whatsapp_companion_jid');

    const clear = functionDefinition('clear_whatsapp_session');
    expect(clear).toContain('lease.provider = session.provider');
    expect(clear).toContain("session.state <> 'handoff'");

    const release = functionDefinition('release_whatsapp_session_lease');
    expect(release).not.toContain('session.provider = lower(trim(p_provider))');
    expect(release).not.toContain('active_handoff');
    expect(release).toContain('lease.fencing_token = p_fencing_token');
    expect(release).toContain('lease.owner_id IS NULL');
    expect(release).toContain('lease.provider IS NULL');
    expect(release).toContain('lease.epoch IS NULL');
    expect(release).toContain('lease.acquired_at IS NULL');
    expect(release).toContain('lease.heartbeat_at IS NULL');
    expect(release).toContain('lease.expires_at IS NULL');
    expect(release).toContain('RETURN EXISTS (');
  });

  it('binds operational Drizzle/Go access to one live worker and account per transaction', () => {
    const begin = functionDefinition('begin_whatsapp_worker_operation');
    expect(begin).toContain('p_worker_id uuid');
    expect(begin).toContain('p_account_id uuid');
    expect(begin).toContain('p_generation integer');
    expect(begin).toContain('p_writer_epoch uuid');
    expect(begin).toContain('p_capability text');
    expect(begin).toContain('p_container_id text');
    expect(begin).toContain('runtime.source_provider = v_provider');
    expect(begin).toContain('FOR SHARE OF worker, runtime');
    expect(begin).toContain('FOR SHARE OF session');
    expect(begin).toContain('issue_whatsapp_worker_scope_signature()');
    expect(
      functionDefinition('issue_whatsapp_worker_scope_signature')
    ).toContain("'app.whatsapp_worker_scope_signature'");

    const validity = functionDefinition(
      'whatsapp_worker_operation_scope_is_valid'
    );
    expect(validity).toContain("'worker-operation-v1'");
    expect(validity).toContain('pg_backend_pid()::text');
    expect(validity).toContain('txid_current()::text');
    expect(validity).toContain('session_user');
    expect(validity).toContain(
      "runtime.runtime_capability_hash =\n      encode(public.digest(scope.capability, 'sha256'), 'hex')"
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.issue_whatsapp_worker_scope_signature() FROM PUBLIC'
    );

    for (const table of [
      'account',
      'worker',
      'worker_runtime',
      'worker_config',
      'account_plan_product_entitlement_revision',
      'outbound_webhook',
      'outbound_webhook_event',
      'outbound_webhook_delivery',
      's3_backup_upload',
    ]) {
      expect(migration).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`
      );
    }
  });

  it('makes cross-worker event-id mutation and direct S3 addressing ineffective', () => {
    const eventPolicyStart = migration.indexOf(
      'CREATE POLICY whatsapp_worker_operation_scope ON public.outbound_webhook_event'
    );
    const deliveryPolicyStart = migration.indexOf(
      'CREATE POLICY whatsapp_worker_operation_scope ON public.outbound_webhook_delivery'
    );
    const eventPolicy = migration.slice(eventPolicyStart, deliveryPolicyStart);
    const deliveryPolicy = migration.slice(
      deliveryPolicyStart,
      migration.indexOf(
        'ALTER TABLE public.s3_backup_upload',
        deliveryPolicyStart
      )
    );
    expect(eventPolicy).toContain(
      "account_id = (SELECT nullif(current_setting('app.whatsapp_worker_account_id', true), '')::uuid)"
    );
    expect(eventPolicy).toContain(
      "ARRAY[(SELECT nullif(current_setting('app.whatsapp_worker_id', true), '')::uuid)]"
    );
    expect(eventPolicy).toContain('= ANY(routing_channel_ids)');
    expect(deliveryPolicy).toContain(
      'whatsapp_worker_scope_owns_event(outbound_webhook_event_id)'
    );
    expect(deliveryPolicy).toContain(
      'whatsapp_worker_scope_owns_webhook(outbound_webhook_id)'
    );

    const operationalGrantStart = migration.indexOf(
      '-- The same worker connection carries capability-fenced runtime status'
    );
    const operationalGrantEnd = migration.indexOf(
      'GRANT EXECUTE ON FUNCTION public.acquire_whatsapp_session_lease',
      operationalGrantStart
    );
    const operationalGrants = migration.slice(
      operationalGrantStart,
      operationalGrantEnd
    );
    expect(operationalGrants).not.toContain('public.s3_backup_upload');
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.register_whatsapp_worker_s3_backup('
    );
  });

  it('derives worker entitlement revisions server-side and hides sibling template associations', () => {
    const entitlementGuard = functionDefinition(
      'enforce_whatsapp_worker_entitlement_revision'
    );
    expect(entitlementGuard).toContain(
      'whatsapp_worker_operation_scope_is_valid()'
    );
    expect(entitlementGuard).toContain('NEW.allowed := v_underlying_allowed');
    expect(entitlementGuard).toContain('NEW.revision := CASE');
    expect(entitlementGuard).toContain(
      'NEW.deny_fence_token := OLD.deny_fence_token'
    );
    expect(migration).toContain(
      'CREATE TRIGGER account_plan_product_entitlement_revision_worker_guard'
    );
    expect(migration).toContain(
      'GRANT INSERT (\n  account_id,\n  plan_product_id,\n  revision,\n  allowed,\n  updated_at\n) ON TABLE public.account_plan_product_entitlement_revision'
    );
    expect(migration).toContain(
      'GRANT UPDATE (\n  revision,\n  allowed,\n  updated_at\n) ON TABLE public.account_plan_product_entitlement_revision'
    );
    expect(migration).not.toMatch(
      /GRANT INSERT, UPDATE ON TABLE\s+public\.account_plan_product_entitlement_revision/u
    );

    const templateOwnership = functionDefinition(
      'whatsapp_worker_scope_owns_template'
    );
    expect(templateOwnership).toContain(
      "association.channel_id =\n                nullif(current_setting('app.whatsapp_worker_id'"
    );
    expect(templateOwnership).toContain(
      'NOT EXISTS (\n              SELECT 1\n              FROM public.message_template_channel'
    );
    const templateChannelPolicy = migration.slice(
      migration.indexOf(
        'CREATE POLICY whatsapp_worker_operation_scope ON public.message_template_channel'
      ),
      migration.indexOf(
        'ALTER TABLE public.plan_account',
        migration.indexOf(
          'CREATE POLICY whatsapp_worker_operation_scope ON public.message_template_channel'
        )
      )
    );
    expect(templateChannelPolicy).toContain(
      "channel_id = (SELECT nullif(current_setting('app.whatsapp_worker_id', true), '')::uuid)"
    );
  });

  it('grants workers only the restricted runtime role entry points', () => {
    expect(migration).toContain('CREATE ROLE whatsapp_session_runtime');
    expect(migration).toContain(
      'NOLOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION'
    );
    expect(migration).toContain('NOBYPASSRLS');
    expect(migration).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE'
    );
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public.whatsapp_session_lease'
    );
    const broadStateGrant = migration.slice(
      migration.indexOf('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE'),
      migration.indexOf(
        'TO whatsapp_session_runtime;',
        migration.indexOf('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE')
      )
    );
    expect(broadStateGrant).not.toContain('public.whatsapp_session_lease');
    expect(broadStateGrant).not.toContain('public.whatsapp_session_revision');
    expect(broadStateGrant).not.toContain('public.whatsapp_session,');
    expect(broadStateGrant).not.toContain('public.whatsapp_session_handoff');
    expect(migration).toContain(
      'GRANT UPDATE (\n  last_persisted_at,\n  updated_at\n) ON TABLE public.whatsapp_session'
    );
    for (const functionName of [
      'acquire_whatsapp_session_lease',
      'renew_whatsapp_session_lease',
      'release_whatsapp_session_lease',
      'open_whatsapp_session_revision',
      'begin_whatsapp_session_operation',
      'begin_whatsapp_session_mutation',
      'begin_whatsapp_handoff_source_read',
      'begin_whatsapp_worker_operation',
      'promote_whatsapp_session_revision',
      'rollback_whatsapp_session_revision',
      'activate_whatsapp_runtime_fence',
      'apply_worker_runtime_status',
      'request_worker_self_heal',
      'read_whatsapp_worker_typing_config',
      'read_whatsapp_worker_call_config',
      'register_whatsapp_worker_s3_backup',
    ]) {
      expect(migration).toContain(
        `GRANT EXECUTE ON FUNCTION public.${functionName}(`
      );
    }
    for (const signature of [
      'hydrate_whatsapp_warm_runtime(uuid, text, text)',
      'apply_worker_runtime_status(uuid, uuid, text, integer, uuid, text, text, jsonb, uuid)',
      'request_worker_self_heal(uuid, uuid, text, integer, uuid, text, text, text, jsonb, text)',
    ]) {
      expect(migration).toContain(
        `REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC;`
      );
    }
    expect(migration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.request_whatsapp_provider_handoff\([\s\S]*?TO whatsapp_session_runtime/u
    );
  });

  it('finishes with the runtime fence on the generic header', () => {
    const functionStart = migration.lastIndexOf(
      'CREATE OR REPLACE FUNCTION public.activate_whatsapp_runtime_fence'
    );
    const activation = migration.slice(functionStart);
    expect(activation).toContain('public."whatsapp_session"');
    expect(activation).toContain('"session_id"');
    expect(activation).not.toContain('worker_' + 'whatsapp_session');
  });

  it('does not reintroduce the removed session-lock infrastructure', () => {
    const forbidden = [
      ['DB', 'PUBLIC', 'WHATSMEOW', 'LOCK', 'URL'].join('_'),
      ['DB', 'WHATSMEOW', 'LOCK', 'PASSWORD'].join('_'),
      ['WORKER', 'WHATSMEOW', 'LOCK', 'DATABASE', 'URL'].join('_'),
      ['whatsmeow', 'lock'].join('-'),
      ['underchat', 'whatsmeow', 'lock'].join('_'),
    ];
    const sources = [
      read('docker-compose.yml'),
      read('.env.example'),
      read('packages/services/worker.service.ts'),
      read('apps/worker_whatsmeow/internal/app/postgres.go'),
    ];

    for (const token of forbidden) {
      for (const source of sources) {
        expect(source).not.toContain(token);
      }
    }
    expect(
      read('apps/worker_whatsmeow/internal/app/postgres.go')
    ).not.toContain(['pg', 'try', 'advisory', 'lock'].join('_'));

    // Short transaction-scoped advisory locks remain valid for schema
    // installation/migrations on the normal migration connection. This guard
    // intentionally targets the long-lived runtime/session ownership path,
    // not pg_advisory_xact_lock in a standalone installer.
    expect(read('docs/runbooks/whatsapp-session-unification.md')).toContain(
      'serialização curta da instalação/migração do schema WhatsApp'
    );
  });
});
