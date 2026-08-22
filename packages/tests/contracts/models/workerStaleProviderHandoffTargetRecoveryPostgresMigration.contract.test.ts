import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260808120000.sql'),
  'utf8'
);

interface StaleTargetScenario {
  state: 'hydrating' | 'validating' | 'promoting' | 'activating';
  recoveryState: 'none' | 'pending';
  leaseExpiredBeyondGrace: boolean;
  pointOfNoReturn: boolean;
  preActivationArtifact: boolean;
  targetPromoted: boolean;
  targetStatus: 'staging' | 'validating' | 'active';
}

function mayFailStaleTarget(scenario: StaleTargetScenario): boolean {
  return (
    ['hydrating', 'validating'].includes(scenario.state) &&
    scenario.recoveryState === 'none' &&
    scenario.leaseExpiredBeyondGrace &&
    !scenario.pointOfNoReturn &&
    !scenario.preActivationArtifact &&
    !scenario.targetPromoted &&
    ['staging', 'validating'].includes(scenario.targetStatus)
  );
}

const eligible: StaleTargetScenario = {
  state: 'validating',
  recoveryState: 'none',
  leaseExpiredBeyondGrace: true,
  pointOfNoReturn: false,
  preActivationArtifact: false,
  targetPromoted: false,
  targetStatus: 'validating',
};

