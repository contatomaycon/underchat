import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260807140000.sql'),
  'utf8'
);

const RECREATING = '019a930d-c6f6-766d-9c84-46093814d8e0';

interface RestartFenceScenario {
  workerVisible: boolean;
  runtimeIdentityMatches: boolean;
  warmLineageMatches: boolean;
  workerStatus: 'online' | 'recreating';
  runtimeMatchesWorkerPointer: boolean;
  storage: 'legacy_volume' | 'postgres';
  workerTypeMatchesSourceProvider: boolean;
  workerLifecycleOperationId: string | null;
  handoffLifecycleOperationId: string | null;
  runtimeSourceProvider: 'baileys' | 'whatsmeow' | 'wwebjs' | null;
  requestedProvider: 'baileys' | 'whatsmeow' | 'wwebjs';
  sessionState: 'handoff' | 'ready';
  sessionProvider: 'baileys' | 'whatsmeow' | 'wwebjs';
  sessionActiveRevisionId: number | null;
  headerRuntimeIdentityMatches: boolean;
  sourceRevisionId: number;
  sourceRevisionProvider: 'baileys' | 'whatsmeow' | 'wwebjs';
  sourceRevisionStatus:
    'active' | 'failed' | 'retired' | 'staging' | 'validating';
  sourceRevisionRuntimeIdentityMatches: boolean;
  handoffSourceProvider: 'baileys' | 'whatsmeow' | 'wwebjs';
  handoffTargetProvider: 'baileys' | 'whatsmeow' | 'wwebjs';
  targetRevisionId: number | null;
  handoffState: 'draining' | 'hydrating' | 'requested' | 'transforming';
  handoffErrorCode: string | null;
  checkpointClear: boolean;
  sourceDrainedAt: string | null;
  pointOfNoReturnAt: string | null;
  preActivationArtifactId: string | null;
  recoveryState: 'none' | 'pending';
  recoveryOperationId: string | null;
}

const OPERATION_ID = '019fdce8-7004-763a-bec6-09c8522d003c';

const validSourceRestart: RestartFenceScenario = {
  workerVisible: true,
  runtimeIdentityMatches: true,
  warmLineageMatches: true,
  workerStatus: 'recreating',
  runtimeMatchesWorkerPointer: true,
  storage: 'postgres',
  workerTypeMatchesSourceProvider: true,
  workerLifecycleOperationId: OPERATION_ID,
  handoffLifecycleOperationId: OPERATION_ID,
  runtimeSourceProvider: 'wwebjs',
  requestedProvider: 'wwebjs',
  sessionState: 'handoff',
  sessionProvider: 'wwebjs',
  sessionActiveRevisionId: 2060,
  headerRuntimeIdentityMatches: true,
  sourceRevisionId: 2060,
  sourceRevisionProvider: 'wwebjs',
  sourceRevisionStatus: 'active',
  sourceRevisionRuntimeIdentityMatches: true,
  handoffSourceProvider: 'wwebjs',
  handoffTargetProvider: 'baileys',
  targetRevisionId: 2063,
  handoffState: 'requested',
  handoffErrorCode: null,
  checkpointClear: true,
  sourceDrainedAt: null,
  pointOfNoReturnAt: null,
  preActivationArtifactId: null,
  recoveryState: 'none',
  recoveryOperationId: null,
};

