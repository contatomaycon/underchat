import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { createPinia, setActivePinia } from 'pinia';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWhatsappConnectionStatus } from '@core/common/enums/EWhatsappConnectionStatus';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerRecreatePhase } from '@core/common/enums/EWorkerRecreatePhase';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import * as whatsappConnectionStatus from '@core/common/functions/whatsappConnectionStatus';
import * as workerLifecycleRealtimeStatus from '@core/common/functions/workerLifecycleRealtimeStatus';

interface RecoveryMarker {
  handoff_id: string;
  lifecycle_operation_id: string;
  source_provider: 'baileys' | 'whatsmeow' | 'wwebjs';
  target_provider: 'baileys' | 'whatsmeow' | 'wwebjs';
}

interface Handoff {
  worker_id: string;
  handoff_id: string;
  lifecycle_operation_id: string;
  handoff_lifecycle_operation_id: string | null;
  resolution_action: 'discard' | 'return' | null;
  resolution_state: 'running' | 'completed' | null;
  resolution_operation_id: string | null;
  source_provider: RecoveryMarker['source_provider'];
  target_provider: RecoveryMarker['target_provider'];
  state?: 'failed';
  error_code?: string | null;
  recovery_state?: 'running' | 'completed';
  recovery_operation_id?: string | null;
  recovery_error_code?: string | null;
  source_revision_preserved?: boolean;
  source_runtime_restored?: boolean;
  resolution_required?: boolean;
  can_return?: boolean;
  can_discard?: boolean;
  resolution_status?: 'awaiting_decision';
  created_at?: string;
  updated_at?: string;
}

interface ChannelsStoreMock {
  list: Array<{
    id: string;
    provider_handoff_recovery?: RecoveryMarker | null;
  }>;
  viewWhatsappProviderHandoff: jest.Mock;
  getWorkerById: jest.Mock;
  applyCanonicalProviderHandoffSourceRecovery: jest.Mock;
}

interface PresentationStoreMock {
  byWorkerId: Record<
    string,
    { workerId: string; lifecycleOperationId: string | null }
  >;
  reconcileProviderHandoffSourceRecovery: jest.Mock;
}

interface PresentationStoreIntegration {
  byWorkerId: Record<
    string,
    {
      workerId: string;
      workerTypeId: string | null;
      workerStatusId: string | null;
      connectionStatus: string | null;
      connectionOnlineAcknowledged: boolean;
      runtimeGeneration: number | null;
      lifecycleOperationId: string | null;
      completedLifecycleOperationId: string | null;
      recreatePhase: EWorkerRecreatePhase | null;
    }
  >;
  hydrateWorkerChannel: (channel: Record<string, unknown>) => boolean;
  reconcileProviderHandoffSourceRecovery: (
    worker: Record<string, unknown>,
    handoff: Handoff
  ) => Record<string, unknown> | null;
}

interface SourceRecoveryComposable {
  reconcileKnownHandoff: (handoff: Handoff) => Promise<boolean>;
  refreshWorker: (workerId: string) => Promise<void>;
  refreshFromLifecyclePublication: (event: {
    worker_id: string;
    lifecycle_operation_id?: string | null;
    worker_status_id?: EWorkerStatus | null;
  }) => Promise<void>;
  refreshFromRecoveryPublication: (
    event: {
      event_type: 'whatsapp_provider_handoff_recovery_terminal';
      account_id: string;
      worker_id: string;
      handoff_id: string;
      handoff_lifecycle_operation_id: string;
      recovery_operation_id: string;
      recovery_state: 'completed' | 'blocked' | 'cancelled';
      source_provider: RecoveryMarker['source_provider'];
      target_provider: RecoveryMarker['target_provider'];
    },
    expectedAccountId: string
  ) => Promise<void>;
  refreshAll: () => Promise<void>;
}

const workerA = '11111111-1111-4111-8111-111111111111';
const workerB = '22222222-2222-4222-8222-222222222222';
const operationA = '33333333-3333-7333-8333-333333333333';
const operationB = '44444444-4444-7444-8444-444444444444';
const resolutionOperation = '55555555-5555-7555-8555-555555555555';
const recoveryOperationA = '66666666-6666-7666-8666-666666666666';
const recoveryOperationB = '77777777-7777-7777-8777-777777777777';
const accountId = '88888888-8888-4888-8888-888888888888';

