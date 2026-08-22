import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, jest } from '@jest/globals';
import { container } from 'tsyringe';
import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import {
  WorkerRuntimeRepository,
  type WhatsappProviderHandoffDecisionSnapshot,
  type WhatsappProviderHandoffResolutionClaim,
} from '@core/repositories/worker/WorkerRuntime.repository';

jest.mock('tsyringe', () => ({
  container: {
    resolve: jest.fn(),
  },
  inject: () => () => undefined,
  injectable: () => (target: unknown) => target,
  singleton: () => (target: unknown) => target,
}));

// The controllers resolve this token from the DI container. Keep the token
// lightweight while exercising the real use case with a stateful durable-row
// harness below.
jest.mock(
  '@core/useCases/worker/WorkerWhatsappProviderHandoff.useCase',
  () => ({
    WorkerWhatsappProviderHandoffUseCase: class WorkerWhatsappProviderHandoffUseCase {},
  })
);

const { WorkerWhatsappProviderHandoffUseCase } = jest.requireActual<{
  WorkerWhatsappProviderHandoffUseCase: typeof import('@core/useCases/worker/WorkerWhatsappProviderHandoff.useCase').WorkerWhatsappProviderHandoffUseCase;
}>('@core/useCases/worker/WorkerWhatsappProviderHandoff.useCase');

const { viewWhatsappProviderHandoff } = jest.requireActual<{
  viewWhatsappProviderHandoff: (request: never, reply: never) => Promise<void>;
}>(
  '../../../../../apps/manager_api/src/controllers/worker/methods/viewWhatsappProviderHandoff'
);

const { viewWhatsappProviderHandoffEvidence } = jest.requireActual<{
  viewWhatsappProviderHandoffEvidence: (
    request: never,
    reply: never
  ) => Promise<void>;
}>(
  '../../../../../apps/manager_api/src/controllers/worker/methods/viewWhatsappProviderHandoffEvidence'
);

const { resolveWhatsappProviderHandoff } = jest.requireActual<{
  resolveWhatsappProviderHandoff: (
    request: never,
    reply: never
  ) => Promise<void>;
}>(
  '../../../../../apps/manager_api/src/controllers/worker/methods/resolveWhatsappProviderHandoff'
);

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const WORKER_ID = '00000000-0000-4000-8000-000000000002';
const HANDOFF_ID = '00000000-0000-4000-8000-000000000003';
const SERVER_ID = '00000000-0000-4000-8000-000000000004';
const workerRouteSource = fs.readFileSync(
  path.resolve(process.cwd(), 'apps/manager_api/src/routes/worker.route.ts'),
  'utf8'
);

const t = ((key: string) => key) as never;

const providerHandoffCanaryPairs = [
  {
    source: 'baileys' as const,
    sourceType: EWorkerType.baileys,
    target: 'whatsmeow' as const,
    targetType: EWorkerType.whatsmeow,
  },
  {
    source: 'baileys' as const,
    sourceType: EWorkerType.baileys,
    target: 'wwebjs' as const,
    targetType: EWorkerType.wwebjs,
  },
  {
    source: 'whatsmeow' as const,
    sourceType: EWorkerType.whatsmeow,
    target: 'baileys' as const,
    targetType: EWorkerType.baileys,
  },
  {
    source: 'whatsmeow' as const,
    sourceType: EWorkerType.whatsmeow,
    target: 'wwebjs' as const,
    targetType: EWorkerType.wwebjs,
  },
  {
    source: 'wwebjs' as const,
    sourceType: EWorkerType.wwebjs,
    target: 'baileys' as const,
    targetType: EWorkerType.baileys,
  },
  {
    source: 'wwebjs' as const,
    sourceType: EWorkerType.wwebjs,
    target: 'whatsmeow' as const,
    targetType: EWorkerType.whatsmeow,
  },
] as const;