describe('stale PostgreSQL provider handoff target recovery migration', () => {
  it('exposes only a control-plane capability with a fixed search path and bounded locks', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.fail_stale_whatsapp_handoff_target('
    );
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain("SET search_path TO 'pg_catalog', 'public'");
    expect(migration).toContain("set_config('lock_timeout', '5s', true)");
    expect(migration).toContain("set_config('statement_timeout', '10s', true)");
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.fail_stale_whatsapp_handoff_target('
    );
    expect(migration).toContain(') FROM PUBLIC;');
    expect(migration).toContain(') FROM whatsapp_session_runtime;');
    expect(migration).toContain(') TO CURRENT_USER;');
  });

  it('locks the durable aggregate in the global order before mutation', () => {
    const workerLock = migration.indexOf(
      'FROM public.worker AS owner\n  WHERE owner.worker_id = p_session_id\n  FOR UPDATE;'
    );
    const runtimeLock = migration.indexOf(
      'FROM public.worker_runtime AS runtime\n  WHERE runtime.worker_id = p_session_id\n  FOR UPDATE;'
    );
    const leaseLock = migration.indexOf(
      'FROM public.whatsapp_session_lease AS lease\n  WHERE lease.session_id = p_session_id\n  FOR UPDATE;'
    );
    const sessionLock = migration.indexOf(
      'FROM public.whatsapp_session AS session\n  WHERE session.session_id = p_session_id\n  FOR UPDATE;'
    );
    const sourceRevisionLock = migration.indexOf('INTO v_source_revision');
    const targetRevisionLock = migration.indexOf('INTO v_target_revision');
    const handoffLock = migration.indexOf('INTO v_handoff\n');
    const targetMutation = migration.indexOf(
      'UPDATE public.whatsapp_session_revision AS target_revision'
    );

    expect(workerLock).toBeGreaterThanOrEqual(0);
    expect(runtimeLock).toBeGreaterThan(workerLock);
    expect(leaseLock).toBeGreaterThan(runtimeLock);
    expect(sessionLock).toBeGreaterThan(leaseLock);
    expect(sourceRevisionLock).toBeGreaterThan(sessionLock);
    expect(targetRevisionLock).toBeGreaterThan(sourceRevisionLock);
    expect(handoffLock).toBeGreaterThan(targetRevisionLock);
    expect(targetMutation).toBeGreaterThan(handoffLock);
  });

  it('matches only the exact stale pre-PONR target and preserves active or promoted targets', () => {
    for (const predicate of [
      "v_handoff.state NOT IN ('hydrating', 'validating')",
      'v_handoff.point_of_no_return_at IS NOT NULL',
      'v_handoff.pre_activation_artifact_id IS NOT NULL',
      "v_handoff.recovery_state <> 'none'",
      'v_handoff.recovery_operation_id IS NOT NULL',
      'v_runtime.recreate_bootstrap_operation_id IS DISTINCT FROM',
      'v_runtime.recreate_bootstrap_runtime_generation IS DISTINCT FROM',
      'v_runtime.recreate_bootstrap_container_id)) IS DISTINCT FROM',
      'v_runtime.recreate_bootstrap_started_at IS NULL',
      'v_runtime.recreate_retired_operation_id IS NOT NULL',
      'v_runtime.recreate_retired_runtime_generation IS NOT NULL',
      'v_runtime.recreate_retired_container_id IS NOT NULL',
      'v_runtime.recreate_retired_at IS NOT NULL',
      'v_runtime.native_connection_online_acknowledged IS NOT FALSE',
      "v_session.state <> 'handoff'",
      'v_session.active_revision_id IS DISTINCT FROM',
      "v_source_revision.status <> 'active'",
      "v_target_revision.status NOT IN ('staging', 'validating')",
      'v_target_revision.promoted_at IS NOT NULL',
      'v_lease.provider IS DISTINCT FROM v_handoff.target_provider',
      "v_lease.expires_at > clock_timestamp() - interval '5 seconds'",
    ]) {
      expect(migration).toContain(predicate);
    }

    expect(mayFailStaleTarget(eligible)).toBe(true);
    expect(
      mayFailStaleTarget({ ...eligible, leaseExpiredBeyondGrace: false })
    ).toBe(false);
    expect(mayFailStaleTarget({ ...eligible, pointOfNoReturn: true })).toBe(
      false
    );
    expect(
      mayFailStaleTarget({ ...eligible, preActivationArtifact: true })
    ).toBe(false);
    expect(
      mayFailStaleTarget({
        ...eligible,
        state: 'promoting',
        targetPromoted: true,
        targetStatus: 'active',
      })
    ).toBe(false);
    expect(mayFailStaleTarget({ ...eligible, state: 'activating' })).toBe(
      false
    );
  });

  it('fails target, restores source header, and schedules a distinct recovery atomically', () => {
    const targetUpdate = migration.indexOf(
      'UPDATE public.whatsapp_session_revision AS target_revision'
    );
    const sourceRestore = migration.indexOf(
      'UPDATE public.whatsapp_session AS session'
    );
    const handoffFailure = migration.indexOf(
      'UPDATE public.whatsapp_session_handoff AS handoff'
    );
    const recoveryProof = migration.indexOf(
      "IF v_handoff.recovery_state <> 'pending'"
    );

    expect(targetUpdate).toBeGreaterThanOrEqual(0);
    expect(sourceRestore).toBeGreaterThan(targetUpdate);
    expect(handoffFailure).toBeGreaterThan(sourceRestore);
    expect(recoveryProof).toBeGreaterThan(handoffFailure);
    expect(migration).toContain(
      "'whatsapp_handoff_target_lease_expired_before_promotion'"
    );
    expect(migration).toContain("SET status = 'failed'");
    expect(migration).toContain("state = 'ready'");
    expect(migration).toContain("SET state = 'failed'");
    expect(migration).toContain(
      'v_handoff.recovery_operation_id = p_lifecycle_operation_id'
    );
    expect(migration).toContain('v_handoff.recovery_next_attempt_at IS NULL');
    expect(migration).toContain(
      "RAISE EXCEPTION 'stale whatsapp handoff recovery was not scheduled'"
    );
  });

  it('permanently assigns the exact failed target journal to its distinct recovery', () => {
    const replayStart = migration.indexOf("IF v_handoff.state = 'failed'");
    const activeStart = migration.indexOf(
      'IF v_worker.worker_status_id IS DISTINCT FROM'
    );
    const replayBranch = migration.slice(replayStart, activeStart);

    expect(replayStart).toBeGreaterThanOrEqual(0);
    expect(activeStart).toBeGreaterThan(replayStart);
    expect(replayBranch).toContain(
      'v_handoff.error_code IS NOT DISTINCT FROM v_error_code'
    );
    expect(replayBranch).toContain("'blocked', 'cancelled', 'completed'");
    expect(replayBranch).toContain(
      'v_handoff.recovery_operation_id IS DISTINCT FROM'
    );
    expect(replayBranch).toContain("SELECT 'recovery_owned'::text");
    expect(replayBranch).toContain(
      'v_target_revision.error_code IS NOT DISTINCT FROM v_error_code'
    );
    expect(replayBranch).toContain('v_target_revision.retired_at IS NOT NULL');
    expect(replayBranch).not.toContain(
      'v_worker.lifecycle_operation_id IS DISTINCT FROM'
    );
    expect(replayBranch).not.toContain(
      'UPDATE public.whatsapp_session_revision AS target_revision'
    );
  });
});
