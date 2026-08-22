import { EWorkerSessionStorage } from '../enums/EWorkerSessionStorage';
import { EWorkerStatus } from '../enums/EWorkerStatus';
import { EWorkerType } from '../enums/EWorkerType';

type WhatsappProvider = 'baileys' | 'whatsmeow' | 'wwebjs';

export interface TerminalWhatsappProviderHandoffProof {
  lifecycle_operation_id: string;
  handoff_state: 'completed' | 'failed';
  error_code: string | null;
  source_provider: WhatsappProvider;
  target_provider: WhatsappProvider;
  recovery_state: string;
  recovery_operation_id: string | null;
  resolution_state: string | null;
  resolution_operation_id: string | null;
}

export interface TerminalWhatsappProviderHandoffWorker {
  account_id: string;
  server_id: string;
  worker_type_id: EWorkerType;
  worker_status_id: EWorkerStatus;
  session_storage?: EWorkerSessionStorage;
  lifecycle_operation_id: string | null;
  container_id: string | null;
  runtime_container_id?: string | null;
  runtime_generation?: number | null;
  recreate_bootstrap_operation_id?: string | null;
  recreate_bootstrap_runtime_generation?: number | null;
  recreate_bootstrap_container_id?: string | null;
  recreate_bootstrap_started_at?: string | null;
  recreate_retired_operation_id?: string | null;
  recreate_retired_runtime_generation?: number | null;
  recreate_retired_container_id?: string | null;
  recreate_retired_at?: string | null;
}

export interface CompletedWhatsappProviderHandoffLifecyclePlan {
  accountId: string;
  serverId: string;
  workerTypeId: EWorkerType;
  lifecycleOperationId: string;
  controlContainerId: string;
  runtimeContainerId: string;
  runtimeGeneration: number;
}

const WORKER_TYPE_BY_PROVIDER: Record<WhatsappProvider, EWorkerType> = {
  baileys: EWorkerType.baileys,
  whatsmeow: EWorkerType.whatsmeow,
  wwebjs: EWorkerType.wwebjs,
};

const normalizeContainerId = (value: string | null | undefined): string =>
  value?.trim().toLowerCase() ?? '';

const isDockerContainerId = (value: string): boolean =>
  /^[0-9a-f]{64}$/u.test(value);

/**
 * Builds the only safe worker-lifecycle completion plan for a provider
 * handoff that already reached its immutable `completed` state.
 *
 * Session promotion deliberately happens before the manager lifecycle is
 * closed. If the target reports ONLINE first and the terminal Kafka delivery
 * is retried, the worker may therefore be left with a historical lifecycle
 * id. This proof never touches session data: it permits only the exact
 * lifecycle tombstone after the promoted target runtime, bootstrap marker and
 * Docker identity all agree.
 */
export const planCompletedWhatsappProviderHandoffLifecycle = (
  proof: TerminalWhatsappProviderHandoffProof,
  worker: TerminalWhatsappProviderHandoffWorker | null | undefined
): CompletedWhatsappProviderHandoffLifecyclePlan | null => {
  const lifecycleOperationId = proof.lifecycle_operation_id?.trim();
  const controlContainerId = normalizeContainerId(worker?.container_id);
  const runtimeContainerId = normalizeContainerId(worker?.runtime_container_id);
  const bootstrapContainerId = normalizeContainerId(
    worker?.recreate_bootstrap_container_id
  );
  const runtimeGeneration = worker?.runtime_generation;
  const expectedWorkerType = WORKER_TYPE_BY_PROVIDER[proof.target_provider];

  if (
    !worker ||
    !lifecycleOperationId ||
    proof.handoff_state !== 'completed' ||
    proof.error_code !== null ||
    proof.source_provider === proof.target_provider ||
    proof.recovery_state !== 'none' ||
    proof.recovery_operation_id !== null ||
    proof.resolution_state !== null ||
    proof.resolution_operation_id !== null ||
    worker.worker_type_id !== expectedWorkerType ||
    worker.worker_status_id !== EWorkerStatus.online ||
    worker.session_storage !== EWorkerSessionStorage.postgres ||
    worker.lifecycle_operation_id !== lifecycleOperationId ||
    !worker.account_id?.trim() ||
    !worker.server_id?.trim() ||
    !Number.isSafeInteger(runtimeGeneration) ||
    Number(runtimeGeneration) <= 0 ||
    !isDockerContainerId(controlContainerId) ||
    !isDockerContainerId(runtimeContainerId) ||
    controlContainerId !== runtimeContainerId ||
    worker.recreate_bootstrap_operation_id !== lifecycleOperationId ||
    worker.recreate_bootstrap_runtime_generation !== runtimeGeneration ||
    bootstrapContainerId !== runtimeContainerId ||
    !worker.recreate_bootstrap_started_at ||
    worker.recreate_retired_operation_id !== null ||
    worker.recreate_retired_runtime_generation !== null ||
    worker.recreate_retired_container_id !== null ||
    worker.recreate_retired_at !== null
  ) {
    return null;
  }

  return {
    accountId: worker.account_id,
    serverId: worker.server_id,
    workerTypeId: worker.worker_type_id,
    lifecycleOperationId,
    controlContainerId,
    runtimeContainerId,
    runtimeGeneration: Number(runtimeGeneration),
  };
};
