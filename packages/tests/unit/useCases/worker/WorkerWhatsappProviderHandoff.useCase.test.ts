import 'reflect-metadata';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import type { WhatsappProviderHandoffDecisionSnapshot } from '@core/repositories/worker/WorkerRuntime.repository';
import { WorkerWhatsappProviderHandoffUseCase } from '@core/useCases/worker/WorkerWhatsappProviderHandoff.useCase';

const t = ((key: string) => key) as never;

function snapshot(
  overrides: Partial<WhatsappProviderHandoffDecisionSnapshot> = {}
): WhatsappProviderHandoffDecisionSnapshot {
  return {
    worker_id: 'worker-1',
    account_id: 'account-1',
    worker_type_id: EWorkerType.whatsmeow,
    worker_status_id: EWorkerStatus.online,
    worker_server_id: 'server-1',
    worker_session_storage: EWorkerSessionStorage.postgres,
    worker_lifecycle_operation_id: null,
    worker_container_id: 'container-1',
    handoff_id: 'handoff-1',
    handoff_lifecycle_operation_id: 'original-operation',
    source_provider: 'whatsmeow',
    target_provider: 'baileys',
    source_revision_id: '10',
    target_revision_id: '11',
    state: 'failed',
    error_code: 'target_validation_failed',
    recovery_state: 'completed',
    recovery_operation_id: 'recovery-1',
    recovery_last_error_code: null,
    resolution_action: null,
    resolution_state: null,
    resolution_operation_id: null,
    resolution_last_error_code: null,
    resolution_requested_at: null,
    resolution_updated_at: null,
    resolution_cleanup_finalized_at: null,
    resolution_completed_at: null,
    session_provider: 'whatsmeow',
    session_state: 'ready',
    active_revision_id: '10',
    session_generation: 4,
    session_epoch: 'epoch-1',
    session_capability_hash: 'capability-1',
    runtime_container_id: 'container-1',
    runtime_session_storage: EWorkerSessionStorage.postgres,
    runtime_generation: 4,
    runtime_capability_hash: 'capability-1',
    runtime_writer_epoch: 'epoch-1',
    runtime_source_provider: 'whatsmeow',
    runtime_connection_activated_at: '2026-08-05T00:00:00Z',
    runtime_online_acknowledged: true,
    runtime_status_lease_owner_id: 'owner-1',
    runtime_status_fencing_token: '8',
    lease_provider: 'whatsmeow',
    lease_generation: 4,
    lease_epoch: 'epoch-1',
    lease_owner_id: 'owner-1',
    lease_fencing_token: '8',
    lease_expires_at: '2026-08-05T00:00:30Z',
    database_now: '2026-08-05T00:00:00Z',
    created_at: '2026-08-05T00:00:00Z',
    updated_at: '2026-08-05T00:00:01Z',
    ...overrides,
  };
}

type ResolutionClaim = {
  outcome:
    | 'claimed'
    | 'idempotent'
    | 'conflict'
    | 'not_found'
    | 'handoff_completed'
    | 'handoff_in_progress'
    | 'source_revision_unavailable'
    | 'source_runtime_not_restored'
    | 'source_runtime_identity_unavailable'
    | 'return_recovery_quiescing';
  resolution_state: 'running' | 'completed' | null;
  operation_id: string | null;
};

