import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';

type Handoff = {
  worker_id: string;
  handoff_id: string;
  lifecycle_operation_id: string;
  handoff_lifecycle_operation_id: string | null;
  state: string;
  source_provider: 'whatsmeow';
  target_provider: 'baileys';
  source_revision_id: string;
  target_revision_id: string | null;
  error_code: string | null;
  recovery_state: 'completed' | 'pending' | 'running';
  recovery_operation_id: string | null;
  recovery_error_code: string | null;
  source_revision_preserved: boolean;
  source_runtime_restored: boolean;
  resolution_required: boolean;
  can_return: boolean;
  can_discard: boolean;
  resolution_status:
    'awaiting_decision' | 'completed' | 'in_progress' | 'restoring_source';
  resolution_action: 'discard' | 'return' | null;
  resolution_state: 'running' | 'completed' | null;
  resolution_operation_id: string | null;
  created_at: string;
  updated_at: string;
};

const workerId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const staleOperationId = '33333333-3333-4333-8333-333333333333';
const resolutionOperationId = '33333333-3333-7333-8333-333333333333';
const handoffId = '44444444-4444-4444-8444-444444444444';
const recoveryOperationId = '55555555-5555-7555-8555-555555555556';
const viewWhatsappProviderHandoff = jest.fn();
const resolveWhatsappProviderHandoff = jest.fn();
let beforeUnmount: (() => void) | null = null;

const failedHandoff = (overrides: Partial<Handoff> = {}): Handoff => ({
  worker_id: workerId,
  handoff_id: handoffId,
  lifecycle_operation_id: operationId,
  handoff_lifecycle_operation_id: operationId,
  state: 'failed',
  source_provider: 'whatsmeow',
  target_provider: 'baileys',
  source_revision_id: '1',
  target_revision_id: '2',
  error_code: 'codec_failed',
  recovery_state: 'completed',
  recovery_operation_id: recoveryOperationId,
  recovery_error_code: null,
  source_revision_preserved: true,
  source_runtime_restored: true,
  resolution_required: true,
  can_return: true,
  can_discard: true,
  resolution_status: 'awaiting_decision',
  resolution_action: null,
  resolution_state: null,
  resolution_operation_id: null,
  created_at: '2026-08-04T20:00:00.000Z',
  updated_at: '2026-08-04T20:01:00.000Z',
  ...overrides,
});

const completedReturnHandoff = (overrides: Partial<Handoff> = {}): Handoff =>
  failedHandoff({
    lifecycle_operation_id: resolutionOperationId,
    handoff_lifecycle_operation_id: operationId,
    resolution_required: false,
    resolution_status: 'completed',
    resolution_action: 'return',
    resolution_state: 'completed',
    resolution_operation_id: resolutionOperationId,
    ...overrides,
  });