function sourceHandoffRestartAuthorized(
  scenario: RestartFenceScenario
): boolean {
  return (
    scenario.storage === 'postgres' &&
    scenario.workerTypeMatchesSourceProvider &&
    scenario.workerLifecycleOperationId !== null &&
    scenario.workerLifecycleOperationId ===
      scenario.handoffLifecycleOperationId &&
    scenario.runtimeSourceProvider === scenario.requestedProvider &&
    scenario.sessionState === 'handoff' &&
    scenario.sessionProvider === scenario.requestedProvider &&
    scenario.sessionActiveRevisionId !== null &&
    scenario.headerRuntimeIdentityMatches &&
    scenario.sessionActiveRevisionId === scenario.sourceRevisionId &&
    scenario.sourceRevisionProvider === scenario.requestedProvider &&
    ['staging', 'validating', 'active'].includes(
      scenario.sourceRevisionStatus
    ) &&
    scenario.sourceRevisionRuntimeIdentityMatches &&
    scenario.handoffSourceProvider === scenario.requestedProvider &&
    scenario.handoffTargetProvider !== scenario.requestedProvider &&
    scenario.targetRevisionId !== null &&
    scenario.targetRevisionId !== scenario.sourceRevisionId &&
    ['requested', 'draining'].includes(scenario.handoffState) &&
    scenario.handoffErrorCode === null &&
    scenario.checkpointClear &&
    scenario.sourceDrainedAt === null &&
    scenario.pointOfNoReturnAt === null &&
    scenario.preActivationArtifactId === null &&
    scenario.recoveryState === 'none' &&
    scenario.recoveryOperationId === null
  );
}

function runtimeFenceActivates(scenario: RestartFenceScenario): boolean {
  if (
    !scenario.workerVisible ||
    !scenario.runtimeIdentityMatches ||
    !scenario.warmLineageMatches
  ) {
    return false;
  }
  if (
    scenario.workerStatus === 'recreating' &&
    (scenario.workerLifecycleOperationId === null ||
      (scenario.runtimeMatchesWorkerPointer &&
        !sourceHandoffRestartAuthorized(scenario)))
  ) {
    return false;
  }
  return true;
}