function build(
  snapshotValue = snapshot(),
  options: {
    decisions?: Array<WhatsappProviderHandoffDecisionSnapshot | null>;
    discardClaim?:
      ResolutionClaim | ((input: { operation_id: string }) => ResolutionClaim);
    returnClaim?:
      ResolutionClaim | ((input: { operation_id: string }) => ResolutionClaim);
    recoveryRedrive?: () => Promise<unknown>;
  } = {}
) {
  const hasResolution = snapshotValue.resolution_action !== null;
  const sourceLifecycleCanBeDiscarded =
    (snapshotValue.worker_status_id === EWorkerStatus.online &&
      snapshotValue.worker_lifecycle_operation_id === null) ||
    (snapshotValue.worker_status_id === EWorkerStatus.recreating &&
      snapshotValue.worker_lifecycle_operation_id !== null &&
      ((!hasResolution &&
        snapshotValue.worker_lifecycle_operation_id ===
          snapshotValue.handoff_lifecycle_operation_id) ||
        (snapshotValue.resolution_action === 'return' &&
          snapshotValue.resolution_state === 'running' &&
          (snapshotValue.worker_lifecycle_operation_id ===
            snapshotValue.resolution_operation_id ||
            snapshotValue.worker_lifecycle_operation_id ===
              snapshotValue.recovery_operation_id))));
  const sourceRuntimeCanBeDiscarded =
    snapshotValue.worker_session_storage === EWorkerSessionStorage.postgres &&
    snapshotValue.runtime_session_storage === EWorkerSessionStorage.postgres &&
    snapshotValue.worker_type_id ===
      EWorkerType[snapshotValue.source_provider] &&
    snapshotValue.runtime_source_provider === snapshotValue.source_provider &&
    Boolean(snapshotValue.runtime_container_id) &&
    sourceLifecycleCanBeDiscarded;
  const decisions = options.decisions ?? [snapshotValue];
  let decisionIndex = 0;
  const runtimeRepository = {
    viewWhatsappProviderHandoffDecision: jest.fn(async () => {
      const decision =
        decisions[Math.min(decisionIndex, decisions.length - 1)] ?? null;
      decisionIndex += 1;
      return decision;
    }),
    claimWhatsappProviderHandoffReturn: jest.fn(
      async (input: { operation_id: string }) => {
        const configured = options.returnClaim;
        if (typeof configured === 'function') return configured(input);
        return (
          configured ?? {
            outcome: 'claimed',
            resolution_state: 'completed',
            operation_id: input.operation_id,
          }
        );
      }
    ),
    claimWhatsappProviderHandoffDiscard: jest.fn(
      async (input: { operation_id: string }) => {
        const configured = options.discardClaim;
        if (typeof configured === 'function') return configured(input);
        return (
          configured ?? {
            outcome: sourceRuntimeCanBeDiscarded
              ? 'claimed'
              : 'source_runtime_identity_unavailable',
            resolution_state: 'running',
            operation_id: sourceRuntimeCanBeDiscarded
              ? input.operation_id
              : null,
          }
        );
      }
    ),
  };
  const lifecycleQueue = {
    prepare: jest.fn(async (_message: unknown) => undefined),
    publish: jest.fn(async (_message: unknown) => undefined),
    redrivePrepared: jest.fn(
      async (_workerId: string, _operationId: string) => []
    ),
  };
  const recoveryService = {
    recoverHandoffNow: jest.fn(
      options.recoveryRedrive ?? (async () => ({ outcome: 'dispatched' }))
    ),
  };
  const useCase = new WorkerWhatsappProviderHandoffUseCase(
    runtimeRepository as never,
    lifecycleQueue as never,
    recoveryService as never
  );
  return { useCase, runtimeRepository, lifecycleQueue, recoveryService };
}