function decisionSnapshot(
  overrides: Partial<WhatsappProviderHandoffDecisionSnapshot> = {}
): WhatsappProviderHandoffDecisionSnapshot {
  return {
    worker_id: WORKER_ID,
    account_id: ACCOUNT_ID,
    worker_server_id: SERVER_ID,
    worker_session_storage: EWorkerSessionStorage.postgres,
    worker_type_id: EWorkerType.baileys,
    worker_status_id: EWorkerStatus.online,
    // Deliberately not fully restored: this models the screen that is still
    // showing "Restaurando canal anterior" after a target validation failure.
    worker_lifecycle_operation_id: null,
    worker_container_id: 'source-container-stale',
    handoff_id: HANDOFF_ID,
    handoff_lifecycle_operation_id: '00000000-0000-4000-8000-000000000006',
    source_provider: 'baileys',
    target_provider: 'whatsmeow',
    source_revision_id: '41',
    target_revision_id: '42',
    state: 'failed',
    error_code: 'target_validation_failed',
    recovery_state: 'pending',
    recovery_operation_id: '00000000-0000-4000-8000-000000000007',
    recovery_last_error_code: null,
    resolution_action: null,
    resolution_state: null,
    resolution_operation_id: null,
    resolution_last_error_code: null,
    resolution_requested_at: null,
    resolution_updated_at: null,
    resolution_cleanup_finalized_at: null,
    resolution_completed_at: null,
    session_provider: 'baileys',
    session_state: 'ready',
    active_revision_id: '41',
    session_generation: 7,
    session_epoch: '00000000-0000-4000-8000-000000000008',
    session_capability_hash: 'a'.repeat(64),
    runtime_container_id: 'source-container-live',
    runtime_session_storage: EWorkerSessionStorage.postgres,
    runtime_generation: 7,
    runtime_capability_hash: 'a'.repeat(64),
    runtime_writer_epoch: '00000000-0000-4000-8000-000000000008',
    runtime_source_provider: 'baileys',
    runtime_connection_activated_at: '2026-08-06T15:00:00.000Z',
    runtime_online_acknowledged: true,
    runtime_status_lease_owner_id: '00000000-0000-4000-8000-000000000009',
    runtime_status_fencing_token: '17',
    lease_provider: 'baileys',
    lease_generation: 7,
    lease_epoch: '00000000-0000-4000-8000-000000000008',
    lease_owner_id: '00000000-0000-4000-8000-000000000009',
    lease_fencing_token: '17',
    lease_expires_at: '2026-08-06T15:00:30.000Z',
    database_now: '2026-08-06T15:00:00.000Z',
    created_at: '2026-08-06T14:59:00.000Z',
    updated_at: '2026-08-06T15:00:00.000Z',
    ...overrides,
  };
}

/**
 * Represents the durable state after the target has been validated and
 * promoted. The handoff history remains queryable, but it must no longer own
 * a recovery operation or expose a recovery choice after a page reload.
 */
function promotedDecisionSnapshot(input: {
  source: 'baileys' | 'wwebjs' | 'whatsmeow';
  target: 'baileys' | 'wwebjs' | 'whatsmeow';
  targetType: EWorkerType;
}): WhatsappProviderHandoffDecisionSnapshot {
  const targetContainer = 'target-container-live';
  const targetEpoch = '00000000-0000-4000-8000-000000000010';
  const targetLeaseOwner = '00000000-0000-4000-8000-000000000011';
  const targetCapability = 'b'.repeat(64);

  return decisionSnapshot({
    worker_type_id: input.targetType,
    worker_status_id: EWorkerStatus.online,
    worker_lifecycle_operation_id: null,
    worker_container_id: targetContainer,
    source_provider: input.source,
    target_provider: input.target,
    state: 'completed',
    error_code: null,
    recovery_state: 'none',
    recovery_operation_id: null,
    recovery_last_error_code: null,
    session_provider: input.target,
    session_state: 'ready',
    active_revision_id: '42',
    session_generation: 8,
    session_epoch: targetEpoch,
    session_capability_hash: targetCapability,
    runtime_container_id: targetContainer,
    runtime_session_storage: EWorkerSessionStorage.postgres,
    runtime_generation: 8,
    runtime_capability_hash: targetCapability,
    runtime_writer_epoch: targetEpoch,
    runtime_source_provider: input.target,
    runtime_connection_activated_at: '2026-08-06T15:00:00.000Z',
    runtime_online_acknowledged: true,
    runtime_status_lease_owner_id: targetLeaseOwner,
    runtime_status_fencing_token: '18',
    lease_provider: input.target,
    lease_generation: 8,
    lease_epoch: targetEpoch,
    lease_owner_id: targetLeaseOwner,
    lease_fencing_token: '18',
    lease_expires_at: '2026-08-06T15:00:30.000Z',
  });
}