describe('activate_whatsapp_runtime_fence source handoff restart', () => {
  it('keeps the capability entry point signature and least-privilege ACL unchanged', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.activate_whatsapp_runtime_fence('
    );
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain("SET search_path TO 'pg_catalog', 'public'");
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.activate_whatsapp_runtime_fence('
    );
    expect(migration).toContain(') FROM PUBLIC;');
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.activate_whatsapp_runtime_fence('
    );
    expect(migration).toContain(') TO whatsapp_session_runtime;');
  });

  it('retains every immutable runtime and warm-lineage fence', () => {
    for (const predicate of [
      'v_runtime."container_id" = trim(p_container_id)',
      'v_runtime."runtime_generation" <> p_generation',
      'v_runtime."runtime_capability_hash" <> v_capability_hash',
      'v_runtime."session_storage" IS DISTINCT FROM v_worker_storage',
      'v_runtime."session_writer_epoch" IS DISTINCT FROM p_writer_epoch',
      'pool."reserved_by_worker_id" = p_worker_id',
      'pool."worker_type_id" = v_expected_worker_type',
      'pool."runtime_generation" = v_runtime."runtime_generation"',
      'pool."runtime_capability_hash" = v_runtime."runtime_capability_hash"',
      'pool."session_writer_epoch" = v_runtime."session_writer_epoch"',
      'pool."container_id" = v_runtime."container_id"',
    ]) {
      expect(migration).toContain(predicate);
    }
  });

  it('authorizes only the exact source lifecycle and active revision while requested or draining', () => {
    for (const predicate of [
      "v_worker_storage = 'postgres'",
      `v_worker_status_id = '${RECREATING}'::uuid`,
      'v_runtime."container_id" IS NOT DISTINCT FROM v_worker_container_id',
      'v_lifecycle_operation_id IS NOT NULL',
      'v_runtime."source_provider" = lower(trim(p_provider))',
      "v_header_state = 'handoff'",
      'v_header_provider = lower(trim(p_provider))',
      'v_header_active_revision_id IS NOT NULL',
      'v_header_generation = p_generation',
      'v_header_writer_epoch = p_writer_epoch',
      'v_header_capability_hash = v_capability_hash',
      'source_revision."revision_id" = v_header_active_revision_id',
      'source_revision."provider" = lower(trim(p_provider))',
      "source_revision.\"status\" IN ('staging', 'validating', 'active')",
      'source_revision."writer_generation" = p_generation',
      'source_revision."writer_epoch" = p_writer_epoch',
      'source_revision."capability_hash" = v_capability_hash',
      'source_handoff."lifecycle_operation_id" = v_lifecycle_operation_id',
      'source_handoff."source_provider" = lower(trim(p_provider))',
      'source_handoff."target_provider" <> lower(trim(p_provider))',
      'source_handoff."target_revision_id" IS NOT NULL',
      'source_handoff."target_revision_id" <>',
      "source_handoff.\"state\" IN ('requested', 'draining')",
      'source_handoff."error_code" IS NULL',
      'source_handoff."source_checkpoint_checksum_sha256" IS NULL',
      'source_handoff."source_checkpoint_size_bytes" IS NULL',
      'source_handoff."source_checkpoint_record_count" IS NULL',
      'source_handoff."source_drained_at" IS NULL',
      'source_handoff."point_of_no_return_at" IS NULL',
      'source_handoff."pre_activation_artifact_id" IS NULL',
      'source_handoff."recovery_state" = \'none\'',
      'source_handoff."recovery_operation_id" IS NULL',
    ]) {
      expect(migration).toContain(predicate);
    }
    expect(migration).toContain('AND NOT v_source_handoff_restart_authorized');
    expect(migration).toContain(
      'v_source_handoff_restart_authorized := COALESCE('
    );

    const recreateGuard = migration.slice(
      migration.lastIndexOf(
        `IF v_worker_status_id = '${RECREATING}'::uuid`,
        migration.indexOf('already_active := COALESCE(')
      ),
      migration.indexOf('already_active := COALESCE(')
    );
    expect(recreateGuard).toContain('v_lifecycle_operation_id IS NULL');
    expect(recreateGuard).toContain(
      'v_runtime."container_id" IS NOT DISTINCT FROM v_worker_container_id'
    );
    expect(recreateGuard).toContain(
      'AND NOT v_source_handoff_restart_authorized'
    );
  });

  it('locks the exact source authorization after runtime and warm identity, before activation', () => {
    const workerLock = migration.indexOf('FROM public."worker" AS w');
    const runtimeLock = migration.indexOf(
      'FROM public."worker_runtime" AS runtime'
    );
    const warmLock = migration.indexOf(
      'FROM public."worker_warm_pool" AS pool'
    );
    const sessionLock = migration.indexOf(
      'FROM public."whatsapp_session" AS session'
    );
    const revisionLock = migration.indexOf(
      'FROM public."whatsapp_session_revision" AS source_revision'
    );
    const handoffLock = migration.indexOf(
      'INNER JOIN public."whatsapp_session_handoff" AS source_handoff'
    );
    const activationUpdate = migration.indexOf(
      'UPDATE public."worker_runtime" AS runtime'
    );

    expect(workerLock).toBeGreaterThanOrEqual(0);
    expect(runtimeLock).toBeGreaterThan(workerLock);
    expect(warmLock).toBeGreaterThan(runtimeLock);
    expect(sessionLock).toBeGreaterThan(warmLock);
    expect(revisionLock).toBeGreaterThan(sessionLock);
    expect(handoffLock).toBeGreaterThan(revisionLock);
    expect(activationUpdate).toBeGreaterThan(handoffLock);
    expect(migration).toContain(
      'FOR SHARE OF source_revision, source_handoff;'
    );
  });

  it('recovers the exact source restart and preserves ordinary successor behavior', () => {
    expect(runtimeFenceActivates(validSourceRestart)).toBe(true);
    expect(
      runtimeFenceActivates({
        ...validSourceRestart,
        handoffState: 'draining',
      })
    ).toBe(true);
    expect(
      runtimeFenceActivates({
        ...validSourceRestart,
        sourceRevisionStatus: 'staging',
      })
    ).toBe(true);
    expect(
      runtimeFenceActivates({
        ...validSourceRestart,
        sourceRevisionStatus: 'validating',
      })
    ).toBe(true);
    expect(
      runtimeFenceActivates({
        ...validSourceRestart,
        runtimeMatchesWorkerPointer: false,
        sessionState: 'ready',
      })
    ).toBe(true);
    expect(
      runtimeFenceActivates({
        ...validSourceRestart,
        runtimeMatchesWorkerPointer: false,
        sessionState: 'ready',
        workerLifecycleOperationId: null,
        handoffLifecycleOperationId: null,
      })
    ).toBe(false);
    expect(
      runtimeFenceActivates({
        ...validSourceRestart,
        workerStatus: 'online',
        sessionState: 'ready',
        workerLifecycleOperationId: null,
        handoffLifecycleOperationId: null,
      })
    ).toBe(true);
  });

  it.each<[string, Partial<RestartFenceScenario>]>([
    ['legacy storage', { storage: 'legacy_volume' }],
    ['missing worker lifecycle', { workerLifecycleOperationId: null }],
    [
      'different lifecycle',
      {
        handoffLifecycleOperationId: '019fdce8-7004-763a-bec6-09c8522d003d',
      },
    ],
    ['target worker type', { workerTypeMatchesSourceProvider: false }],
    ['missing runtime provider', { runtimeSourceProvider: null }],
    ['target runtime provider', { runtimeSourceProvider: 'baileys' }],
    ['ready session', { sessionState: 'ready' }],
    ['target session provider', { sessionProvider: 'baileys' }],
    ['missing active revision', { sessionActiveRevisionId: null }],
    ['stale session writer identity', { headerRuntimeIdentityMatches: false }],
    ['different active revision', { sessionActiveRevisionId: 2061 }],
    ['target revision provider', { sourceRevisionProvider: 'baileys' }],
    [
      'stale source revision writer identity',
      { sourceRevisionRuntimeIdentityMatches: false },
    ],
    ['retired source revision', { sourceRevisionStatus: 'retired' }],
    ['failed source revision', { sourceRevisionStatus: 'failed' }],
    ['target handoff source', { handoffSourceProvider: 'baileys' }],
    ['same target provider', { handoffTargetProvider: 'wwebjs' }],
    ['missing target revision', { targetRevisionId: null }],
    ['source reused as target revision', { targetRevisionId: 2060 }],
    ['transforming handoff', { handoffState: 'transforming' }],
    ['hydrating handoff', { handoffState: 'hydrating' }],
    ['handoff error', { handoffErrorCode: 'source_failed' }],
    ['persisted checkpoint', { checkpointClear: false }],
    ['source already drained', { sourceDrainedAt: '2026-08-07T16:00:00Z' }],
    [
      'point of no return crossed',
      { pointOfNoReturnAt: '2026-08-07T16:00:00Z' },
    ],
    [
      'pre-activation artifact created',
      { preActivationArtifactId: '019fdce8-7004-763a-bec6-09c8522d003e' },
    ],
    ['recovery pending', { recoveryState: 'pending' }],
    [
      'recovery operation present',
      { recoveryOperationId: '019fdce8-7004-763a-bec6-09c8522d003f' },
    ],
  ])('rejects a same-pointer recreating runtime with %s', (_name, change) => {
    expect(runtimeFenceActivates({ ...validSourceRestart, ...change })).toBe(
      false
    );
  });

  it.each<[string, Partial<RestartFenceScenario>]>([
    ['worker ownership mismatch', { workerVisible: false }],
    ['runtime identity mismatch', { runtimeIdentityMatches: false }],
    ['warm lineage mismatch', { warmLineageMatches: false }],
  ])('does not bypass the pre-existing %s fence', (_name, change) => {
    expect(runtimeFenceActivates({ ...validSourceRestart, ...change })).toBe(
      false
    );
  });
});
