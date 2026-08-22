import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { planCompletedWhatsappProviderHandoffLifecycle } from '@core/common/functions/whatsappProviderHandoffLifecycleCompletion';

const operationId = '019ff397-acde-7021-bbed-b1644e64d6b3';
const containerId = 'a'.repeat(64);

const proof = {
  lifecycle_operation_id: operationId,
  handoff_state: 'completed' as const,
  error_code: null,
  source_provider: 'baileys' as const,
  target_provider: 'wwebjs' as const,
  recovery_state: 'none',
  recovery_operation_id: null,
  resolution_state: null,
  resolution_operation_id: null,
};

const worker = {
  account_id: 'account-1',
  server_id: 'server-1',
  worker_type_id: EWorkerType.wwebjs,
  worker_status_id: EWorkerStatus.online,
  session_storage: EWorkerSessionStorage.postgres,
  lifecycle_operation_id: operationId,
  container_id: containerId,
  runtime_container_id: containerId,
  runtime_generation: 19,
  recreate_bootstrap_operation_id: operationId,
  recreate_bootstrap_runtime_generation: 19,
  recreate_bootstrap_container_id: containerId,
  recreate_bootstrap_started_at: '2026-08-12T02:23:03.327Z',
  recreate_retired_operation_id: null,
  recreate_retired_runtime_generation: null,
  recreate_retired_container_id: null,
  recreate_retired_at: null,
};

describe('completed WhatsApp provider handoff lifecycle plan', () => {
  it('allows only the promoted online runtime with its exact bootstrap proof', () => {
    expect(
      planCompletedWhatsappProviderHandoffLifecycle(proof, worker)
    ).toEqual({
      accountId: 'account-1',
      serverId: 'server-1',
      workerTypeId: EWorkerType.wwebjs,
      lifecycleOperationId: operationId,
      controlContainerId: containerId,
      runtimeContainerId: containerId,
      runtimeGeneration: 19,
    });
  });

  it.each([
    ['failed handoff', { handoff_state: 'failed', error_code: 'failed' }, {}],
    ['active recovery', { recovery_state: 'pending' }, {}],
    ['wrong target provider', { target_provider: 'whatsmeow' }, {}],
    ['non-online worker', {}, { worker_status_id: EWorkerStatus.recreating }],
    [
      'legacy storage',
      {},
      { session_storage: EWorkerSessionStorage.legacy_volume },
    ],
    ['wrong lifecycle', {}, { lifecycle_operation_id: 'operation-other' }],
    ['wrong runtime container', {}, { runtime_container_id: 'b'.repeat(64) }],
    ['wrong runtime generation', {}, { runtime_generation: 20 }],
    [
      'missing bootstrap timestamp',
      {},
      { recreate_bootstrap_started_at: null },
    ],
    ['retired bootstrap', {}, { recreate_retired_operation_id: operationId }],
  ])('rejects %s', (_name, proofOverride, workerOverride) => {
    expect(
      planCompletedWhatsappProviderHandoffLifecycle(
        { ...proof, ...proofOverride } as typeof proof,
        { ...worker, ...workerOverride }
      )
    ).toBeNull();
  });
});
