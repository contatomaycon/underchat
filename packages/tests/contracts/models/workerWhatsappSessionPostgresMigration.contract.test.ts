import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationFiles = [
  'atlas/prod/20260801120000.sql',
  'atlas/prod/20260801210000.sql',
  'atlas/prod/20260801211500.sql',
  'atlas/prod/20260801223500.sql',
  'atlas/prod/20260801224500.sql',
  'atlas/prod/20260802144500.sql',
  'atlas/prod/20260803120000.sql',
  'atlas/prod/20260804150000.sql',
  'atlas/prod/20260804151000.sql',
  'atlas/prod/20260808110000.sql',
  'atlas/prod/20260808120000.sql',
  'atlas/prod/20260809100000.sql',
  'atlas/prod/20260812110000.sql',
  'atlas/prod/20260812130000.sql',
  'atlas/prod/20260812210000.sql',
] as const;
const migration = migrationFiles
  .map((file) => readFileSync(resolve(process.cwd(), file), 'utf8'))
  .join('\n');
const unificationMigration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260802144500.sql'),
  'utf8'
);
const canonicalV17Migration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260803120000.sql'),
  'utf8'
);
const rollbackDiagnosticsMigration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260808110000.sql'),
  'utf8'
);
const lifecycleProfileAnchorAbiMigration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260812110000.sql'),
  'utf8'
);
const providerRollbackDiagnosticsMigration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260812130000.sql'),
  'utf8'
);
const secureImportReservationRollbackMigration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260819170000.sql'),
  'utf8'
);
const baileysSecureImportPromotionMigration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260819214500.sql'),
  'utf8'
);
const pristinePairingFingerprintPromotionMigration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260820151000.sql'),
  'utf8'
);
const whatsmeowSecureImportPromotionMigration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260820165000.sql'),
  'utf8'
);
const workerModel = readFileSync(
  resolve(process.cwd(), 'packages/models/worker/worker.model.ts'),
  'utf8'
);
const runtimeModel = readFileSync(
  resolve(process.cwd(), 'packages/models/worker/workerRuntime.model.ts'),
  'utf8'
);
const warmPoolModel = readFileSync(
  resolve(process.cwd(), 'packages/models/worker/workerWarmPool.model.ts'),
  'utf8'
);
const sessionModel = readFileSync(
  resolve(
    process.cwd(),
    'packages/models/worker/workerWhatsappSession.model.ts'
  ),
  'utf8'
);
const storeModel = readFileSync(
  resolve(process.cwd(), 'packages/models/worker/whatsappSqlStore.model.ts'),
  'utf8'
);

function migrationFunction(name: string): string {
  const source =
    name === 'rollback_whatsapp_session_revision'
      ? rollbackDiagnosticsMigration
      : migration;
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start =
    name === 'rollback_whatsapp_session_revision'
      ? source.indexOf(marker)
      : source.lastIndexOf(marker);
  if (start < 0) {
    throw new Error(`migration function ${name} was not found`);
  }
  const end = source.indexOf('$function$;', start);
  if (end < 0) {
    throw new Error(`migration function ${name} is not terminated`);
  }
  return source.slice(start, end + '$function$;'.length);
}

function lifecycleProfileAnchorAbiFunction(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = lifecycleProfileAnchorAbiMigration.indexOf(marker);
  if (start < 0) {
    throw new Error(`profile-anchor lifecycle function ${name} was not found`);
  }
  const end = lifecycleProfileAnchorAbiMigration.indexOf('$function$;', start);
  if (end < 0) {
    throw new Error(
      `profile-anchor lifecycle function ${name} is not terminated`
    );
  }
  return lifecycleProfileAnchorAbiMigration.slice(
    start,
    end + '$function$;'.length
  );
}

