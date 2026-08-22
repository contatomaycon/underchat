import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import {
  buildManagerWorkerRecreateRuntimeRetiredStatusEvent,
  buildManagerWorkerRecreateRuntimeStartedStatusEvent,
  buildManagerWorkerRecreateTerminalStatusEvent,
  buildManagerWorkerRecreatingStatusEvent,
  compareWorkerLifecycleOperationIds,
  evaluateManagerWorkerLifecycleCompletionFence,
  evaluateManagerWorkerLifecycleStatusFence,
  evaluateManagerWorkerRecreateRuntimeStartedFence,
  evaluateManagerWorkerRecreateRuntimeRetiredFence,
  normalizeWorkerLifecycleOperationId,
} from '@core/common/functions/workerLifecycleRealtimeStatus';

const workerId = '019fd88a-2894-739b-9471-cd3502f648df';
const accountId = '019a930d-c6f4-75ad-88ff-8d2fcd5839e1';
const recoveryOperationId = '91d3d1bf-b6f5-48fa-8934-53ed56f50f20';
const unrelatedRecoveryOperationId = '11ef2d76-c48a-4d2f-b339-b78a34a0b901';
const nextUuidV7OperationId = '019fdf2c-63af-73e2-8107-3442eeeb8e20';

const payload = {
  action: EWorkerAction.recreate,
  worker_id: workerId,
  server_id: 'server-1',
  account_id: accountId,
  worker_type_id: EWorkerType.baileys,
  lifecycle_operation_id: recoveryOperationId,
};

describe('worker lifecycle recovery operation fences', () => {
  it('preserves recreate semantics in started events without leaking runtime identity', () => {
    const payloadWithRuntimeIdentity = {
      ...payload,
      previous_worker_status_id: EWorkerStatus.online,
      remove_session: true,
      remove_volume: false,
      session_storage: EWorkerSessionStorage.postgres,
      container_id: 'full-physical-container-id-must-not-be-published',
    };
    const event = buildManagerWorkerRecreatingStatusEvent(
      payloadWithRuntimeIdentity
    );

    expect(event).toEqual(
      expect.objectContaining({
        previous_worker_status_id: EWorkerStatus.online,
        remove_session: true,
        remove_volume: false,
        session_storage: EWorkerSessionStorage.postgres,
      })
    );
    expect(event).not.toHaveProperty('container_id');
  });

  it('normalizes RFC UUIDv4 but never assigns chronological order to it', () => {
    expect(normalizeWorkerLifecycleOperationId(recoveryOperationId)).toBe(
      recoveryOperationId
    );
    expect(
      compareWorkerLifecycleOperationIds(
        recoveryOperationId,
        unrelatedRecoveryOperationId
      )
    ).toBeUndefined();
  });

  it('accepts a UUIDv4 start only when it exactly matches durable HTTP state', () => {
    const event = buildManagerWorkerRecreatingStatusEvent(payload, 5);
    expect(
      evaluateManagerWorkerLifecycleStatusFence({
        event,
        persistedWorkerTypeId: EWorkerType.baileys,
        persistedRuntimeGeneration: 5,
        currentLifecycleOperationId: recoveryOperationId,
      })
    ).toMatchObject({ accepted: true, operationId: recoveryOperationId });
    expect(
      evaluateManagerWorkerLifecycleStatusFence({
        event,
        persistedWorkerTypeId: EWorkerType.baileys,
        persistedRuntimeGeneration: 5,
      })
    ).toMatchObject({
      accepted: false,
      reason: 'stale_lifecycle_operation',
    });
    expect(
      evaluateManagerWorkerLifecycleStatusFence({
        event,
        persistedWorkerTypeId: EWorkerType.baileys,
        persistedRuntimeGeneration: 5,
        currentLifecycleOperationId: unrelatedRecoveryOperationId,
      })
    ).toMatchObject({
      accepted: false,
      reason: 'stale_lifecycle_operation',
    });
  });

  it('accepts runtime_started and completion for the exact UUIDv4 across G to G+1', () => {
    const runtimeStarted = buildManagerWorkerRecreateRuntimeStartedStatusEvent(
      payload,
      6,
      '2026-08-08T03:01:00.000Z'
    );
    expect(runtimeStarted).toMatchObject({
      recreate_phase_observed_at: '2026-08-08T03:01:00.000Z',
      connection_status_observed_at: '2026-08-08T03:01:00.000Z',
      recreate_runtime_retired: false,
    });
    expect(runtimeStarted).not.toHaveProperty('container_id');
    expect(
      evaluateManagerWorkerRecreateRuntimeStartedFence({
        event: runtimeStarted,
        persistedWorkerTypeId: EWorkerType.baileys,
        persistedRuntimeGeneration: 5,
        currentLifecycleOperationId: recoveryOperationId,
      })
    ).toMatchObject({
      accepted: true,
      operationId: recoveryOperationId,
      runtimeGeneration: 6,
    });

    const runtimeRetired = buildManagerWorkerRecreateRuntimeRetiredStatusEvent(
      payload,
      6,
      '2026-08-08T03:02:00.000Z'
    );
    expect(runtimeRetired).toMatchObject({
      lifecycle_phase: 'runtime_retired',
      recreate_phase_observed_at: '2026-08-08T03:02:00.000Z',
      connection_status_observed_at: '2026-08-08T03:02:00.000Z',
      recreate_runtime_retired: true,
    });
    expect(runtimeRetired).not.toHaveProperty('container_id');
    expect(
      evaluateManagerWorkerRecreateRuntimeRetiredFence({
        event: runtimeRetired,
        persistedWorkerTypeId: EWorkerType.baileys,
        persistedRuntimeGeneration: 6,
        currentLifecycleOperationId: recoveryOperationId,
      })
    ).toMatchObject({
      accepted: true,
      operationId: recoveryOperationId,
      runtimeGeneration: 6,
    });

    const completed = buildManagerWorkerRecreateTerminalStatusEvent(
      payload,
      6,
      EWorkerStatus.online,
      '2026-08-08T03:05:00.000Z'
    );
    expect(
      evaluateManagerWorkerLifecycleCompletionFence({
        event: completed,
        persistedWorkerTypeId: EWorkerType.baileys,
        persistedRuntimeGeneration: 5,
        currentLifecycleOperationId: recoveryOperationId,
      })
    ).toMatchObject({
      accepted: true,
      operationId: recoveryOperationId,
      runtimeGeneration: 6,
    });
  });

  it('rejects non-durable phase timestamps at the manager event boundary', () => {
    expect(() =>
      buildManagerWorkerRecreateRuntimeStartedStatusEvent(payload, 6, 'invalid')
    ).toThrow('persistedBootstrapStartedAt');
    expect(() =>
      buildManagerWorkerRecreateRuntimeRetiredStatusEvent(payload, 6, 'invalid')
    ).toThrow('persistedRetiredAt');
  });

  it('lets an exact durable UUIDv7 operation follow an unrelated UUIDv4 tombstone', () => {
    const event = buildManagerWorkerRecreatingStatusEvent(
      { ...payload, lifecycle_operation_id: nextUuidV7OperationId },
      7
    );
    expect(
      evaluateManagerWorkerLifecycleStatusFence({
        event,
        persistedWorkerTypeId: EWorkerType.baileys,
        persistedRuntimeGeneration: 7,
        currentLifecycleOperationId: nextUuidV7OperationId,
        completedLifecycleOperationId: recoveryOperationId,
      })
    ).toMatchObject({
      accepted: true,
      operationId: nextUuidV7OperationId,
    });
  });
});