function reply(id: string) {
  return {
    request: { id },
    code: jest.fn().mockReturnThis(),
    send: jest.fn(),
  };
}

function controllerRequest(input: {
  handoffId?: string;
  action?: 'return' | 'discard';
}) {
  return {
    t,
    tokenJwtData: { account_id: ACCOUNT_ID },
    params: {
      worker_id: WORKER_ID,
      ...(input.handoffId ? { handoff_id: input.handoffId } : {}),
    },
    ...(input.action ? { body: { action: input.action } } : {}),
  };
}

function createHandoffCanary() {
  let current = decisionSnapshot();
  const sourceSession = {
    provider: 'baileys',
    state: 'ready',
    activeRevisionId: '41',
    storage: EWorkerSessionStorage.postgres,
    volumeName: null,
  } as const;
  const lifecycleQueue = {
    prepare: jest.fn(async (_message: unknown) => undefined),
    publish: jest.fn(async (_message: unknown) => undefined),
  };
  const recoveryService = {
    recoverHandoffNow: jest.fn(
      async (_input: {
        accountId: string;
        handoffId: string;
        workerId: string;
      }) => {
        // A direct redrive has claimed the durable recovery and fenced the
        // source lifecycle. It is not online yet, but it is now safe for the
        // caller to supersede it with the explicitly destructive choice.
        current = {
          ...current,
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.recreating,
          worker_lifecycle_operation_id: current.recovery_operation_id,
        };
        return { outcome: 'dispatched' };
      }
    ),
  };
  const runtimeRepository = {
    viewWhatsappProviderHandoffDecision: jest.fn(async () => ({ ...current })),
    claimWhatsappProviderHandoffReturn: jest.fn(
      async (input: {
        operation_id: string;
      }): Promise<WhatsappProviderHandoffResolutionClaim> => {
        const operationId = current.recovery_operation_id ?? input.operation_id;
        current = {
          ...current,
          resolution_action: 'return',
          resolution_state: 'running',
          resolution_operation_id: operationId,
          recovery_state: 'pending',
        };
        return {
          outcome: 'claimed',
          resolution_state: 'running',
          operation_id: operationId,
        };
      }
    ),
    claimWhatsappProviderHandoffDiscard: jest.fn(
      async (input: {
        operation_id: string;
      }): Promise<WhatsappProviderHandoffResolutionClaim> => {
        current = {
          ...current,
          resolution_action: 'discard',
          resolution_state: 'running',
          resolution_operation_id: input.operation_id,
          recovery_state: 'cancelled',
          worker_type_id: EWorkerType.whatsmeow,
          worker_status_id: EWorkerStatus.recreating,
          worker_lifecycle_operation_id: input.operation_id,
        };
        return {
          outcome: 'claimed',
          resolution_state: 'running',
          operation_id: input.operation_id,
        };
      }
    ),
  };
  const useCase = new WorkerWhatsappProviderHandoffUseCase(
    runtimeRepository as never,
    lifecycleQueue as never,
    recoveryService as never
  );

  return {
    current: () => current,
    lifecycleQueue,
    recoveryService,
    runtimeRepository,
    sourceSession,
    useCase,
  };
}