describe('PostgreSQL WhatsApp session schema', () => {
  it('backfills existing workers and leaves the final default on PostgreSQL', () => {
    expect(migration).toContain(`SET "session_storage" = 'legacy_volume'`);
    expect(migration).toContain(
      `ALTER COLUMN "session_storage" SET DEFAULT 'postgres'`
    );
    expect(migration).toContain(
      `CHECK ("session_storage" IN ('legacy_volume', 'postgres'))`
    );
    expect(workerModel).toContain('.default(EWorkerSessionStorage.postgres)');
  });

  it('enforces the exact volume/backend invariant in runtimes and warm pools', () => {
    for (const source of [migration, runtimeModel, warmPoolModel]) {
      expect(source).toContain("'legacy_volume'");
      expect(source).toContain("'postgres'");
      expect(source).toMatch(/session_volume_name[\s\S]+IS NOT NULL/u);
      expect(source).toMatch(/session_volume_name[\s\S]+IS NULL/u);
    }
    expect(migration).toContain(
      'ALTER COLUMN "session_volume_name" DROP NOT NULL'
    );
  });

  it('owns revisions, provider records and artifacts through the generic family', () => {
    for (const table of [
      'whatsapp_session',
      'whatsapp_session_revision',
      'whatsapp_session_lease',
      'whatsapp_session_gc_queue',
      'whatsapp_provider_record',
      'whatsapp_artifact',
      'whatsapp_artifact_blob',
      'whatsapp_artifact_chunk',
      'whatsapp_session_handoff',
    ]) {
      expect(unificationMigration).toContain(
        `CREATE TABLE "public"."${table}"`
      );
      expect(sessionModel).toContain(`'${table}'`);
    }

    expect(unificationMigration).toContain('"active_revision_id" bigint');
    expect(unificationMigration).toContain('"previous_revision_id" bigint');
    expect(unificationMigration).toContain('"revision_id" bigserial NOT NULL');
    expect(unificationMigration).toContain('"epoch" uuid');
    expect(unificationMigration).toContain(
      '"fencing_token" bigint NOT NULL DEFAULT 0'
    );
    expect(unificationMigration).toContain('size_bytes <= 536870912');
    expect(unificationMigration).toContain('size_bytes <= 1048576');
  });

  it('keeps handoff revision cascades aligned between Atlas and Drizzle', () => {
    for (const constraint of [
      'whatsapp_session_handoff_source_revision_fk',
      'whatsapp_session_handoff_target_revision_fk',
    ]) {
      expect(unificationMigration).toMatch(
        new RegExp(`${constraint}[\\s\\S]+ON DELETE CASCADE`, 'u')
      );
      expect(sessionModel).toMatch(
        new RegExp(`${constraint}[\\s\\S]+onDelete\\('cascade'\\)`, 'u')
      );
    }
  });

  it('keeps canonical fingerprint version types aligned', () => {
    expect(canonicalV17Migration).toContain(
      'ADD COLUMN active_device_fingerprint_version varchar(80)'
    );
    expect(canonicalV17Migration).toContain(
      'fingerprint_version varchar(80) NOT NULL'
    );
    expect(sessionModel).toContain(
      'active_device_fingerprint_version: varchar({ length: 80 })'
    );
    expect(sessionModel).toContain(
      'fingerprint_version: varchar({ length: 80 }).notNull()'
    );
  });

  it('upgrades SQLStore to v17 with session/revision ownership and no JID uniqueness', () => {
    expect(unificationMigration).toContain(
      'CREATE TABLE "public"."whatsapp_store_version"'
    );
    expect(unificationMigration).toContain(
      'INSERT INTO public."whatsapp_store_version" ("version", "compat") VALUES (16, 16)'
    );
    expect(canonicalV17Migration).toContain('SET version = 17, compat = 17');
    expect(canonicalV17Migration).toContain(
      'CHECK (version = 17 AND compat = 17)'
    );
    expect(canonicalV17Migration).toContain(
      'PRIMARY KEY (session_id, revision_id, their_id, scope)'
    );
    expect(storeModel).toContain(
      'sql`${table.version} = 17 AND ${table.compat} = 17`'
    );
    expect(unificationMigration).toContain(
      'PRIMARY KEY ("session_id", "revision_id")'
    );
    expect(unificationMigration).toContain(
      'ON "public"."whatsapp_device" ("jid", "session_id")'
    );
    expect(unificationMigration).not.toContain(
      'CREATE UNIQUE INDEX "whatsapp_device_jid'
    );
    expect(storeModel).toContain("'whatsapp_device'");
    expect(storeModel).toContain("'whatsapp_lid_map'");
    expect(storeModel).toContain('session_id: uuid().notNull()');
    expect(storeModel).toContain(
      "revision_id: bigint({ mode: 'number' }).notNull()"
    );
  });

  it('uses capability-fenced SQL functions for Node and Go', () => {
    for (const functionName of [
      'acquire_whatsapp_session_lease',
      'renew_whatsapp_session_lease',
      'release_whatsapp_session_lease',
      'begin_whatsapp_session_operation',
      'begin_whatsapp_session_mutation',
      'create_whatsapp_session_candidate',
      'open_whatsapp_session_revision',
      'finalize_whatsapp_session_pairing',
      'commit_whatsapp_session_activation',
      'finalize_whatsapp_session_activation',
      'rollback_whatsapp_session_revision',
      'clear_whatsapp_session',
      'hydrate_whatsapp_warm_runtime',
      'activate_whatsapp_runtime_fence',
      'apply_worker_runtime_status',
      'request_worker_self_heal',
    ]) {
      expect(migration).toContain(
        `CREATE OR REPLACE FUNCTION public.${functionName}`
      );
    }
    expect(migration).toContain("public.digest(p_capability, 'sha256')");
    expect(migration).toContain("trim(p_container_id) !~ '^[0-9a-f]{12,64}$'");

    for (const functionName of [
      'finalize_whatsapp_session_pairing',
      'commit_whatsapp_session_activation',
      'finalize_whatsapp_session_activation',
      'rollback_whatsapp_session_revision',
    ]) {
      const definition = lifecycleProfileAnchorAbiFunction(functionName);
      expect(definition).toContain('begin_whatsapp_session_mutation');
      expect(definition).not.toContain('begin_whatsapp_session_operation');
      expect(definition).toContain("'profile-anchor-canonical-checkpoint-v1'");
    }
    expect(lifecycleProfileAnchorAbiMigration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.promote_whatsapp_session_revision_v17_impl[\s\S]+?'profile-anchor-canonical-checkpoint-v1'/u
    );

    const activation = migrationFunction('activate_whatsapp_runtime_fence');
    expect(activation).toContain('FROM public."whatsapp_session" AS session');
    expect(activation).toContain('ON CONFLICT ("session_id") DO UPDATE');
    expect(activation).toContain('"generation" = EXCLUDED."generation"');
    expect(activation).toContain('"epoch" = EXCLUDED."epoch"');
    expect(activation).not.toContain('worker_' + 'whatsapp_session');
  });

  it('persists one sanitized rollback cause atomically without breaking the old ABI', () => {
    const rollback = migrationFunction('rollback_whatsapp_session_revision');
    const workerLock = rollback.indexOf('FROM public.worker AS worker');
    const mutationFence = rollback.indexOf(
      'PERFORM public.begin_whatsapp_session_mutation('
    );
    const handoffLock = rollback.indexOf(
      'FROM public.whatsapp_session_handoff AS handoff'
    );
    const candidateUpdate = rollback.indexOf(
      'UPDATE public.whatsapp_session_revision'
    );

    expect(rollback).toContain('p_error_code text');
    expect(rollback).toContain(
      "p_error_code ~* '^(handoff|whatsapp|wwebjs)_[a-z0-9_.-]{1,91}$'"
    );
    expect(rollback).toContain("ELSE 'handoff_validation_failed'");
    expect(rollback.match(/error_code = v_error_code/gu)).toHaveLength(2);
    expect(rollback).not.toContain('COALESCE(error_code');
    expect(workerLock).toBeGreaterThan(-1);
    expect(mutationFence).toBeGreaterThan(workerLock);
    expect(handoffLock).toBeGreaterThan(mutationFence);
    expect(candidateUpdate).toBeGreaterThan(handoffLock);

    const compatibilityWrapper = rollbackDiagnosticsMigration.slice(
      rollbackDiagnosticsMigration.lastIndexOf(
        'CREATE OR REPLACE FUNCTION public.rollback_whatsapp_session_revision'
      )
    );
    expect(compatibilityWrapper).toContain('LANGUAGE sql');
    expect(compatibilityWrapper).toContain("'handoff_validation_failed'");
    expect(rollbackDiagnosticsMigration).not.toContain('DROP FUNCTION');
    expect(rollbackDiagnosticsMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.rollback_whatsapp_session_revision\([\s\S]*?text, text[\s\S]*?\) FROM PUBLIC;/u
    );
    expect(rollbackDiagnosticsMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.rollback_whatsapp_session_revision\([\s\S]*?text, text[\s\S]*?\) TO whatsapp_session_runtime;/u
    );
  });

  it('retains sanitized failure codes emitted by every PostgreSQL WhatsApp provider', () => {
    expect(providerRollbackDiagnosticsMigration).toContain(
      "p_error_code ~* '^(handoff|whatsapp|wwebjs|baileys|whatsmeow)_[a-z0-9_.:-]{1,90}$'"
    );
    expect(providerRollbackDiagnosticsMigration).toContain(
      "ELSE 'handoff_validation_failed'"
    );
    expect(providerRollbackDiagnosticsMigration).not.toContain(
      'COALESCE(error_code'
    );
    expect(providerRollbackDiagnosticsMigration).toContain(
      "'profile-anchor-canonical-checkpoint-v1'"
    );
    expect(providerRollbackDiagnosticsMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.rollback_whatsapp_session_revision\([\s\S]*?text, text[\s\S]*?\) FROM PUBLIC;/u
    );
    expect(providerRollbackDiagnosticsMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.rollback_whatsapp_session_revision\([\s\S]*?text, text[\s\S]*?\) TO whatsapp_session_runtime;/u
    );
  });

  it('releases a rejected secure-import identity after restoring an empty pairing draft', () => {
    expect(secureImportReservationRollbackMigration).toContain(
      'CREATE OR REPLACE FUNCTION public.release_empty_whatsapp_companion_v17()'
    );
    expect(secureImportReservationRollbackMigration).toContain(
      "OLD.state = 'handoff'"
    );
    expect(secureImportReservationRollbackMigration).toContain(
      "NEW.state = 'preparing'"
    );
    expect(secureImportReservationRollbackMigration).toContain(
      "source_revision.source = 'pairing'"
    );
    expect(secureImportReservationRollbackMigration).toContain(
      "source_revision.status IN ('staging', 'validating')"
    );
    expect(secureImportReservationRollbackMigration).toContain(
      "target_revision.source = 'secure_import'"
    );
    expect(secureImportReservationRollbackMigration).toContain(
      "target_revision.status = 'failed'"
    );
    expect(secureImportReservationRollbackMigration).toContain(
      'handoff.lifecycle_operation_id IS NULL'
    );
    expect(secureImportReservationRollbackMigration).toContain(
      'reservation.device_fingerprint ='
    );
    expect(secureImportReservationRollbackMigration).toContain(
      'target_device.device_fingerprint'
    );
    expect(secureImportReservationRollbackMigration).toContain(
      'DELETE FROM public.whatsapp_companion_reservation AS reservation'
    );
    expect(secureImportReservationRollbackMigration).toContain(
      'USING public.whatsapp_session AS session'
    );
    expect(secureImportReservationRollbackMigration).toContain(
      "handoff.state = 'failed'"
    );
    expect(
      secureImportReservationRollbackMigration.match(
        /source_revision\.status IN \('staging', 'validating'\)/gu
      )
    ).toHaveLength(3);
  });

  it('allows WWebJS secure import only from a pristine pairing source', () => {
    expect(secureImportReservationRollbackMigration).toContain(
      'CREATE OR REPLACE FUNCTION public.promote_whatsapp_session_revision_v17_impl'
    );
    expect(secureImportReservationRollbackMigration).toContain(
      'v_source_is_empty_pairing boolean := false'
    );
    expect(secureImportReservationRollbackMigration).toContain(
      "v_source_provider = 'wwebjs'"
    );
    expect(secureImportReservationRollbackMigration).toContain(
      "v_target_provider = 'wwebjs'"
    );
    expect(secureImportReservationRollbackMigration).toContain(
      "v_target_source = 'secure_import'"
    );
    expect(secureImportReservationRollbackMigration).toContain(
      "source_revision.source = 'pairing'"
    );
    expect(secureImportReservationRollbackMigration).toContain(
      "source_revision.status IN ('staging', 'validating')"
    );
    for (const table of [
      'whatsapp_device',
      'whatsapp_artifact',
      'whatsapp_provider_record',
      'whatsapp_identity_keys',
      'whatsapp_signal_sessions',
      'whatsapp_app_state_sync_keys',
      'whatsapp_event_buffer',
      'whatsapp_retry_buffer',
    ]) {
      expect(secureImportReservationRollbackMigration).toContain(
        `FROM public.${table} AS state`
      );
    }
    expect(secureImportReservationRollbackMigration).toContain(
      'IF NOT v_source_is_empty_pairing'
    );
    expect(secureImportReservationRollbackMigration).toContain(
      'v_device_fingerprint IS DISTINCT FROM v_source_fingerprint'
    );
  });

  it('allows Baileys secure import only from a never-linked pairing draft', () => {
    expect(baileysSecureImportPromotionMigration).toContain(
      'CREATE OR REPLACE FUNCTION public.promote_whatsapp_session_revision_v17_impl'
    );
    expect(baileysSecureImportPromotionMigration).toContain(
      'v_source_is_pristine_baileys_pairing boolean := false'
    );
    expect(baileysSecureImportPromotionMigration).toContain(
      "v_source_provider = 'baileys'"
    );
    expect(baileysSecureImportPromotionMigration).toContain(
      "v_target_provider = 'baileys'"
    );
    expect(baileysSecureImportPromotionMigration).toContain(
      "source_revision.source = 'pairing'"
    );
    expect(baileysSecureImportPromotionMigration).toContain(
      'session.previous_revision_id IS NULL'
    );
    expect(baileysSecureImportPromotionMigration).toContain(
      'session.active_device_fingerprint IS NULL'
    );
    for (const linkedIdentityField of [
      'source_device.jid IS NOT NULL',
      'source_device.lid IS NOT NULL',
      'source_device.facebook_uuid IS NOT NULL',
      'source_device.adv_details IS NOT NULL',
      'source_device.adv_account_sig IS NOT NULL',
      'source_device.adv_account_sig_key IS NOT NULL',
      'source_device.adv_device_sig IS NOT NULL',
      'source_device.device_fingerprint IS NOT NULL',
      'source_device.fingerprint_version IS NOT NULL',
    ]) {
      expect(baileysSecureImportPromotionMigration).toContain(
        linkedIdentityField
      );
    }
    expect(baileysSecureImportPromotionMigration).toContain(
      'IF NOT (v_source_is_empty_pairing OR v_source_is_pristine_baileys_pairing)'
    );
    expect(baileysSecureImportPromotionMigration).toContain(
      'v_device_fingerprint IS DISTINCT FROM v_source_fingerprint'
    );
  });

  it('reuses the empty pairing promotion gate for the first WhatsMeow secure import', () => {
    expect(whatsmeowSecureImportPromotionMigration).toContain(
      'CREATE OR REPLACE FUNCTION public.promote_whatsapp_session_revision_v17_impl'
    );
    expect(whatsmeowSecureImportPromotionMigration).toContain(
      "v_source_provider IN ('wwebjs', 'whatsmeow')"
    );
    expect(whatsmeowSecureImportPromotionMigration).toContain(
      'v_target_provider = v_source_provider'
    );
    expect(whatsmeowSecureImportPromotionMigration).toContain(
      'session.provider = v_source_provider'
    );
    expect(whatsmeowSecureImportPromotionMigration).toContain(
      'source_revision.provider = v_source_provider'
    );
    expect(whatsmeowSecureImportPromotionMigration).toContain(
      'handoff.source_provider = v_source_provider'
    );
    expect(whatsmeowSecureImportPromotionMigration).toContain(
      'handoff.target_provider = v_source_provider'
    );
    expect(whatsmeowSecureImportPromotionMigration).toContain(
      "v_target_source = 'secure_import'"
    );
    expect(whatsmeowSecureImportPromotionMigration).toContain(
      'handoff.lifecycle_operation_id IS NULL'
    );
    for (const table of [
      'whatsapp_device',
      'whatsapp_artifact',
      'whatsapp_provider_record',
      'whatsapp_identity_keys',
      'whatsapp_pre_keys',
      'whatsapp_pq_pre_keys',
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
    ]) {
      expect(whatsmeowSecureImportPromotionMigration).toContain(
        `FROM public.${table} AS state`
      );
    }
    expect(whatsmeowSecureImportPromotionMigration).toContain(
      'IF NOT (v_source_is_empty_pairing OR v_source_is_pristine_baileys_pairing)'
    );
    expect(whatsmeowSecureImportPromotionMigration).toContain(
      'v_device_fingerprint IS DISTINCT FROM v_source_fingerprint'
    );
    expect(whatsmeowSecureImportPromotionMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.promote_whatsapp_session_revision_v17_impl\([\s\S]*FROM PUBLIC, whatsapp_session_runtime;/u
    );
  });

  it('treats an unversioned pristine pairing draft as the first v2 identity assignment', () => {
    expect(pristinePairingFingerprintPromotionMigration).toContain(
      'CREATE OR REPLACE FUNCTION public.guard_whatsapp_session_fingerprint_v17()'
    );
    expect(pristinePairingFingerprintPromotionMigration).toContain(
      'IF v_previous_fingerprint_version IS NULL THEN'
    );
    expect(pristinePairingFingerprintPromotionMigration).toContain(
      'OLD.active_device_fingerprint IS NOT NULL'
    );
    expect(pristinePairingFingerprintPromotionMigration).toContain(
      'OLD.active_device_fingerprint_version IS NOT NULL'
    );
    expect(pristinePairingFingerprintPromotionMigration).toContain(
      'ELSIF v_previous_fingerprint_version IS DISTINCT FROM v_fingerprint_version THEN'
    );
    expect(pristinePairingFingerprintPromotionMigration).toContain(
      "v_fingerprint_version <> 'underchat-whatsapp-device-fingerprint-v2'"
    );
    expect(pristinePairingFingerprintPromotionMigration).not.toMatch(
      /^\s+IF v_previous_fingerprint_version IS DISTINCT FROM v_fingerprint_version THEN$/mu
    );
    expect(pristinePairingFingerprintPromotionMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.guard_whatsapp_session_fingerprint_v17\(\)\s+FROM PUBLIC;/u
    );
  });

  it('persists status outbox and deduplicated self-healing requests', () => {
    for (const table of [
      'worker_runtime_event_outbox',
      'worker_self_heal_request',
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
      expect(sessionModel).toContain(`'${table}'`);
    }
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "worker_runtime_event_outbox_event_id_uidx"'
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "worker_self_heal_request_active_uidx"'
    );
    expect(migration).toContain(`WHERE "state" = 'pending'`);
    expect(migration).toContain(
      `WHERE "state" IN ('queued', 'processing', 'dispatched')`
    );
  });
});