const marker = (workerId: string, operationId: string): RecoveryMarker => ({
  handoff_id: `handoff-${workerId}`,
  lifecycle_operation_id: operationId,
  source_provider: workerId === workerA ? 'baileys' : 'wwebjs',
  target_provider: workerId === workerA ? 'wwebjs' : 'baileys',
});

const handoff = (
  workerId: string,
  operationId: string,
  overrides: Partial<Handoff> = {}
): Handoff => {
  const recoveryMarker = marker(workerId, operationId);
  return {
    worker_id: workerId,
    handoff_id: recoveryMarker.handoff_id,
    lifecycle_operation_id: operationId,
    handoff_lifecycle_operation_id: operationId,
    resolution_action: null,
    resolution_state: null,
    resolution_operation_id: null,
    source_provider: recoveryMarker.source_provider,
    target_provider: recoveryMarker.target_provider,
    recovery_operation_id:
      workerId === workerA ? recoveryOperationA : recoveryOperationB,
    ...overrides,
  };
};

const terminalPublication = (workerId: string, operationId: string) => {
  const recoveryMarker = marker(workerId, operationId);
  return {
    event_type: 'whatsapp_provider_handoff_recovery_terminal' as const,
    account_id: accountId,
    worker_id: workerId,
    handoff_id: recoveryMarker.handoff_id,
    handoff_lifecycle_operation_id: operationId,
    recovery_operation_id:
      workerId === workerA ? recoveryOperationA : recoveryOperationB,
    recovery_state: 'completed' as const,
    source_provider: recoveryMarker.source_provider,
    target_provider: recoveryMarker.target_provider,
  };
};

const deferred = <T>() => {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
};

const loadComposable = (
  channelsStore: ChannelsStoreMock,
  presentationStore: PresentationStoreMock
): {
  useWhatsappProviderHandoffSourceRecovery: () => SourceRecoveryComposable;
  dispose: () => void;
} => {
  const filename = resolve(
    process.cwd(),
    'apps/web/src/composables/useWhatsappProviderHandoffSourceRecovery.ts'
  );
  const transpiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} as Record<string, unknown> };
  let dispose: () => void = () => undefined;
  const moduleRequire = (moduleId: string): unknown => {
    if (moduleId === 'vue') {
      return {
        computed: (getter: () => unknown) => ({
          get value() {
            return getter();
          },
        }),
        onBeforeUnmount: (callback: () => void) => {
          dispose = callback;
        },
        watch: jest.fn(() => jest.fn()),
      };
    }
    if (moduleId === '@core/common/enums/EWorkerStatus') {
      return { EWorkerStatus };
    }
    if (moduleId === '@/@webcore/stores/channels') {
      return { useChannelsStore: () => channelsStore };
    }
    if (moduleId === '@/@webcore/stores/channelStatusPresentation') {
      return { useChannelStatusPresentationStore: () => presentationStore };
    }
    throw new Error(`Unexpected source recovery dependency: ${moduleId}`);
  };
  const evaluate = new Function('require', 'module', 'exports', transpiled) as (
    requireModule: (moduleId: string) => unknown,
    module: typeof loaded,
    exports: Record<string, unknown>
  ) => void;
  evaluate(moduleRequire, loaded, loaded.exports);
  return {
    useWhatsappProviderHandoffSourceRecovery: loaded.exports
      .useWhatsappProviderHandoffSourceRecovery as () => SourceRecoveryComposable,
    dispose: () => dispose(),
  };
};

const loadPresentationStore = (): (() => PresentationStoreIntegration) => {
  const filename = resolve(
    process.cwd(),
    'apps/web/src/@webcore/stores/channelStatusPresentation.ts'
  );
  const transpiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} as Record<string, unknown> };
  const moduleRequire = (moduleId: string): unknown => {
    if (moduleId === 'pinia') return require('pinia');
    if (moduleId === '@core/common/enums/EBaileysConnectionStatus') {
      return { EBaileysConnectionStatus };
    }
    if (moduleId === '@core/common/enums/ECodeMessage') {
      return { ECodeMessage };
    }
    if (moduleId === '@core/common/enums/EWorkerRecreatePhase') {
      return { EWorkerRecreatePhase };
    }
    if (moduleId === '@core/common/enums/EWorkerAction') {
      return { EWorkerAction };
    }
    if (moduleId === '@core/common/enums/EWorkerStatus') {
      return { EWorkerStatus };
    }
    if (moduleId === '@core/common/enums/EWorkerType') {
      return { EWorkerType };
    }
    if (moduleId === '@core/common/functions/whatsappConnectionStatus') {
      return whatsappConnectionStatus;
    }
    if (moduleId === '@core/common/functions/workerLifecycleRealtimeStatus') {
      return workerLifecycleRealtimeStatus;
    }
    throw new Error(`Unexpected presentation dependency: ${moduleId}`);
  };
  const evaluate = new Function('require', 'module', 'exports', transpiled) as (
    requireModule: (moduleId: string) => unknown,
    module: typeof loaded,
    exports: Record<string, unknown>
  ) => void;
  evaluate(moduleRequire, loaded, loaded.exports);
  return loaded.exports
    .useChannelStatusPresentationStore as () => PresentationStoreIntegration;
};