const loadComposable = () => {
  const filename = resolve(
    process.cwd(),
    'apps/web/src/composables/useWhatsappProviderHandoffRecovery.ts'
  );
  const source = readFileSync(filename, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} as Record<string, unknown> };
  const moduleRequire = (moduleId: string): unknown => {
    if (moduleId === 'vue') {
      return {
        computed: (getter: () => unknown) => ({
          get value() {
            return getter();
          },
        }),
        onBeforeUnmount: (callback: () => void) => {
          beforeUnmount = callback;
        },
        readonly: <T>(value: T) => value,
        shallowRef: <T>(value?: T) => ({ value }),
      };
    }
    if (moduleId === '@core/common/enums/EWorkerType') {
      return { EWorkerType };
    }
    if (moduleId === '@core/common/enums/EWorkerStatus') {
      return { EWorkerStatus };
    }
    if (moduleId === '@core/common/functions/whatsappConnectionStatus') {
      return {
        isWhatsappConnectionOnline: (snapshot?: {
          status?: string;
          connected?: boolean;
          authenticated?: boolean;
          sessionValid?: boolean;
          qrAvailable?: boolean;
        }) =>
          snapshot?.status === 'online' &&
          snapshot.connected === true &&
          snapshot.authenticated === true &&
          snapshot.sessionValid === true &&
          snapshot.qrAvailable === false,
      };
    }
    if (moduleId === '@/@webcore/stores/channels') {
      return {
        useChannelsStore: () => ({
          viewWhatsappProviderHandoff,
          resolveWhatsappProviderHandoff,
        }),
      };
    }
    if (moduleId === '@/@webcore/utils/connectionLifecycleDebug') {
      return { logConnectionLifecycleDebug: jest.fn() };
    }
    throw new Error(`Unexpected handoff composable dependency: ${moduleId}`);
  };
  const evaluate = new Function('require', 'module', 'exports', transpiled) as (
    requireModule: (moduleId: string) => unknown,
    module: typeof loaded,
    exports: Record<string, unknown>
  ) => void;
  evaluate(moduleRequire, loaded, loaded.exports);
  return loaded.exports as {
    isWhatsappProviderHandoffTargetOnline: (
      channel: {
        type?: { id?: string | null } | null;
        status?: { id?: string | null } | null;
        connection_status?: {
          status?: string;
          connected?: boolean;
          authenticated?: boolean;
          sessionValid?: boolean;
          qrAvailable?: boolean;
        } | null;
        connection_online_acknowledged?: boolean | null;
      },
      targetProvider: 'baileys' | 'whatsmeow' | 'wwebjs'
    ) => boolean;
    useWhatsappProviderHandoffRecovery: (options: Record<string, unknown>) => {
      handoff: { value?: Handoff };
      isDialogVisible: { value: boolean };
      loadingAction: { value: 'discard' | 'return' | null };
      pendingAction: { value: 'discard' | 'return' | null };
      decisionReason: { value: 'cancel' | 'failure' | 'timeout' };
      start: (context: Record<string, unknown>) => void;
      refresh: (options?: {
        terminal?: boolean;
        targetReady?: boolean;
        replayIfInFlight?: boolean;
      }) => Promise<void>;
      resolve: (action: 'discard' | 'return') => Promise<void>;
      retry: () => Promise<void>;
      requestDecision: (reason: 'cancel' | 'timeout') => Promise<boolean>;
      stop: () => void;
    };
  };
};

const context = {
  workerId,
  lifecycleOperationId: operationId,
  sourceProvider: 'whatsmeow',
  targetProvider: 'baileys',
  targetWorkerType: EWorkerType.baileys,
  debugTraceId: 'trace-1',
};