describe('WorkerWhatsappProviderHandoffUseCase', () => {
  it('keeps the original handoff lifecycle identity after worker lifecycle replacement', async () => {
    const deps = build(
      snapshot({
        worker_lifecycle_operation_id: 'replacement-operation',
        handoff_lifecycle_operation_id: 'immutable-handoff-operation',
        resolution_action: 'discard',
        resolution_state: 'running',
        resolution_operation_id: 'replacement-operation',
      })
    );

    await expect(
      deps.useCase.viewLatest('account-1', 'worker-1')
    ).resolves.toMatchObject({
      lifecycle_operation_id: 'immutable-handoff-operation',
      handoff_lifecycle_operation_id: 'immutable-handoff-operation',
      resolution_operation_id: 'replacement-operation',
    });
  });

  it('queues discard when the bound Postgres source runtime is proven', async () => {
    const deps = build();

    await expect(
      deps.useCase.resolve(t, 'account-1', 'worker-1', 'handoff-1', 'discard')
    ).resolves.toMatchObject({
      status: 'queued',
      reason: 'session_discard_queued',
      operation_id: expect.any(String),
    });
    expect(
      deps.runtimeRepository.claimWhatsappProviderHandoffDiscard
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'account-1',
        worker_id: 'worker-1',
        handoff_id: 'handoff-1',
        expected_server_id: 'server-1',
        operation_id: expect.any(String),
      })
    );
    expect(deps.lifecycleQueue.prepare).toHaveBeenCalledTimes(2);
    expect(deps.lifecycleQueue.publish).toHaveBeenCalledTimes(2);
    expect(deps.lifecycleQueue.publish.mock.calls[0][0]).toMatchObject({
      action: 'cleanup_previous_runtime',
      remove_session: false,
      remove_volume: false,
      worker_id: 'worker-1',
      account_id: 'account-1',
      previous_server_id: 'server-1',
      previous_worker_type_id: EWorkerType.whatsmeow,
    });
    expect(deps.lifecycleQueue.publish.mock.calls[1][0]).toMatchObject({
      action: 'recreate',
      remove_session: false,
      remove_volume: false,
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      cleanup_previous_runtime_required: true,
    });
  });

  it('keeps direct discard available when the source lease proof is stale', async () => {
    const deps = build(snapshot({ lease_expires_at: '2026-08-05T00:00:01Z' }));

    await expect(
      deps.useCase.resolve(t, 'account-1', 'worker-1', 'handoff-1', 'discard')
    ).resolves.toMatchObject({
      status: 'queued',
      reason: 'session_discard_queued',
      handoff: {
        source_revision_preserved: true,
        source_runtime_restored: false,
      },
    });
    expect(deps.lifecycleQueue.prepare).toHaveBeenCalledTimes(2);
    expect(deps.lifecycleQueue.publish).toHaveBeenCalledTimes(2);
  });

  it('keeps the direct discard fallback available without a source revision', async () => {
    const deps = build(
      snapshot({
        session_provider: 'baileys',
        active_revision_id: null,
        lease_expires_at: null,
      })
    );

    await expect(
      deps.useCase.viewLatest('account-1', 'worker-1')
    ).resolves.toMatchObject({
      source_revision_preserved: false,
      can_return: false,
      can_discard: true,
    });
    await expect(
      deps.useCase.resolve(t, 'account-1', 'worker-1', 'handoff-1', 'discard')
    ).resolves.toMatchObject({
      status: 'queued',
      reason: 'session_discard_queued',
    });
    expect(deps.lifecycleQueue.prepare).toHaveBeenCalledTimes(2);
    expect(deps.lifecycleQueue.publish).toHaveBeenCalledTimes(2);
  });

  it('allows return while a Postgres worker is temporarily missing its runtime row', async () => {
    const deps = build(
      snapshot({
        runtime_container_id: null,
        runtime_session_storage: null,
        runtime_generation: null,
        runtime_capability_hash: null,
        runtime_writer_epoch: null,
        runtime_source_provider: null,
        runtime_connection_activated_at: null,
        runtime_online_acknowledged: null,
        runtime_status_lease_owner_id: null,
        runtime_status_fencing_token: null,
        lease_expires_at: null,
      }),
      {
        returnClaim: {
          outcome: 'claimed',
          resolution_state: 'running',
          operation_id: 'return-operation-1',
        },
      }
    );

    await expect(
      deps.useCase.viewLatest('account-1', 'worker-1')
    ).resolves.toMatchObject({
      source_revision_preserved: true,
      source_runtime_restored: false,
      can_return: true,
      can_discard: false,
    });
    await expect(
      deps.useCase.resolve(t, 'account-1', 'worker-1', 'handoff-1', 'return')
    ).resolves.toMatchObject({
      status: 'queued',
      reason: 'source_restore_queued',
      operation_id: 'return-operation-1',
    });
    expect(deps.recoveryService.recoverHandoffNow).toHaveBeenCalledWith({
      accountId: 'account-1',
      handoffId: 'handoff-1',
      workerId: 'worker-1',
    });
  });

  it('does not prepare a discard journal for an unrelated recreating lifecycle', async () => {
    const deps = build(
      snapshot({
        worker_status_id: EWorkerStatus.recreating,
        worker_lifecycle_operation_id: 'concurrent-operation',
      })
    );

    await expect(
      deps.useCase.resolve(t, 'account-1', 'worker-1', 'handoff-1', 'discard')
    ).resolves.toMatchObject({
      status: 'blocked',
      reason: 'source_runtime_identity_unavailable',
    });
    expect(deps.lifecycleQueue.prepare).not.toHaveBeenCalled();
    expect(deps.lifecycleQueue.publish).not.toHaveBeenCalled();
    expect(
      deps.runtimeRepository.claimWhatsappProviderHandoffDiscard
    ).not.toHaveBeenCalled();
  });

  it('accepts return with a preserved source revision and redrives recovery immediately', async () => {
    const deps = build(snapshot({ lease_expires_at: '2026-08-05T00:00:01Z' }), {
      returnClaim: {
        outcome: 'claimed',
        resolution_state: 'running',
        operation_id: 'return-operation-1',
      },
    });

    await expect(
      deps.useCase.viewLatest('account-1', 'worker-1')
    ).resolves.toMatchObject({
      can_return: true,
      can_discard: true,
      source_runtime_restored: false,
    });
    await expect(
      deps.useCase.resolve(t, 'account-1', 'worker-1', 'handoff-1', 'return')
    ).resolves.toMatchObject({
      action: 'return',
      status: 'queued',
      reason: 'source_restore_queued',
      operation_id: 'return-operation-1',
    });
    expect(
      deps.runtimeRepository.claimWhatsappProviderHandoffReturn
    ).toHaveBeenCalledTimes(1);
    expect(deps.recoveryService.recoverHandoffNow).toHaveBeenCalledWith({
      accountId: 'account-1',
      handoffId: 'handoff-1',
      workerId: 'worker-1',
    });
  });

  it('completes return immediately when the fenced database claim proves the source restored', async () => {
    const deps = build();

    await expect(
      deps.useCase.resolve(t, 'account-1', 'worker-1', 'handoff-1', 'return')
    ).resolves.toMatchObject({
      action: 'return',
      status: 'completed',
      reason: 'source_restored',
      operation_id: expect.any(String),
    });
    expect(
      deps.runtimeRepository.claimWhatsappProviderHandoffReturn
    ).toHaveBeenCalledTimes(1);
    expect(deps.lifecycleQueue.prepare).not.toHaveBeenCalled();
    expect(deps.lifecycleQueue.publish).not.toHaveBeenCalled();
  });

  it('redrives an idempotent return with the existing operation identity', async () => {
    const existingOperationId = 'return-operation-1';
    const decision = snapshot({
      resolution_action: 'return',
      resolution_state: 'running',
      resolution_operation_id: existingOperationId,
    });
    const deps = build(decision, {
      returnClaim: {
        outcome: 'idempotent',
        resolution_state: 'running',
        operation_id: existingOperationId,
      },
    });

    await expect(
      deps.useCase.resolve(t, 'account-1', 'worker-1', 'handoff-1', 'return')
    ).resolves.toMatchObject({
      action: 'return',
      status: 'queued',
      reason: 'source_restore_queued',
      operation_id: existingOperationId,
    });
    expect(
      deps.runtimeRepository.claimWhatsappProviderHandoffReturn
    ).toHaveBeenCalledWith(
      expect.objectContaining({ operation_id: existingOperationId })
    );
    expect(deps.recoveryService.recoverHandoffNow).toHaveBeenCalledWith({
      accountId: 'account-1',
      handoffId: 'handoff-1',
      workerId: 'worker-1',
    });
  });

  it('exposes a bounded return failure without masking the destructive fallback', async () => {
    const deps = build(
      snapshot({
        worker_status_id: EWorkerStatus.recreating,
        worker_lifecycle_operation_id: 'return-operation-1',
        resolution_action: 'return',
        resolution_state: 'running',
        resolution_operation_id: 'return-operation-1',
        recovery_state: 'blocked',
        recovery_last_error_code: 'source_pq_recovery_failed',
      })
    );

    await expect(
      deps.useCase.viewLatest('account-1', 'worker-1')
    ).resolves.toMatchObject({
      resolution_status: 'rollback_blocked',
      recovery_error_code: 'source_pq_recovery_failed',
      can_discard: true,
    });
  });

  it('allows a running return to be explicitly superseded by discard', async () => {
    const deps = build(
      snapshot({
        resolution_action: 'return',
        resolution_state: 'running',
        resolution_operation_id: 'return-operation',
      }),
      {
        discardClaim: (input) => ({
          outcome: 'claimed',
          resolution_state: 'running',
          operation_id: input.operation_id,
        }),
      }
    );

    await expect(
      deps.useCase.resolve(t, 'account-1', 'worker-1', 'handoff-1', 'discard')
    ).resolves.toMatchObject({
      action: 'discard',
      status: 'queued',
      reason: 'session_discard_queued',
      operation_id: expect.any(String),
    });
    expect(
      deps.runtimeRepository.claimWhatsappProviderHandoffDiscard
    ).toHaveBeenCalledTimes(1);
    expect(deps.lifecycleQueue.prepare).toHaveBeenCalledTimes(2);
    expect(deps.lifecycleQueue.publish).toHaveBeenCalledTimes(2);
  });

  it('keeps destructive fallback available when a running return lost its source revision', async () => {
    const deps = build(
      snapshot({
        worker_status_id: EWorkerStatus.recreating,
        worker_lifecycle_operation_id: 'return-operation',
        resolution_action: 'return',
        resolution_state: 'running',
        resolution_operation_id: 'return-operation',
        session_provider: 'baileys',
        active_revision_id: '99',
      }),
      {
        discardClaim: (input) => ({
          outcome: 'claimed',
          resolution_state: 'running',
          operation_id: input.operation_id,
        }),
      }
    );

    await expect(
      deps.useCase.viewLatest('account-1', 'worker-1')
    ).resolves.toMatchObject({
      source_revision_preserved: false,
      can_return: false,
      can_discard: true,
    });
    await expect(
      deps.useCase.resolve(t, 'account-1', 'worker-1', 'handoff-1', 'discard')
    ).resolves.toMatchObject({
      status: 'queued',
      reason: 'session_discard_queued',
    });
    expect(deps.lifecycleQueue.publish).toHaveBeenCalledTimes(2);
  });

  it('does not publish destructive work while return recovery is quiescing a cold runtime', async () => {
    const deps = build(
      snapshot({
        worker_status_id: EWorkerStatus.recreating,
        worker_lifecycle_operation_id: 'return-operation',
        resolution_action: 'return',
        resolution_state: 'running',
        resolution_operation_id: 'return-operation',
        runtime_container_id: null,
        runtime_source_provider: null,
      }),
      {
        discardClaim: {
          outcome: 'return_recovery_quiescing',
          resolution_state: 'running',
          operation_id: 'return-operation',
        },
      }
    );

    await expect(
      deps.useCase.resolve(t, 'account-1', 'worker-1', 'handoff-1', 'discard')
    ).resolves.toMatchObject({
      status: 'blocked',
      reason: 'return_recovery_quiescing',
      operation_id: 'return-operation',
    });
    expect(deps.lifecycleQueue.prepare).not.toHaveBeenCalled();
    expect(deps.lifecycleQueue.publish).not.toHaveBeenCalled();
    expect(
      deps.runtimeRepository.claimWhatsappProviderHandoffDiscard
    ).not.toHaveBeenCalled();
  });

  it('never permits return to supersede a running discard', async () => {
    const deps = build(
      snapshot({
        resolution_action: 'discard',
        resolution_state: 'running',
        resolution_operation_id: 'discard-operation',
      })
    );

    await expect(
      deps.useCase.resolve(t, 'account-1', 'worker-1', 'handoff-1', 'return')
    ).resolves.toMatchObject({
      action: 'return',
      status: 'blocked',
      reason: 'resolution_action_conflict',
      operation_id: 'discard-operation',
    });
    expect(
      deps.runtimeRepository.claimWhatsappProviderHandoffReturn
    ).not.toHaveBeenCalled();
    expect(deps.lifecycleQueue.publish).not.toHaveBeenCalled();
  });

  it('fails closed for a legacy-volume handoff', async () => {
    const deps = build(
      snapshot({
        worker_session_storage: EWorkerSessionStorage.legacy_volume,
        runtime_session_storage: EWorkerSessionStorage.legacy_volume,
      })
    );

    await expect(
      deps.useCase.viewLatest('account-1', 'worker-1')
    ).resolves.toMatchObject({
      resolution_required: false,
      can_return: false,
      can_discard: false,
    });
    await expect(
      deps.useCase.resolve(t, 'account-1', 'worker-1', 'handoff-1', 'return')
    ).resolves.toMatchObject({
      status: 'blocked',
      reason: 'legacy_volume_handoff_recovery_forbidden',
    });
    expect(
      deps.runtimeRepository.claimWhatsappProviderHandoffReturn
    ).not.toHaveBeenCalled();
  });

  it('redrives only the existing discard journal on double-click', async () => {
    const deps = build(
      snapshot({
        resolution_action: 'discard',
        resolution_state: 'running',
        resolution_operation_id: 'discard-operation',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.recreating,
        worker_lifecycle_operation_id: 'discard-operation',
        runtime_source_provider: 'baileys',
      })
    );

    const first = await deps.useCase.resolve(
      t,
      'account-1',
      'worker-1',
      'handoff-1',
      'discard'
    );
    const second = await deps.useCase.resolve(
      t,
      'account-1',
      'worker-1',
      'handoff-1',
      'discard'
    );

    expect(first).toMatchObject({ status: 'queued' });
    expect(second).toMatchObject({ status: 'queued' });
    expect(first?.operation_id).toBe('discard-operation');
    expect(second?.operation_id).toBe('discard-operation');
    expect(
      deps.runtimeRepository.claimWhatsappProviderHandoffDiscard
    ).not.toHaveBeenCalled();
    expect(deps.lifecycleQueue.prepare).not.toHaveBeenCalled();
    expect(deps.lifecycleQueue.publish).not.toHaveBeenCalled();
    expect(deps.lifecycleQueue.redrivePrepared).toHaveBeenCalledTimes(2);
    expect(deps.lifecycleQueue.redrivePrepared).toHaveBeenNthCalledWith(
      1,
      'worker-1',
      'discard-operation',
      'whatsapp_handoff_discard_handoff-1'
    );
  });

  it('never publishes discard after a concurrent return wins the database claim', async () => {
    const deps = build(snapshot(), {
      discardClaim: {
        outcome: 'conflict',
        resolution_state: 'running',
        operation_id: 'return-operation-1',
      },
    });

    await expect(
      deps.useCase.resolve(t, 'account-1', 'worker-1', 'handoff-1', 'discard')
    ).resolves.toMatchObject({
      status: 'blocked',
      reason: 'resolution_action_conflict',
      operation_id: 'return-operation-1',
    });
    expect(deps.lifecycleQueue.prepare).toHaveBeenCalledTimes(2);
    expect(deps.lifecycleQueue.publish).not.toHaveBeenCalled();
  });
});
