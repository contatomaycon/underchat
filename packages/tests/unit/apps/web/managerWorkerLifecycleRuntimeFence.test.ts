import { createManagerWorkerLifecycleRuntimeFence } from '@core/common/functions/managerWorkerLifecycleRuntimeFence';

describe('ChannelStatusBanner manager lifecycle runtime fence', () => {
  const workerId = '019ca10d-73e1-7e5e-9d1e-8b8148aeb245';
  const operationId = '33333333-3333-7333-8333-333333333333';
  const recoveryOperationId = '91d3d1bf-b6f5-48fa-8934-53ed56f50f20';
  const nextRecoveryOperationId = '11ef2d76-c48a-4d2f-b339-b78a34a0b901';

  it('keeps recreating protected from every provider event until exact manager completion', () => {
    const fence = createManagerWorkerLifecycleRuntimeFence();
    fence.remember(workerId, operationId);

    expect(
      fence.acceptProviderRuntime({
        workerId,
        persistedRuntimeGeneration: 4,
        eventRuntimeGeneration: 3,
      })
    ).toBe(false);
    expect(
      fence.acceptProviderRuntime({
        workerId,
        persistedRuntimeGeneration: 4,
        eventRuntimeGeneration: 4,
      })
    ).toBe(false);
    expect(fence.hasActiveOperation(workerId)).toBe(true);

    expect(
      fence.acceptProviderRuntime({
        workerId,
        persistedRuntimeGeneration: 4,
        eventRuntimeGeneration: 5,
      })
    ).toBe(false);
    expect(fence.hasActiveOperation(workerId)).toBe(true);
  });

  it('fails closed when the active lifecycle cannot verify the provider generation', () => {
    const fence = createManagerWorkerLifecycleRuntimeFence();
    fence.remember(workerId, operationId);

    expect(
      fence.acceptProviderRuntime({
        workerId,
        persistedRuntimeGeneration: 4,
      })
    ).toBe(false);
    expect(
      fence.acceptProviderRuntime({
        workerId,
        eventRuntimeGeneration: 5,
      })
    ).toBe(false);
    expect(fence.currentOperation(workerId)).toBe(operationId);
  });

  it('releases the fence only for the exact manager completion operation', () => {
    const fence = createManagerWorkerLifecycleRuntimeFence();
    fence.remember(workerId, operationId);

    expect(
      fence.complete({
        workerId,
        operationId: '44444444-4444-7444-8444-444444444444',
        persistedRuntimeGeneration: 4,
        eventRuntimeGeneration: 4,
      })
    ).toBe(false);
    expect(
      fence.complete({
        workerId,
        operationId,
        persistedRuntimeGeneration: 4,
        eventRuntimeGeneration: 5,
      })
    ).toBe(true);
    expect(fence.hasActiveOperation(workerId)).toBe(false);
    expect(fence.lastCompletedOperation(workerId)).toBe(operationId);
    expect(fence.remember(workerId, operationId)).toBe(false);
  });

  it('releases an exact UUIDv4 recovery fence at a newer runtime generation', () => {
    const fence = createManagerWorkerLifecycleRuntimeFence();
    expect(fence.remember(workerId, recoveryOperationId)).toBe(true);
    expect(
      fence.complete({
        workerId,
        operationId: recoveryOperationId,
        persistedRuntimeGeneration: 4,
        eventRuntimeGeneration: 5,
      })
    ).toBe(true);
    expect(fence.lastCompletedOperation(workerId)).toBe(recoveryOperationId);
    expect(fence.remember(workerId, nextRecoveryOperationId)).toBe(false);
    expect(
      fence.remember(workerId, nextRecoveryOperationId, {
        operationId: recoveryOperationId,
        runtimeGeneration: 5,
        completedAt: '2026-08-08T03:05:00.000Z',
      })
    ).toBe(true);
  });

  it('synchronizes only normalized state already accepted by the canonical reducer', () => {
    const fence = createManagerWorkerLifecycleRuntimeFence();
    expect(
      fence.synchronizeAuthoritativeState({
        workerId,
        activeOperationId: operationId,
        completedOperationId: recoveryOperationId,
      })
    ).toBe(true);
    expect(fence.currentOperation(workerId)).toBe(operationId);
    expect(fence.lastCompletedOperation(workerId)).toBe(recoveryOperationId);
    expect(
      fence.acceptProviderRuntime({
        workerId,
        persistedRuntimeGeneration: 4,
        eventRuntimeGeneration: 5,
      })
    ).toBe(false);

    expect(
      fence.synchronizeAuthoritativeState({
        workerId,
        activeOperationId: null,
        completedOperationId: operationId,
      })
    ).toBe(true);
    expect(fence.hasActiveOperation(workerId)).toBe(false);
    expect(fence.lastCompletedOperation(workerId)).toBe(operationId);
    expect(
      fence.synchronizeAuthoritativeState({
        workerId,
        activeOperationId: 'not-a-uuid',
        completedOperationId: operationId,
      })
    ).toBe(false);
  });
});