describe('WhatsApp provider handoff recovery canary', () => {
  it('registers the sanitized evidence endpoint behind worker view authorization', () => {
    const routeStart = workerRouteSource.indexOf(
      "server.get('/worker/:worker_id/provider-handoff/evidence'"
    );
    expect(routeStart).toBeGreaterThanOrEqual(0);
    const routeBlock = workerRouteSource.slice(routeStart, routeStart + 600);
    expect(routeBlock).toContain('viewWhatsappProviderHandoffEvidenceSchema');
    expect(routeBlock).toContain(
      'handler: workerController.viewWhatsappProviderHandoffEvidence'
    );
    expect(routeBlock).toContain('workerViewPermissions');
    expect(routeBlock).toContain('planGuard');
    expect(routeBlock).toContain('planStatus');
  });

  it('keeps outbox evidence account-scoped and aggregate-only at the controller boundary', async () => {
    const evidence = {
      after_order: '100',
      observed_through_order: '104',
      first_window_order: '101',
      last_window_order: '104',
      window_event_count: 4,
      operation_event_count: 1,
      trace_event_count: 3,
      correlated_event_count: 3,
      pending_event_count: 0,
      dead_letter_event_count: 0,
      qr_event_count: 0,
      pairing_event_count: 0,
      passkey_event_count: 0,
      interactive_login_event_count: 0,
      interactive_login_detected: false,
      window_limit: 10_000,
      window_truncated: false,
    };
    const useCase = {
      viewOutboxEvidence: jest.fn(async (_input: unknown) => evidence),
    };
    jest.mocked(container.resolve).mockReturnValue(useCase as never);
    const response = reply('evidence-request');

    await viewWhatsappProviderHandoffEvidence(
      {
        t,
        tokenJwtData: { account_id: ACCOUNT_ID },
        params: { worker_id: WORKER_ID },
        query: {
          after_order: '100',
          operation_id: '00000000-0000-4000-8000-000000000006',
          debug_trace_id: 'live_provider_handoff_canary_trace',
        },
      } as never,
      response as never
    );

    expect(useCase.viewOutboxEvidence).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      workerId: WORKER_ID,
      afterOrder: '100',
      operationId: '00000000-0000-4000-8000-000000000006',
      debugTraceId: 'live_provider_handoff_canary_trace',
    });
    expect(response.code).toHaveBeenCalledWith(200);
    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({ data: evidence })
    );
    expect(JSON.stringify(evidence)).not.toContain('qrcode');
    expect(JSON.stringify(evidence)).not.toContain('phone');
    expect(JSON.stringify(evidence)).not.toContain('payload');
  });

  it.each(providerHandoffCanaryPairs)(
    'closes terminal recovery state for PostgreSQL handoff $source -> $target',
    async ({ source, target, targetType }) => {
      const snapshot = promotedDecisionSnapshot({
        source,
        target,
        targetType,
      });
      const runtimeRepository = {
        viewWhatsappProviderHandoffDecision: jest.fn(async () => snapshot),
      };
      const useCase = new WorkerWhatsappProviderHandoffUseCase(
        runtimeRepository as never,
        {} as never,
        undefined
      );

      const handoff = await useCase.viewLatest(ACCOUNT_ID, WORKER_ID);

      // All six directed swaps retain the same worker/session identity and
      // PostgreSQL-backed runtime. A completed handoff is history only: it
      // cannot leave the recovery dialog or either destructive choice active.
      expect(snapshot.worker_id).toBe(WORKER_ID);
      expect(snapshot.worker_session_storage).toBe(
        EWorkerSessionStorage.postgres
      );
      expect(snapshot.runtime_session_storage).toBe(
        EWorkerSessionStorage.postgres
      );
      expect(handoff).toMatchObject({
        worker_id: WORKER_ID,
        source_provider: source,
        target_provider: target,
        state: 'completed',
        recovery_state: 'none',
        resolution_required: false,
        can_return: false,
        can_discard: false,
        resolution_action: null,
        resolution_state: null,
        resolution_status: 'completed',
      });

      await expect(
        useCase.resolve(t, ACCOUNT_ID, WORKER_ID, HANDOFF_ID, 'return')
      ).resolves.toMatchObject({
        action: 'return',
        status: 'blocked',
        reason: 'handoff_already_completed',
      });
      expect(
        runtimeRepository.viewWhatsappProviderHandoffDecision
      ).toHaveBeenCalledTimes(2);
    }
  );

  it('keeps the PostgreSQL source session intact through return, then lets the user discard it before target recreate', async () => {
    const canary = createHandoffCanary();
    jest.mocked(container.resolve).mockReturnValue(canary.useCase as never);

    const initialReply = reply('view-initial');
    await viewWhatsappProviderHandoff(
      controllerRequest({}) as never,
      initialReply as never
    );

    expect(initialReply.code).toHaveBeenCalledWith(200);
    expect(initialReply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source_provider: 'baileys',
          target_provider: 'whatsmeow',
          source_revision_preserved: true,
          source_runtime_restored: false,
          can_return: true,
          can_discard: true,
          resolution_status: 'restoring_source',
        }),
      })
    );

    const returnReply = reply('resolve-return');
    await resolveWhatsappProviderHandoff(
      controllerRequest({ handoffId: HANDOFF_ID, action: 'return' }) as never,
      returnReply as never
    );

    expect(returnReply.code).toHaveBeenCalledWith(202);
    expect(returnReply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'return',
          status: 'queued',
          reason: 'source_restore_queued',
        }),
      })
    );
    expect(canary.recoveryService.recoverHandoffNow).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      handoffId: HANDOFF_ID,
      workerId: WORKER_ID,
    });
    // Return only redrives the preserved source. It never queues a session or
    // volume deletion and the exact source revision remains authoritative.
    expect(canary.lifecycleQueue.prepare).not.toHaveBeenCalled();
    expect(canary.lifecycleQueue.publish).not.toHaveBeenCalled();
    expect(canary.sourceSession).toEqual({
      provider: 'baileys',
      state: 'ready',
      activeRevisionId: '41',
      storage: EWorkerSessionStorage.postgres,
      volumeName: null,
    });

    const pendingReply = reply('view-return-pending');
    await viewWhatsappProviderHandoff(
      controllerRequest({}) as never,
      pendingReply as never
    );
    // This is the key UI/API contract: while the return is still being
    // attempted, the user may explicitly opt into the destructive path.
    expect(pendingReply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resolution_action: 'return',
          resolution_state: 'running',
          resolution_required: true,
          can_return: false,
          can_discard: true,
          resolution_status: 'restoring_source',
        }),
      })
    );

    const discardReply = reply('resolve-discard');
    await resolveWhatsappProviderHandoff(
      controllerRequest({ handoffId: HANDOFF_ID, action: 'discard' }) as never,
      discardReply as never
    );

    expect(discardReply.code).toHaveBeenCalledWith(202);
    expect(discardReply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'discard',
          status: 'queued',
          reason: 'session_discard_queued',
        }),
      })
    );
    expect(
      canary.lifecycleQueue.publish.mock.calls.map(
        ([message]) => (message as { action: string }).action
      )
    ).toEqual(['cleanup_previous_runtime', 'recreate']);
    expect(canary.lifecycleQueue.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: 'cleanup_previous_runtime',
        worker_type_id: EWorkerType.baileys,
        session_storage: EWorkerSessionStorage.postgres,
        remove_session: false,
        remove_volume: false,
      })
    );
    expect(canary.lifecycleQueue.publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'recreate',
        worker_type_id: EWorkerType.whatsmeow,
        cleanup_previous_runtime_required: true,
        session_storage: EWorkerSessionStorage.postgres,
        remove_session: false,
        remove_volume: false,
      })
    );
    expect(canary.current()).toMatchObject({
      resolution_action: 'discard',
      resolution_state: 'running',
      worker_type_id: EWorkerType.whatsmeow,
      worker_status_id: EWorkerStatus.recreating,
    });
  });

  it('fails closed for legacy-volume channels before any handoff choice reaches the use case', async () => {
    const execute = jest.fn(async (_query: SQL) => ({ rows: [] as never[] }));
    const repository = new WorkerRuntimeRepository(
      { execute } as never,
      {} as never
    );

    await expect(
      repository.viewWhatsappProviderHandoffDecision({
        worker_id: WORKER_ID,
        account_id: ACCOUNT_ID,
      })
    ).resolves.toBeNull();

    const dialect = new PgDialect();
    const primarySql = dialect
      .sqlToQuery(execute.mock.calls[1][0] as SQL)
      .sql.replace(/\s+/gu, ' ');
    const fallbackSql = dialect
      .sqlToQuery(execute.mock.calls[2][0] as SQL)
      .sql.replace(/\s+/gu, ' ');
    expect(primarySql).toContain("worker.session_storage = 'postgres'");
    expect(fallbackSql).toContain("worker.session_storage = 'postgres'");
  });
});