const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('useWhatsappProviderHandoffRecovery', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    viewWhatsappProviderHandoff.mockReset();
    resolveWhatsappProviderHandoff.mockReset();
    beforeUnmount = null;
  });

  afterEach(() => {
    beforeUnmount?.();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('recognizes only an acknowledged online projection for the requested target', () => {
    const { isWhatsappProviderHandoffTargetOnline } = loadComposable();
    const targetProjection = {
      type: { id: EWorkerType.baileys },
      status: { id: EWorkerStatus.online },
      connection_status: {
        status: 'online',
        connected: true,
        authenticated: true,
        sessionValid: true,
        qrAvailable: false,
      },
      connection_online_acknowledged: true,
    };

    expect(
      isWhatsappProviderHandoffTargetOnline(targetProjection, 'baileys')
    ).toBe(true);
    expect(
      isWhatsappProviderHandoffTargetOnline(
        { ...targetProjection, connection_online_acknowledged: false },
        'baileys'
      )
    ).toBe(false);
    expect(
      isWhatsappProviderHandoffTargetOnline(targetProjection, 'wwebjs')
    ).toBe(false);
  });

  it('does not retry a stale latest handoff on a timer', async () => {
    const onRecoveryRequired = jest.fn();
    viewWhatsappProviderHandoff.mockResolvedValueOnce({
      kind: 'found',
      handoff: failedHandoff({
        lifecycle_operation_id: staleOperationId,
      }),
    });
    const { useWhatsappProviderHandoffRecovery } = loadComposable();
    const recovery = useWhatsappProviderHandoffRecovery({
      onRecoveryRequired,
    });

    recovery.start(context);
    await flushPromises();
    expect(recovery.isDialogVisible.value).toBe(false);
    expect(onRecoveryRequired).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1_000);
    await flushPromises();
    expect(recovery.isDialogVisible.value).toBe(false);
    expect(onRecoveryRequired).not.toHaveBeenCalled();
    expect(viewWhatsappProviderHandoff).toHaveBeenCalledTimes(1);
    expect(
      viewWhatsappProviderHandoff.mock.calls.every(
        ([observedWorkerId]) => observedWorkerId === workerId
      )
    ).toBe(true);
  });

  it('opens a safe decision surface when the operator cancels a running handoff', async () => {
    viewWhatsappProviderHandoff
      .mockResolvedValueOnce({ kind: 'not_found' })
      .mockResolvedValueOnce({
        kind: 'found',
        handoff: failedHandoff({
          state: 'running',
          recovery_state: 'running',
          source_runtime_restored: false,
          can_return: false,
          can_discard: false,
        }),
      });
    const { useWhatsappProviderHandoffRecovery } = loadComposable();
    const recovery = useWhatsappProviderHandoffRecovery({});

    recovery.start(context);
    await flushPromises();
    expect(recovery.isDialogVisible.value).toBe(false);

    await expect(recovery.requestDecision('cancel')).resolves.toBe(true);

    expect(recovery.decisionReason.value).toBe('cancel');
    expect(recovery.handoff.value?.state).toBe('running');
    expect(recovery.isDialogVisible.value).toBe(true);
    expect(viewWhatsappProviderHandoff).toHaveBeenCalledTimes(2);
  });

  it('retires a stale failed handoff after reload only when the page proves the target is live', async () => {
    const onRecoveryRequired = jest.fn();
    const onTargetReady = jest.fn().mockResolvedValue(true);
    viewWhatsappProviderHandoff.mockResolvedValueOnce({
      kind: 'found',
      handoff: failedHandoff(),
    });
    const { useWhatsappProviderHandoffRecovery } = loadComposable();
    const recovery = useWhatsappProviderHandoffRecovery({
      onRecoveryRequired,
      onTargetReady,
    });

    recovery.start({ ...context, origin: 'resumed', handoffId });
    await flushPromises();

    expect(onTargetReady).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'resumed', handoffId }),
      { freshSession: false, requireLiveTarget: true }
    );
    expect(onRecoveryRequired).not.toHaveBeenCalled();
    expect(recovery.handoff.value).toBeUndefined();
    expect(recovery.isDialogVisible.value).toBe(false);
  });

  it('keeps a failed recovery actionable when the target cannot be verified after reload', async () => {
    const onRecoveryRequired = jest.fn();
    const onTargetReady = jest.fn().mockResolvedValue(false);
    viewWhatsappProviderHandoff.mockResolvedValueOnce({
      kind: 'found',
      handoff: failedHandoff(),
    });
    const { useWhatsappProviderHandoffRecovery } = loadComposable();
    const recovery = useWhatsappProviderHandoffRecovery({
      onRecoveryRequired,
      onTargetReady,
    });

    recovery.start({ ...context, origin: 'resumed', handoffId });
    await flushPromises();

    expect(onTargetReady).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'resumed', handoffId }),
      { freshSession: false, requireLiveTarget: true }
    );
    expect(onRecoveryRequired).toHaveBeenCalledTimes(1);
    expect(recovery.handoff.value?.state).toBe('failed');
    expect(recovery.isDialogVisible.value).toBe(true);
  });

  it('keeps an automatically restored source decision visible without resolving it', async () => {
    const onRecoveryRequired = jest.fn();
    const onSourceReturned = jest.fn();
    const reconcileRecoveredSource = jest.fn().mockResolvedValue(true);
    viewWhatsappProviderHandoff.mockResolvedValueOnce({
      kind: 'found',
      handoff: failedHandoff({
        recovery_state: 'completed',
        source_revision_preserved: true,
        source_runtime_restored: true,
        resolution_required: true,
        resolution_action: null,
        resolution_state: null,
      }),
    });
    const { useWhatsappProviderHandoffRecovery } = loadComposable();
    const recovery = useWhatsappProviderHandoffRecovery({
      onRecoveryRequired: async (...args: unknown[]) => {
        onRecoveryRequired(...args);
        await reconcileRecoveredSource(...args);
      },
      onSourceReturned,
    });

    recovery.start({ ...context, origin: 'initiated', handoffId });
    await flushPromises();

    expect(onRecoveryRequired).toHaveBeenCalledTimes(1);
    expect(reconcileRecoveredSource).toHaveBeenCalledTimes(1);
    expect(onSourceReturned).not.toHaveBeenCalled();
    expect(recovery.handoff.value).toMatchObject({
      source_runtime_restored: true,
      resolution_required: true,
      can_return: true,
      can_discard: true,
    });
    expect(recovery.pendingAction.value).toBeNull();
    expect(recovery.isDialogVisible.value).toBe(true);
  });

  it('replays one durable terminal refresh that arrives behind an older running snapshot request', async () => {
    let resolveInitial!: (value: unknown) => void;
    const onRecoveryRequired = jest.fn();
    viewWhatsappProviderHandoff
      .mockReturnValueOnce(
        new Promise((resolvePromise) => {
          resolveInitial = resolvePromise;
        })
      )
      .mockResolvedValueOnce({
        kind: 'found',
        handoff: failedHandoff({
          recovery_state: 'completed',
          source_runtime_restored: true,
        }),
      });
    const { useWhatsappProviderHandoffRecovery } = loadComposable();
    const recovery = useWhatsappProviderHandoffRecovery({
      onRecoveryRequired,
    });

    recovery.start({ ...context, handoffId });
    await Promise.resolve();
    await recovery.refresh({ replayIfInFlight: true });
    expect(viewWhatsappProviderHandoff).toHaveBeenCalledTimes(1);

    resolveInitial({
      kind: 'found',
      handoff: failedHandoff({
        recovery_state: 'running',
        source_runtime_restored: false,
      }),
    });
    await flushPromises();
    await flushPromises();

    expect(viewWhatsappProviderHandoff).toHaveBeenCalledTimes(2);
    expect(onRecoveryRequired).toHaveBeenCalledTimes(2);
    expect(recovery.handoff.value).toMatchObject({
      recovery_state: 'completed',
      source_runtime_restored: true,
    });
    expect(recovery.isDialogVisible.value).toBe(true);
  });

  it('retires a stale failure from one acknowledged target lifecycle refresh', async () => {
    const onRecoveryRequired = jest.fn();
    const onTargetReady = jest.fn().mockResolvedValue(true);
    viewWhatsappProviderHandoff
      .mockResolvedValueOnce({ kind: 'found', handoff: failedHandoff() })
      .mockResolvedValueOnce({ kind: 'found', handoff: failedHandoff() });
    const { useWhatsappProviderHandoffRecovery } = loadComposable();
    const recovery = useWhatsappProviderHandoffRecovery({
      onRecoveryRequired,
      onTargetReady,
    });

    recovery.start({ ...context, origin: 'initiated', handoffId });
    await flushPromises();
    expect(onRecoveryRequired).toHaveBeenCalledTimes(1);

    await recovery.refresh({ terminal: true, targetReady: true });

    expect(onTargetReady).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'initiated', handoffId }),
      { freshSession: false, requireLiveTarget: true }
    );
    expect(recovery.isDialogVisible.value).toBe(false);
    expect(recovery.handoff.value).toBeUndefined();
    expect(viewWhatsappProviderHandoff).toHaveBeenCalledTimes(2);
  });

  it('uses an acknowledged target lifecycle event to close a compacted handoff once', async () => {
    const onTargetReady = jest.fn().mockResolvedValue(true);
    viewWhatsappProviderHandoff.mockResolvedValue({ kind: 'not_found' });
    const { useWhatsappProviderHandoffRecovery } = loadComposable();
    const recovery = useWhatsappProviderHandoffRecovery({ onTargetReady });

    recovery.start(context);
    await flushPromises();
    expect(onTargetReady).not.toHaveBeenCalled();

    await recovery.refresh({ terminal: true, targetReady: true });

    expect(onTargetReady).toHaveBeenCalledWith(context, {
      freshSession: false,
      requireLiveTarget: true,
    });
    expect(recovery.handoff.value).toBeUndefined();
    expect(recovery.isDialogVisible.value).toBe(false);
    expect(viewWhatsappProviderHandoff).toHaveBeenCalledTimes(2);
  });

  it('discards a late snapshot response after stop', async () => {
    let resolveRequest!: (value: unknown) => void;
    viewWhatsappProviderHandoff.mockReturnValueOnce(
      new Promise((resolvePromise) => {
        resolveRequest = resolvePromise;
      })
    );
    const onRecoveryRequired = jest.fn();
    const { useWhatsappProviderHandoffRecovery } = loadComposable();
    const recovery = useWhatsappProviderHandoffRecovery({ onRecoveryRequired });

    recovery.start(context);
    jest.advanceTimersByTime(100);
    expect(viewWhatsappProviderHandoff).toHaveBeenCalledTimes(1);

    recovery.stop();
    resolveRequest({ kind: 'found', handoff: failedHandoff() });
    await flushPromises();
    expect(recovery.isDialogVisible.value).toBe(false);
    expect(onRecoveryRequired).not.toHaveBeenCalled();
  });

  it('confirms a queued discard once without polling', async () => {
    const onTargetReady = jest.fn().mockResolvedValue(true);
    viewWhatsappProviderHandoff
      .mockResolvedValueOnce({
        kind: 'found',
        handoff: failedHandoff(),
      })
      .mockResolvedValueOnce({
        kind: 'found',
        handoff: failedHandoff({
          resolution_action: 'discard',
          resolution_state: 'completed',
        }),
      });
    resolveWhatsappProviderHandoff.mockResolvedValueOnce({
      action: 'discard',
      status: 'queued',
      reason: 'session_discard_queued',
      handoff: failedHandoff(),
      operation_id: handoffId,
    });
    const { useWhatsappProviderHandoffRecovery } = loadComposable();
    const recovery = useWhatsappProviderHandoffRecovery({ onTargetReady });

    recovery.start(context);
    await flushPromises();
    await recovery.resolve('discard');
    expect(viewWhatsappProviderHandoff).toHaveBeenCalledTimes(2);
    expect(onTargetReady).toHaveBeenCalledWith(context, {
      freshSession: true,
    });
    expect(recovery.loadingAction.value).toBeNull();

    jest.advanceTimersByTime(1_000);
    await flushPromises();
    expect(resolveWhatsappProviderHandoff).toHaveBeenCalledTimes(1);
    expect(viewWhatsappProviderHandoff).toHaveBeenCalledTimes(2);
    expect(recovery.loadingAction.value).toBeNull();
  });

  it('closes recovery only after the source return is acknowledged', async () => {
    const onSourceReturned = jest.fn();
    viewWhatsappProviderHandoff.mockResolvedValueOnce({
      kind: 'found',
      handoff: failedHandoff(),
    });
    resolveWhatsappProviderHandoff.mockResolvedValueOnce({
      action: 'return',
      status: 'completed',
      reason: 'source_restored',
      handoff: completedReturnHandoff(),
    });
    const { useWhatsappProviderHandoffRecovery } = loadComposable();
    const recovery = useWhatsappProviderHandoffRecovery({ onSourceReturned });

    recovery.start(context);
    await flushPromises();
    expect(recovery.isDialogVisible.value).toBe(true);
    await recovery.resolve('return');

    expect(onSourceReturned).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ handoff_id: handoffId })
    );
    expect(recovery.isDialogVisible.value).toBe(false);
    expect(recovery.loadingAction.value).toBeNull();
  });

  it('keeps a completed return inert while source projection reconciliation is pending', async () => {
    let finishProjection!: () => void;
    const projection = new Promise<void>((resolve) => {
      finishProjection = resolve;
    });
    const onSourceReturned = jest.fn(() => projection);
    viewWhatsappProviderHandoff.mockResolvedValueOnce({
      kind: 'found',
      handoff: failedHandoff(),
    });
    resolveWhatsappProviderHandoff.mockResolvedValueOnce({
      action: 'return',
      status: 'completed',
      reason: 'source_restored',
      handoff: completedReturnHandoff(),
    });
    const { useWhatsappProviderHandoffRecovery } = loadComposable();
    const recovery = useWhatsappProviderHandoffRecovery({ onSourceReturned });

    recovery.start(context);
    await flushPromises();
    const resolving = recovery.resolve('return');
    await flushPromises();

    expect(onSourceReturned).toHaveBeenCalledTimes(1);
    expect(recovery.isDialogVisible.value).toBe(true);
    expect(recovery.loadingAction.value).toBe('return');
    await recovery.resolve('discard');
    expect(resolveWhatsappProviderHandoff).toHaveBeenCalledTimes(1);

    finishProjection();
    await resolving;
    expect(recovery.isDialogVisible.value).toBe(false);
    expect(recovery.loadingAction.value).toBeNull();
  });

  it('confirms a queued return once without polling and allows an idempotent retry', async () => {
    const onSourceReturned = jest.fn();
    const queuedReturn = failedHandoff({
      recovery_state: 'pending',
      source_runtime_restored: false,
      can_discard: false,
      resolution_status: 'restoring_source',
      resolution_action: 'return',
      resolution_state: 'running',
    });
    viewWhatsappProviderHandoff
      .mockResolvedValueOnce({
        kind: 'found',
        handoff: failedHandoff(),
      })
      .mockResolvedValueOnce({
        kind: 'found',
        handoff: queuedReturn,
      });
    resolveWhatsappProviderHandoff
      .mockResolvedValueOnce({
        action: 'return',
        status: 'queued',
        reason: 'source_restore_queued',
        handoff: queuedReturn,
        operation_id: handoffId,
      })
      .mockResolvedValueOnce({
        action: 'return',
        status: 'completed',
        reason: 'source_restored',
        handoff: completedReturnHandoff(),
        operation_id: handoffId,
      });
    const { useWhatsappProviderHandoffRecovery } = loadComposable();
    const recovery = useWhatsappProviderHandoffRecovery({ onSourceReturned });

    recovery.start(context);
    await flushPromises();
    await recovery.resolve('return');

    expect(resolveWhatsappProviderHandoff).toHaveBeenCalledTimes(1);
    // The post-decision read resolves an HTTP/lifecycle race once; no timer
    // keeps calling `latest` while recovery is running.
    expect(viewWhatsappProviderHandoff).toHaveBeenCalledTimes(2);
    expect(recovery.loadingAction.value).toBeNull();
    expect(recovery.pendingAction.value).toBe('return');
    expect(recovery.isDialogVisible.value).toBe(true);

    jest.advanceTimersByTime(30_000);
    await flushPromises();
    expect(viewWhatsappProviderHandoff).toHaveBeenCalledTimes(2);

    await recovery.retry();

    expect(resolveWhatsappProviderHandoff).toHaveBeenCalledTimes(2);
    expect(onSourceReturned).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ handoff_id: handoffId })
    );
    expect(recovery.pendingAction.value).toBeNull();
    expect(recovery.loadingAction.value).toBeNull();
    expect(recovery.isDialogVisible.value).toBe(false);
  });

  it('finishes a return that completed between the queued response and one confirmation read', async () => {
    const onSourceReturned = jest.fn();
    const queuedReturn = failedHandoff({
      recovery_state: 'pending',
      resolution_status: 'restoring_source',
      resolution_action: 'return',
      resolution_state: 'running',
    });
    viewWhatsappProviderHandoff
      .mockResolvedValueOnce({
        kind: 'found',
        handoff: failedHandoff(),
      })
      .mockResolvedValueOnce({
        kind: 'found',
        handoff: completedReturnHandoff(),
      });
    resolveWhatsappProviderHandoff.mockResolvedValueOnce({
      action: 'return',
      status: 'queued',
      reason: 'source_restore_queued',
      handoff: queuedReturn,
      operation_id: handoffId,
    });
    const { useWhatsappProviderHandoffRecovery } = loadComposable();
    const recovery = useWhatsappProviderHandoffRecovery({ onSourceReturned });

    recovery.start(context);
    await flushPromises();
    await recovery.resolve('return');

    expect(resolveWhatsappProviderHandoff).toHaveBeenCalledTimes(1);
    expect(viewWhatsappProviderHandoff).toHaveBeenCalledTimes(2);
    expect(onSourceReturned).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ handoff_id: handoffId })
    );
    expect(recovery.loadingAction.value).toBeNull();
    expect(recovery.pendingAction.value).toBeNull();
    expect(recovery.isDialogVisible.value).toBe(false);
  });

  it('allows an explicit discard override after a pending return when the server marks it safe', async () => {
    const queuedReturn = failedHandoff({
      recovery_state: 'pending',
      source_runtime_restored: true,
      can_discard: true,
      resolution_status: 'restoring_source',
      resolution_action: 'return',
      resolution_state: 'running',
    });
    const queuedDiscard = failedHandoff({
      recovery_state: 'running',
      source_runtime_restored: true,
      can_return: false,
      can_discard: false,
      resolution_status: 'in_progress',
      resolution_action: 'discard',
      resolution_state: 'running',
    });
    viewWhatsappProviderHandoff
      .mockResolvedValueOnce({ kind: 'found', handoff: failedHandoff() })
      .mockResolvedValueOnce({ kind: 'found', handoff: queuedReturn })
      .mockResolvedValueOnce({ kind: 'found', handoff: queuedDiscard });
    resolveWhatsappProviderHandoff
      .mockResolvedValueOnce({
        action: 'return',
        status: 'queued',
        reason: 'source_restore_queued',
        handoff: queuedReturn,
        operation_id: handoffId,
      })
      .mockResolvedValueOnce({
        action: 'discard',
        status: 'queued',
        reason: 'session_discard_queued',
        handoff: queuedDiscard,
        operation_id: handoffId,
      });
    const { useWhatsappProviderHandoffRecovery } = loadComposable();
    const recovery = useWhatsappProviderHandoffRecovery({});

    recovery.start(context);
    await flushPromises();
    await recovery.resolve('return');
    expect(recovery.pendingAction.value).toBe('return');

    await recovery.resolve('discard');

    expect(resolveWhatsappProviderHandoff).toHaveBeenCalledTimes(2);
    expect(resolveWhatsappProviderHandoff).toHaveBeenLastCalledWith(
      workerId,
      handoffId,
      'discard',
      expect.objectContaining({ debugTraceId: 'trace-1' })
    );
    expect(recovery.pendingAction.value).toBe('discard');
    expect(recovery.loadingAction.value).toBeNull();
    expect(viewWhatsappProviderHandoff).toHaveBeenCalledTimes(3);
  });

  it('does not send an inverse return override after a discard is pending', async () => {
    const pendingDiscard = failedHandoff({
      recovery_state: 'running',
      source_runtime_restored: true,
      can_return: true,
      can_discard: false,
      resolution_status: 'in_progress',
      resolution_action: 'discard',
      resolution_state: 'running',
    });
    viewWhatsappProviderHandoff.mockResolvedValueOnce({
      kind: 'found',
      handoff: pendingDiscard,
    });
    const { useWhatsappProviderHandoffRecovery } = loadComposable();
    const recovery = useWhatsappProviderHandoffRecovery({});

    recovery.start(context);
    await flushPromises();
    expect(recovery.pendingAction.value).toBe('discard');

    await recovery.resolve('return');

    expect(resolveWhatsappProviderHandoff).not.toHaveBeenCalled();
    expect(recovery.pendingAction.value).toBe('discard');
  });

  it('resumes an in-progress discard from a lifecycle-triggered refresh', async () => {
    const onRecoveryRequired = jest.fn();
    const onTargetReady = jest.fn();
    viewWhatsappProviderHandoff
      .mockResolvedValueOnce({
        kind: 'found',
        handoff: failedHandoff({
          resolution_action: 'discard',
          resolution_state: 'running',
        }),
      })
      .mockResolvedValueOnce({
        kind: 'found',
        handoff: failedHandoff({
          resolution_action: 'discard',
          resolution_state: 'completed',
        }),
      });
    const { useWhatsappProviderHandoffRecovery } = loadComposable();
    const recovery = useWhatsappProviderHandoffRecovery({
      onRecoveryRequired,
      onTargetReady,
    });

    recovery.start({ ...context, origin: 'resumed', handoffId });
    await flushPromises();
    expect(onRecoveryRequired).toHaveBeenCalledTimes(1);
    expect(recovery.loadingAction.value).toBeNull();
    expect(recovery.pendingAction.value).toBe('discard');

    await recovery.refresh();
    expect(resolveWhatsappProviderHandoff).not.toHaveBeenCalled();
    expect(onTargetReady).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'resumed', handoffId }),
      { freshSession: true }
    );
  });

  it('distinguishes a completed source return from target promotion', async () => {
    const onSourceReturned = jest.fn();
    const onTargetReady = jest.fn();
    viewWhatsappProviderHandoff.mockResolvedValueOnce({
      kind: 'found',
      handoff: completedReturnHandoff(),
    });
    const { useWhatsappProviderHandoffRecovery } = loadComposable();
    const recovery = useWhatsappProviderHandoffRecovery({
      onSourceReturned,
      onTargetReady,
    });

    recovery.start({ ...context, origin: 'resumed', handoffId });
    await flushPromises();

    expect(onSourceReturned).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'resumed', handoffId }),
      expect.objectContaining({ handoff_id: handoffId })
    );
    expect(onTargetReady).not.toHaveBeenCalled();
  });

  it('waits passively for a lifecycle refresh when the initial handoff snapshot is absent', async () => {
    viewWhatsappProviderHandoff
      .mockResolvedValueOnce({ kind: 'not_found' })
      .mockResolvedValueOnce({
        kind: 'found',
        handoff: failedHandoff(),
      });
    const { useWhatsappProviderHandoffRecovery } = loadComposable();
    const recovery = useWhatsappProviderHandoffRecovery({});

    recovery.start(context);
    await flushPromises();
    jest.advanceTimersByTime(10_000);
    await flushPromises();

    expect(recovery.handoff.value).toBeUndefined();
    expect(recovery.loadingAction.value).toBeNull();
    expect(recovery.isDialogVisible.value).toBe(false);
    expect(viewWhatsappProviderHandoff).toHaveBeenCalledTimes(1);

    await recovery.refresh();
    expect(viewWhatsappProviderHandoff).toHaveBeenCalledTimes(2);
    expect(recovery.isDialogVisible.value).toBe(true);
  });

  it('stops after an absent snapshot is confirmed by a terminal lifecycle event', async () => {
    viewWhatsappProviderHandoff.mockResolvedValue({ kind: 'not_found' });
    const { useWhatsappProviderHandoffRecovery } = loadComposable();
    const recovery = useWhatsappProviderHandoffRecovery({});

    recovery.start(context);
    await flushPromises();
    await recovery.refresh({ terminal: true });
    await recovery.refresh();

    expect(viewWhatsappProviderHandoff).toHaveBeenCalledTimes(2);
  });
});