const usePresentationStore = loadPresentationStore();

const stores = (markers: Array<[string, string]> = []) => {
  const handoffs = new Map(
    markers.map(([workerId, operationId]) => [
      workerId,
      handoff(workerId, operationId),
    ])
  );
  const channelsStore: ChannelsStoreMock = {
    list: markers.map(([workerId, operationId]) => ({
      id: workerId,
      provider_handoff_recovery: marker(workerId, operationId),
    })),
    viewWhatsappProviderHandoff: jest.fn(async (workerId: string) => ({
      kind: 'found',
      handoff: handoffs.get(workerId),
    })),
    getWorkerById: jest.fn(async (workerId: string) => ({ id: workerId })),
    applyCanonicalProviderHandoffSourceRecovery: jest.fn(() => true),
  };
  const presentationStore: PresentationStoreMock = {
    byWorkerId: {},
    reconcileProviderHandoffSourceRecovery: jest.fn(
      (_worker: unknown, candidate: Handoff) => ({
        releasedOperationId: candidate.lifecycle_operation_id,
        terminalOperationId: candidate.lifecycle_operation_id,
        operationIds: [candidate.lifecycle_operation_id],
      })
    ),
  };
  return { channelsStore, presentationStore };
};

describe('useWhatsappProviderHandoffSourceRecovery', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('reconciles two simultaneous markers without creating repeat reads after both settle', async () => {
    const { channelsStore, presentationStore } = stores([
      [workerA, operationA],
      [workerB, operationB],
    ]);
    const loaded = loadComposable(channelsStore, presentationStore);
    const recovery = loaded.useWhatsappProviderHandoffSourceRecovery();

    await recovery.refreshAll();
    await recovery.refreshAll();

    expect(channelsStore.viewWhatsappProviderHandoff).toHaveBeenCalledTimes(2);
    expect(channelsStore.getWorkerById).toHaveBeenCalledTimes(2);
    expect(
      presentationStore.reconcileProviderHandoffSourceRecovery
    ).toHaveBeenCalledTimes(2);
    expect(
      channelsStore.applyCanonicalProviderHandoffSourceRecovery
    ).toHaveBeenCalledTimes(2);
    for (let index = 1; index <= 2; index += 1) {
      const getOrder =
        channelsStore.getWorkerById.mock.invocationCallOrder[index - 1];
      const canonicalOrder =
        presentationStore.reconcileProviderHandoffSourceRecovery.mock
          .invocationCallOrder[index - 1];
      const legacyOrder =
        channelsStore.applyCanonicalProviderHandoffSourceRecovery.mock
          .invocationCallOrder[index - 1];
      if (
        getOrder === undefined ||
        canonicalOrder === undefined ||
        legacyOrder === undefined
      ) {
        throw new Error('source recovery call order was not captured');
      }
      expect(getOrder).toBeLessThan(canonicalOrder);
      expect(canonicalOrder).toBeLessThan(legacyOrder);
    }
    loaded.dispose();
  });

  it('replays two independent running flights from exact terminal publications and reduces both Pinia projections', async () => {
    const { channelsStore } = stores([
      [workerA, operationA],
      [workerB, operationB],
    ]);
    const presentationStore = usePresentationStore();
    const firstWorkers = new Map([
      [workerA, deferred<Record<string, unknown>>()],
      [workerB, deferred<Record<string, unknown>>()],
    ]);
    const recoveredWorker = (
      workerId: string,
      sourceProvider: 'baileys' | 'wwebjs',
      sourceType: EWorkerType,
      order: string,
      observedAt: string
    ) => ({
      id: workerId,
      name: sourceProvider,
      session_storage: 'postgres',
      number: '556192037138',
      status: { id: EWorkerStatus.online, name: 'online' },
      type: { id: sourceType, name: sourceProvider },
      connection_date: null,
      last_connection_check_at: null,
      recreate_available_at: null,
      created_at: null,
      updated_at: null,
      connection_status: {
        provider: sourceProvider,
        status: EWhatsappConnectionStatus.online,
        connected: true,
        authenticated: true,
        sessionValid: true,
        recoverable: true,
        qrAvailable: false,
        sequence: Number(order),
        changedAt: observedAt,
      },
      connection_status_source_id:
        workerId === workerA
          ? '99999999-9999-4999-8999-999999999991'
          : '99999999-9999-4999-8999-999999999992',
      connection_status_order: order,
      connection_status_observed_at: observedAt,
      connection_online_acknowledged: true,
      runtime_generation: 23,
      lifecycle_operation_id: null,
    });
    const recoveredByWorker = new Map([
      [
        workerA,
        recoveredWorker(
          workerA,
          'baileys',
          EWorkerType.baileys,
          '8107',
          '2026-08-09T03:40:30.000Z'
        ),
      ],
      [
        workerB,
        recoveredWorker(
          workerB,
          'wwebjs',
          EWorkerType.wwebjs,
          '8207',
          '2026-08-09T03:40:31.000Z'
        ),
      ],
    ]);
    const initialProjection = (
      workerId: string,
      operationId: string,
      targetProvider: 'baileys' | 'wwebjs',
      targetType: EWorkerType,
      baselineOrder: string,
      observedAt: string
    ) => ({
      ...recoveredByWorker.get(workerId),
      status: { id: EWorkerStatus.recreating, name: 'recreating' },
      type: { id: targetType, name: targetProvider },
      connection_status: {
        provider: targetProvider,
        status: EWhatsappConnectionStatus.connecting,
        connected: false,
        authenticated: false,
        sessionValid: true,
        recoverable: true,
        qrAvailable: false,
        sequence: Number(baselineOrder),
        changedAt: observedAt,
      },
      connection_status_order: baselineOrder,
      connection_status_observed_at: observedAt,
      connection_online_acknowledged: false,
      lifecycle_operation_id: operationId,
      recreate_phase: EWorkerRecreatePhase.connecting,
      recreate_phase_observed_at: observedAt,
      recreate_runtime_retired: false,
    });
    expect(
      presentationStore.hydrateWorkerChannel(
        initialProjection(
          workerA,
          operationA,
          'wwebjs',
          EWorkerType.wwebjs,
          '8106',
          '2026-08-09T03:40:00.000Z'
        )
      )
    ).toBe(true);
    expect(
      presentationStore.hydrateWorkerChannel(
        initialProjection(
          workerB,
          operationB,
          'baileys',
          EWorkerType.baileys,
          '8206',
          '2026-08-09T03:40:01.000Z'
        )
      )
    ).toBe(true);

    const viewCount = new Map<string, number>();
    channelsStore.viewWhatsappProviderHandoff.mockImplementation(
      async (workerId: string) => {
        const count = (viewCount.get(workerId) ?? 0) + 1;
        viewCount.set(workerId, count);
        const operationId = workerId === workerA ? operationA : operationB;
        return {
          kind: 'found',
          handoff: handoff(workerId, operationId, {
            state: 'failed',
            error_code: 'target_validation_failed',
            recovery_state: count === 1 ? 'running' : 'completed',
            recovery_error_code: null,
            source_revision_preserved: true,
            source_runtime_restored: count > 1,
            resolution_required: true,
            can_return: true,
            can_discard: true,
            resolution_status: 'awaiting_decision',
            created_at: '2026-08-09T03:39:00.000Z',
            updated_at:
              count === 1
                ? '2026-08-09T03:40:20.000Z'
                : '2026-08-09T03:40:32.000Z',
          }),
        };
      }
    );
    const workerReadCount = new Map<string, number>();
    channelsStore.getWorkerById.mockImplementation((workerId: string) => {
      const count = (workerReadCount.get(workerId) ?? 0) + 1;
      workerReadCount.set(workerId, count);
      if (count === 1) return firstWorkers.get(workerId)?.promise;
      return Promise.resolve(recoveredByWorker.get(workerId));
    });
    const loaded = loadComposable(
      channelsStore,
      presentationStore as unknown as PresentationStoreMock
    );
    const recovery = loaded.useWhatsappProviderHandoffSourceRecovery();

    const initial = recovery.refreshAll();
    await Promise.resolve();
    await Promise.resolve();
    expect(channelsStore.getWorkerById).toHaveBeenCalledTimes(2);

    const terminalA = recovery.refreshFromRecoveryPublication(
      terminalPublication(workerA, operationA),
      accountId
    );
    const terminalB = recovery.refreshFromRecoveryPublication(
      terminalPublication(workerB, operationB),
      accountId
    );
    const recoveredA = recoveredByWorker.get(workerA);
    const recoveredB = recoveredByWorker.get(workerB);
    if (!recoveredA || !recoveredB) {
      throw new Error('recovered two-worker fixtures are missing');
    }
    firstWorkers.get(workerA)?.resolve(recoveredA);
    firstWorkers.get(workerB)?.resolve(recoveredB);

    await Promise.all([initial, terminalA, terminalB]);
    expect(channelsStore.viewWhatsappProviderHandoff).toHaveBeenCalledTimes(4);
    expect(channelsStore.getWorkerById).toHaveBeenCalledTimes(4);
    expect(
      channelsStore.applyCanonicalProviderHandoffSourceRecovery
    ).toHaveBeenCalledTimes(2);
    expect(presentationStore.byWorkerId[workerA]).toMatchObject({
      workerTypeId: EWorkerType.baileys,
      workerStatusId: EWorkerStatus.online,
      lifecycleOperationId: null,
      recreatePhase: null,
    });
    expect(presentationStore.byWorkerId[workerB]).toMatchObject({
      workerTypeId: EWorkerType.wwebjs,
      workerStatusId: EWorkerStatus.online,
      lifecycleOperationId: null,
      recreatePhase: null,
    });

    await recovery.refreshFromRecoveryPublication(
      terminalPublication(workerA, operationA),
      accountId
    );
    await recovery.refreshAll();
    expect(channelsStore.viewWhatsappProviderHandoff).toHaveBeenCalledTimes(4);
    loaded.dispose();
  });

  it('shares one flight between a known active handoff and its passive marker', async () => {
    const { channelsStore, presentationStore } = stores([
      [workerA, operationA],
    ]);
    const recovered = deferred<{ id: string }>();
    channelsStore.getWorkerById.mockReturnValueOnce(recovered.promise);
    const loaded = loadComposable(channelsStore, presentationStore);
    const recovery = loaded.useWhatsappProviderHandoffSourceRecovery();

    const known = recovery.reconcileKnownHandoff(handoff(workerA, operationA));
    const passive = recovery.refreshAll();
    recovered.resolve({ id: workerA });
    await Promise.all([known, passive]);

    expect(channelsStore.viewWhatsappProviderHandoff).not.toHaveBeenCalled();
    expect(channelsStore.getWorkerById).toHaveBeenCalledTimes(1);
    expect(
      presentationStore.reconcileProviderHandoffSourceRecovery
    ).toHaveBeenCalledTimes(1);
    loaded.dispose();
  });

  it('replays a completed known handoff queued behind an older running recovery flight', async () => {
    const { channelsStore } = stores([[workerA, operationA]]);
    const presentationStore = usePresentationStore();
    const firstWorker = deferred<Record<string, unknown>>();
    const recoveredWorker = {
      id: workerA,
      name: 'Baileys',
      session_storage: 'postgres',
      number: '556192037138',
      status: { id: EWorkerStatus.online, name: 'online' },
      type: { id: EWorkerType.baileys, name: 'baileys' },
      connection_date: null,
      last_connection_check_at: null,
      recreate_available_at: null,
      created_at: null,
      updated_at: null,
      connection_status: {
        provider: 'baileys',
        status: EWhatsappConnectionStatus.online,
        connected: true,
        authenticated: true,
        sessionValid: true,
        recoverable: true,
        qrAvailable: false,
        sequence: 19,
        changedAt: '2026-08-08T22:25:38.471Z',
      },
      connection_status_source_id: '66666666-6666-4666-8666-666666666666',
      connection_status_order: '7507',
      connection_status_observed_at: '2026-08-08T22:25:38.471Z',
      connection_online_acknowledged: true,
      runtime_generation: 19,
      lifecycle_operation_id: null,
    };
    expect(
      presentationStore.hydrateWorkerChannel({
        ...recoveredWorker,
        status: { id: EWorkerStatus.recreating, name: 'recreating' },
        type: { id: EWorkerType.wwebjs, name: 'wwebjs' },
        connection_status: {
          ...recoveredWorker.connection_status,
          provider: 'wwebjs',
          status: EWhatsappConnectionStatus.connecting,
          connected: false,
          authenticated: false,
          sequence: 18,
          changedAt: '2026-08-08T22:25:00.000Z',
        },
        connection_status_order: '7506',
        connection_status_observed_at: '2026-08-08T22:25:00.000Z',
        connection_online_acknowledged: false,
        lifecycle_operation_id: operationA,
        recreate_phase: EWorkerRecreatePhase.connecting,
        recreate_phase_observed_at: '2026-08-08T22:25:00.000Z',
        recreate_runtime_retired: false,
      })
    ).toBe(true);
    expect(presentationStore.byWorkerId[workerA]).toMatchObject({
      workerTypeId: EWorkerType.wwebjs,
      workerStatusId: EWorkerStatus.recreating,
      runtimeGeneration: 19,
      lifecycleOperationId: operationA,
      recreatePhase: EWorkerRecreatePhase.connecting,
    });
    const handoffSnapshot = {
      state: 'failed',
      error_code: 'wwebjs_canonical_reload_runtime_stability_timeout',
      recovery_error_code: null,
      source_revision_preserved: true,
      resolution_required: true,
      can_return: true,
      can_discard: true,
      resolution_status: 'awaiting_decision',
      created_at: '2026-08-08T22:24:00.000Z',
    } satisfies Partial<Handoff>;
    const runningHandoff = handoff(workerA, operationA, {
      ...handoffSnapshot,
      recovery_state: 'running',
      source_runtime_restored: false,
      updated_at: '2026-08-08T22:25:37.000Z',
    });
    const completedHandoff = handoff(workerA, operationA, {
      ...handoffSnapshot,
      recovery_state: 'completed',
      source_runtime_restored: true,
      updated_at: '2026-08-08T22:26:00.137Z',
    });
    channelsStore.viewWhatsappProviderHandoff.mockResolvedValueOnce({
      kind: 'found',
      handoff: runningHandoff,
    });
    channelsStore.getWorkerById
      .mockReturnValueOnce(firstWorker.promise)
      .mockResolvedValue(recoveredWorker);
    const reconcile = jest.spyOn(
      presentationStore,
      'reconcileProviderHandoffSourceRecovery'
    );
    const loaded = loadComposable(
      channelsStore,
      presentationStore as unknown as PresentationStoreMock
    );
    const recovery = loaded.useWhatsappProviderHandoffSourceRecovery();

    const passive = recovery.refreshAll();
    await Promise.resolve();
    await Promise.resolve();
    expect(channelsStore.getWorkerById).toHaveBeenCalledTimes(1);

    const known = recovery.reconcileKnownHandoff(completedHandoff);
    firstWorker.resolve(recoveredWorker);

    await expect(Promise.all([passive, known])).resolves.toEqual([
      undefined,
      true,
    ]);
    expect(channelsStore.viewWhatsappProviderHandoff).toHaveBeenCalledTimes(1);
    expect(channelsStore.getWorkerById).toHaveBeenCalledTimes(2);
    expect(reconcile).toHaveBeenNthCalledWith(
      1,
      recoveredWorker,
      runningHandoff
    );
    expect(reconcile).toHaveBeenNthCalledWith(
      2,
      recoveredWorker,
      completedHandoff
    );
    expect(
      channelsStore.applyCanonicalProviderHandoffSourceRecovery
    ).toHaveBeenCalledTimes(1);
    expect(presentationStore.byWorkerId[workerA]).toMatchObject({
      workerTypeId: EWorkerType.baileys,
      workerStatusId: EWorkerStatus.online,
      connectionStatus: EWhatsappConnectionStatus.online,
      connectionOnlineAcknowledged: true,
      runtimeGeneration: 19,
      lifecycleOperationId: null,
      completedLifecycleOperationId: null,
      recreatePhase: null,
    });
    loaded.dispose();
  });

  it('rejects a mismatched durable handoff without sealing the retry key', async () => {
    const { channelsStore, presentationStore } = stores([
      [workerB, operationB],
    ]);
    channelsStore.viewWhatsappProviderHandoff
      .mockResolvedValueOnce({
        kind: 'found',
        handoff: handoff(workerB, operationA),
      })
      .mockResolvedValueOnce({
        kind: 'found',
        handoff: handoff(workerB, operationB),
      });
    const loaded = loadComposable(channelsStore, presentationStore);
    const recovery = loaded.useWhatsappProviderHandoffSourceRecovery();

    await recovery.refreshAll();
    expect(channelsStore.getWorkerById).not.toHaveBeenCalled();
    expect(
      presentationStore.reconcileProviderHandoffSourceRecovery
    ).not.toHaveBeenCalled();

    await recovery.refreshAll();
    expect(channelsStore.viewWhatsappProviderHandoff).toHaveBeenCalledTimes(2);
    expect(channelsStore.getWorkerById).toHaveBeenCalledTimes(1);
    expect(
      channelsStore.applyCanonicalProviderHandoffSourceRecovery
    ).toHaveBeenCalledTimes(1);
    loaded.dispose();
  });

  it('does not turn unrelated lifecycle telemetry into handoff polling', async () => {
    const { channelsStore, presentationStore } = stores([
      [workerA, operationA],
    ]);
    const loaded = loadComposable(channelsStore, presentationStore);
    const recovery = loaded.useWhatsappProviderHandoffSourceRecovery();

    await recovery.refreshFromLifecyclePublication({
      worker_id: workerA,
      lifecycle_operation_id: null,
      worker_status_id: EWorkerStatus.recreating,
    });
    await recovery.refreshFromLifecyclePublication({
      worker_id: workerA,
      lifecycle_operation_id: operationB,
      worker_status_id: EWorkerStatus.recreating,
    });
    expect(channelsStore.viewWhatsappProviderHandoff).not.toHaveBeenCalled();

    await recovery.refreshFromLifecyclePublication({
      worker_id: workerA,
      lifecycle_operation_id: null,
      worker_status_id: EWorkerStatus.online,
    });
    expect(channelsStore.viewWhatsappProviderHandoff).toHaveBeenCalledTimes(1);
    expect(
      presentationStore.reconcileProviderHandoffSourceRecovery
    ).toHaveBeenCalledTimes(1);
    loaded.dispose();
  });

  it('rejects recovery publications outside the exact account, worker and operation fence', async () => {
    const { channelsStore, presentationStore } = stores([
      [workerA, operationA],
    ]);
    const loaded = loadComposable(channelsStore, presentationStore);
    const recovery = loaded.useWhatsappProviderHandoffSourceRecovery();

    await recovery.refreshFromRecoveryPublication(
      terminalPublication(workerA, operationA),
      'different-account'
    );
    await recovery.refreshFromRecoveryPublication(
      {
        ...terminalPublication(workerA, operationA),
        handoff_lifecycle_operation_id: operationB,
      },
      accountId
    );
    await recovery.refreshFromRecoveryPublication(
      {
        ...terminalPublication(workerA, operationA),
        recovery_operation_id: operationA,
      },
      accountId
    );

    expect(channelsStore.viewWhatsappProviderHandoff).not.toHaveBeenCalled();
    expect(channelsStore.getWorkerById).not.toHaveBeenCalled();
    loaded.dispose();
  });

  it('retries until both the canonical reducer and legacy mirror accept', async () => {
    const { channelsStore, presentationStore } = stores([
      [workerA, operationA],
    ]);
    channelsStore.applyCanonicalProviderHandoffSourceRecovery
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const loaded = loadComposable(channelsStore, presentationStore);
    const recovery = loaded.useWhatsappProviderHandoffSourceRecovery();

    await recovery.refreshAll();
    await recovery.refreshAll();

    expect(channelsStore.viewWhatsappProviderHandoff).toHaveBeenCalledTimes(2);
    expect(channelsStore.getWorkerById).toHaveBeenCalledTimes(2);
    expect(
      presentationStore.reconcileProviderHandoffSourceRecovery
    ).toHaveBeenCalledTimes(2);
    expect(
      channelsStore.applyCanonicalProviderHandoffSourceRecovery
    ).toHaveBeenCalledTimes(2);
    loaded.dispose();
  });

  it('reconciles an active canonical operation after another tab removes its list marker', async () => {
    const { channelsStore, presentationStore } = stores();
    presentationStore.byWorkerId[workerA] = {
      workerId: workerA,
      lifecycleOperationId: operationA,
    };
    channelsStore.viewWhatsappProviderHandoff.mockResolvedValueOnce({
      kind: 'found',
      handoff: handoff(workerA, operationA),
    });
    const loaded = loadComposable(channelsStore, presentationStore);
    const recovery = loaded.useWhatsappProviderHandoffSourceRecovery();

    await recovery.refreshAll();

    expect(channelsStore.viewWhatsappProviderHandoff).toHaveBeenCalledWith(
      workerA,
      { silent: true }
    );
    expect(channelsStore.getWorkerById).toHaveBeenCalledWith(workerA);
    expect(
      presentationStore.reconcileProviderHandoffSourceRecovery
    ).toHaveBeenCalledTimes(1);
    loaded.dispose();
  });

  it('reconciles an active return resolution operation without a list marker', async () => {
    const { channelsStore, presentationStore } = stores();
    presentationStore.byWorkerId[workerA] = {
      workerId: workerA,
      lifecycleOperationId: resolutionOperation,
    };
    channelsStore.viewWhatsappProviderHandoff.mockResolvedValueOnce({
      kind: 'found',
      handoff: handoff(workerA, operationA, {
        lifecycle_operation_id: resolutionOperation,
        resolution_action: 'return',
        resolution_state: 'completed',
        resolution_operation_id: resolutionOperation,
      }),
    });
    const loaded = loadComposable(channelsStore, presentationStore);
    const recovery = loaded.useWhatsappProviderHandoffSourceRecovery();

    await recovery.refreshAll();

    expect(channelsStore.viewWhatsappProviderHandoff).toHaveBeenCalledWith(
      workerA,
      { silent: true }
    );
    expect(channelsStore.getWorkerById).toHaveBeenCalledWith(workerA);
    expect(
      presentationStore.reconcileProviderHandoffSourceRecovery
    ).toHaveBeenCalledTimes(1);
    loaded.dispose();
  });

  it.each([operationA, resolutionOperation])(
    'heals a fresh online/no-marker projection after late lifecycle operation %s creates an active candidate',
    async (lateOperationId) => {
      const { channelsStore, presentationStore } = stores();
      presentationStore.byWorkerId[workerA] = {
        workerId: workerA,
        lifecycleOperationId: null,
      };
      channelsStore.viewWhatsappProviderHandoff.mockResolvedValueOnce({
        kind: 'found',
        handoff: handoff(workerA, operationA, {
          lifecycle_operation_id: lateOperationId,
          resolution_action: 'return',
          resolution_state: 'completed',
          resolution_operation_id: resolutionOperation,
        }),
      });
      const loaded = loadComposable(channelsStore, presentationStore);
      const recovery = loaded.useWhatsappProviderHandoffSourceRecovery();

      await recovery.refreshAll();
      expect(channelsStore.viewWhatsappProviderHandoff).not.toHaveBeenCalled();

      // channels.vue applies the publication to the canonical reducer first;
      // the same synchronous turn therefore exposes this exact active op to
      // the passive reconciler without scanning every healthy worker.
      presentationStore.byWorkerId[workerA] = {
        workerId: workerA,
        lifecycleOperationId: lateOperationId,
      };
      await recovery.refreshFromLifecyclePublication({
        worker_id: workerA,
        lifecycle_operation_id: lateOperationId,
        worker_status_id: EWorkerStatus.recreating,
      });

      expect(channelsStore.viewWhatsappProviderHandoff).toHaveBeenCalledTimes(
        1
      );
      expect(channelsStore.getWorkerById).toHaveBeenCalledWith(workerA);
      expect(
        presentationStore.reconcileProviderHandoffSourceRecovery
      ).toHaveBeenCalledTimes(1);
      expect(
        channelsStore.applyCanonicalProviderHandoffSourceRecovery
      ).toHaveBeenCalledTimes(1);
      loaded.dispose();
    }
  );

  it('accepts an exact completed return resolution and rejects operation disagreement', async () => {
    const { channelsStore, presentationStore } = stores([
      [workerA, operationA],
      [workerB, operationB],
    ]);
    channelsStore.viewWhatsappProviderHandoff.mockImplementation(
      async (workerId: string) =>
        workerId === workerA
          ? {
              kind: 'found',
              handoff: handoff(workerA, operationA, {
                lifecycle_operation_id: resolutionOperation,
                resolution_action: 'return',
                resolution_state: 'completed',
                resolution_operation_id: resolutionOperation,
              }),
            }
          : {
              kind: 'found',
              handoff: handoff(workerB, operationB, {
                lifecycle_operation_id: operationA,
              }),
            }
    );
    const loaded = loadComposable(channelsStore, presentationStore);
    const recovery = loaded.useWhatsappProviderHandoffSourceRecovery();

    await recovery.refreshAll();

    expect(channelsStore.getWorkerById).toHaveBeenCalledTimes(1);
    expect(channelsStore.getWorkerById).toHaveBeenCalledWith(workerA);
    expect(
      presentationStore.reconcileProviderHandoffSourceRecovery
    ).toHaveBeenCalledTimes(1);
    loaded.dispose();
  });
});
