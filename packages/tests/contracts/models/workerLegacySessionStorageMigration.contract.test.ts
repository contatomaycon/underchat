import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (file: string) =>
  readFileSync(resolve(process.cwd(), file), 'utf8');

const migration = read('atlas/prod/20260814123000.sql');
const restorationMigration = read('atlas/prod/20260815045500.sql');
const completedRestorationMigration = read('atlas/prod/20260815060500.sql');
const orderedRevisionOpenMigration = read('atlas/prod/20260815072500.sql');
const retrySafeRevisionOpenMigration = read('atlas/prod/20260815074800.sql');
const restoredHandoffCleanupMigration = read('atlas/prod/20260816104500.sql');
const recoveryRequiredMigration = read('atlas/prod/20260816233000.sql');
const model = read(
  'packages/models/worker/workerWhatsappSessionStorageMigration.model.ts'
);
const repository = read(
  'packages/repositories/config/SessionStorageMigration.repository.ts'
);
const orchestrator = read(
  'packages/services/sessionStorageMigrationOrchestrator.service.ts'
);
const cleanup = read('packages/services/sessionStorageMigration.service.ts');
const workerProto = read('packages/proto/worker_connection.proto');
const commandProto = read('packages/proto/worker_command.proto');

describe('legacy-volume session storage migration contract', () => {
  it('journals one non-terminal migration per worker with exactly three attempts', () => {
    for (const state of [
      'queued',
      'capturing',
      'staged',
      'cutting_over',
      'starting',
      'validating',
      'retry_wait',
      'restoring',
      'restored',
      'cleanup_pending',
      'deleting_volume',
      'completed',
    ]) {
      expect(migration).toContain(`'${state}'`);
      expect(model).toContain(`'${state}'`);
    }
    expect(migration).toContain('max_attempts = 3');
    expect(recoveryRequiredMigration).toContain("'recovery_required'");
    expect(model).toContain("'recovery_required'");
    expect(recoveryRequiredMigration).toMatch(
      /CREATE UNIQUE INDEX whatsapp_session_storage_migration_active_worker_uidx[\s\S]+WHERE state NOT IN \('recovery_required', 'restored', 'completed'\)/u
    );
    expect(recoveryRequiredMigration).toContain(
      'whatsapp_session_storage_migration_recovery_required_check'
    );
    expect(recoveryRequiredMigration).toContain(
      "last_error_code = 'session_storage_migration_source_volume_missing'"
    );
    expect(orchestrator).toContain('const RETRY_BACKOFF_MS = [5_000, 15_000]');
    expect(orchestrator).toContain(
      'workerLifecycleBudgets.sessionStorageMigrationAttemptMs'
    );
    expect(orchestrator).toContain(
      'const CLAIM_LEASE_SECONDS = Math.ceil(ATTEMPT_TIMEOUT_MS / 1_000) + 30'
    );
    expect(orchestrator).toContain('latest.attempt_count >= 3');
  });

  it('keeps runtime access account/worker/migration scoped and never stores credentials in the journal', () => {
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain("current_setting('app.whatsapp_session_id'");
    expect(migration).toContain(
      "current_setting('app.whatsapp_storage_migration_id'"
    );
    expect(migration).toContain('FOREIGN KEY (account_id, worker_id)');
    for (const forbidden of [
      'credential_payload',
      'session_payload',
      'auth_payload',
      'private_key',
    ]) {
      expect(model).not.toContain(forbidden);
    }
  });

  it('admits and invalidates only the exact fenced migration revision', () => {
    expect(migration).toContain("source = 'legacy_volume_migration'");
    expect(migration).toContain('invalidate_legacy_volume_migration_revision');
    expect(migration).toContain("worker.session_storage = 'legacy_volume'");
    expect(migration).toContain("runtime.session_storage = 'legacy_volume'");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.invalidate_legacy_volume_migration_revision\([\s\S]+FROM whatsapp_session_runtime/u
    );
  });

  it('terminalizes only the pre-activation same-provider descendant of an exact restored volume migration', () => {
    expect(restoredHandoffCleanupMigration).toContain(
      'cleanup_restored_legacy_volume_migration_handoff'
    );
    for (const fence of [
      "NEW.state <> 'restored'",
      'handoff.source_provider = NEW.provider',
      'handoff.target_provider = NEW.provider',
      'handoff.lifecycle_operation_id IS NULL',
      'handoff.point_of_no_return_at IS NULL',
      'handoff.pre_activation_artifact_id IS NULL',
      "source.source = 'legacy_volume_migration'",
      "target.source = 'secure_import'",
      "worker.session_storage = 'legacy_volume'",
      "runtime.session_storage = 'legacy_volume'",
      'runtime.session_volume_name = NEW.source_volume_name',
      'runtime.native_connection_online_acknowledged',
      "session.state = 'empty'",
      'session.active_revision_id IS NULL',
      'session.previous_revision_id IS NULL',
    ]) {
      expect(restoredHandoffCleanupMigration).toContain(fence);
    }
    expect(restoredHandoffCleanupMigration).toContain(
      "error_code = 'legacy_volume_migration_restored'"
    );
    expect(restoredHandoffCleanupMigration).toContain(
      "recovery_state = 'cancelled'"
    );
    expect(restoredHandoffCleanupMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.cleanup_restored_legacy_volume_migration_handoff\(\)[\s\S]+FROM whatsapp_session_runtime/u
    );
  });

  it('opens and marks a reused legacy migration revision in separate ordered statements', () => {
    const opened = orderedRevisionOpenMigration.indexOf(
      'SELECT opened.revision_id, opened.status, opened.handoff_id'
    );
    const innerCall = orderedRevisionOpenMigration.indexOf(
      'FROM public.open_whatsapp_session_revision_pre_legacy_migration(',
      opened
    );
    const marked = orderedRevisionOpenMigration.indexOf(
      'UPDATE public.whatsapp_session_revision AS revision',
      innerCall
    );
    const markedCount = orderedRevisionOpenMigration.indexOf(
      'GET DIAGNOSTICS v_marked_count = ROW_COUNT;',
      marked
    );

    expect(opened).toBeGreaterThanOrEqual(0);
    expect(innerCall).toBeGreaterThan(opened);
    expect(marked).toBeGreaterThan(innerCall);
    expect(markedCount).toBeGreaterThan(marked);
    expect(orderedRevisionOpenMigration).not.toContain('WITH opened AS (');
    expect(orderedRevisionOpenMigration).not.toContain('), marked AS (');
    expect(orderedRevisionOpenMigration).toContain('v_marked_count <> 1');
    expect(orderedRevisionOpenMigration).toContain(
      'legacy volume migration revision marking fence changed'
    );
    expect(orderedRevisionOpenMigration).toContain(
      "migration.state IN (\n          'cutting_over', 'starting', 'validating', 'retry_wait'"
    );
    expect(orderedRevisionOpenMigration).toContain(
      "runtime.session_storage = 'postgres'"
    );
  });

  it('reuses only the exact fully materialized active migration revision on retry', () => {
    expect(retrySafeRevisionOpenMigration).toContain(
      'v_marked_count <> 1 AND NOT EXISTS'
    );
    for (const fence of [
      'session.active_revision_id = revision.revision_id',
      "revision.status = 'active'",
      "revision.source = 'legacy_volume_migration'",
      'revision.provider = lower(trim(p_provider))',
      'revision.schema_version = p_schema_version',
      'revision.codec_version = p_codec_version',
      'revision.format = p_format',
      'revision.checksum_sha256 IS NOT NULL',
      'revision.size_bytes > 0',
      'session.provider = lower(trim(p_provider))',
      "session.state = 'ready'",
      "v_status = 'active'",
      'v_handoff_id IS NULL',
    ]) {
      expect(retrySafeRevisionOpenMigration).toContain(fence);
    }
    expect(retrySafeRevisionOpenMigration).toContain(
      'legacy volume migration revision marking fence changed'
    );
  });

  it('restores the exact healthy legacy runtime and its control-plane fences atomically', () => {
    expect(restorationMigration).toContain(
      'FOR UPDATE OF migration, worker, runtime'
    );
    expect(restorationMigration).toContain(
      'worker.lifecycle_operation_id IS NOT DISTINCT FROM migration.lifecycle_operation_id'
    );
    expect(restorationMigration).toContain(
      "runtime.native_connection_public_status ->> 'status' = 'online'"
    );
    expect(restorationMigration).toContain(
      'native_connection_online_acknowledged = TRUE'
    );
    expect(restorationMigration).toContain('lifecycle_operation_id = NULL');
    expect(restorationMigration).toContain(
      "WHERE status.status IN ('online', 'recreating')"
    );
    expect(restorationMigration).toContain(
      'legacy volume restoration terminal state update failed'
    );
    const finalizer = repository.slice(
      repository.indexOf('async finalizeRestoration('),
      repository.indexOf('async beginLifecycle(')
    );
    expect(finalizer).toContain('this.dbRw.transaction');
    expect(finalizer).toContain(
      "eq(whatsappSessionStorageMigration.state, 'restoring')"
    );
    expect(finalizer).toContain(
      'eq(whatsappSessionStorageMigration.claim_token, claimToken)'
    );
    expect(finalizer).toContain("state: 'restored'");
    expect(finalizer).toContain('restored_at: sql`clock_timestamp()`');
  });

  it('accepts only the exact completed recreate operation and generation after lifecycle cleanup', () => {
    expect(completedRestorationMigration).toContain(
      'worker.recreate_completed_operation_id = migration.lifecycle_operation_id'
    );
    expect(completedRestorationMigration).toContain(
      'worker.recreate_completed_runtime_generation = runtime.runtime_generation'
    );
    expect(completedRestorationMigration).toContain(
      'worker.recreate_completed_operation_id = v_migration.lifecycle_operation_id'
    );
    expect(completedRestorationMigration).toContain(
      'worker.recreate_completed_runtime_generation = v_runtime_generation'
    );
    expect(completedRestorationMigration).toContain(
      'runtime.runtime_generation = v_runtime_generation'
    );
    expect(completedRestorationMigration).toContain(
      'FOR UPDATE OF migration, worker, runtime'
    );
  });

  it('extends worker preparation and health contracts without transporting session bytes', () => {
    for (const proto of [workerProto, commandProto]) {
      expect(proto).toContain('PrepareSessionStorageMigration');
      expect(proto).toContain('session_storage_migration_id');
      expect(proto).toContain('session_revision_id');
    }
    expect(workerProto).not.toMatch(/bytes\s+(session|auth|credential)_/u);
    expect(commandProto).toContain('DeleteLegacySessionVolume');
  });

  it('requires complete live health and proof-based volume absence', () => {
    for (const proof of [
      'authenticated',
      'session_ready',
      'can_send',
      'can_receive_runtime',
      'native_connection_valid',
      'kafka_ready',
      'command_ingress_ready',
      'command_ingress_authorized',
      'phone_matches',
      'identity_matches',
    ]) {
      expect(cleanup).toContain(`'${proof}'`);
    }
    expect(cleanup).toContain('countVolumeReferences');
    expect(cleanup).toContain('proof.volume_absent !== true');
    expect(cleanup).toContain('proof.mounted_container_count !== 0');
  });
});
