import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import type { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import type { IWorkerMonitor } from '@core/common/interfaces/IWorkerMonitor';
import type { WorkerLifecycleUpdateGuard } from '@core/repositories/worker/WorkerUpdater.repository';
import type {
  PreparePermanentWorkerDeletionInput,
  WorkerLifecycleQueueService,
} from '@core/services/workerLifecycleQueue.service';
import type { WorkerService } from '@core/services/worker.service';
import { retryWorkerLifecycleBoundary } from './workerLifecycleBoundary';

const WORKER_DELETION_CLAIM_ATTEMPTS = 3;

type WorkerDeletionLifecycleWorkerService = Pick<
  WorkerService,
  'viewWorkerForMonitorConsistent' | 'updateWorkerByIdIfLifecycleMatches'
>;

type WorkerDeletionLifecycleQueueService = Pick<
  WorkerLifecycleQueueService,
  'preparePermanentDeletion' | 'loadPermanentDeletionProof' | 'publish'
>;

export interface EnqueuePermanentWorkerDeletionInput {
  account_id: string;
  worker_id: string;
  source: PreparePermanentWorkerDeletionInput['source'];
}

export interface EnqueuePermanentWorkerDeletionDependencies {
  workerService: WorkerDeletionLifecycleWorkerService;
  workerLifecycleQueueService: WorkerDeletionLifecycleQueueService;
}

function isSameDeletionClaim(
  worker: IWorkerMonitor | null,
  accountId: string,
  lifecycleOperationId: string
): boolean {
  return Boolean(
    worker &&
    !worker.deleted_at &&
    worker.account_id === accountId &&
    worker.worker_status_id === EWorkerStatus.deleting &&
    worker.lifecycle_operation_id === lifecycleOperationId
  );
}

function isSameDeletionTombstone(
  worker: IWorkerMonitor | null,
  accountId: string,
  lifecycleOperationId: string
): boolean {
  return Boolean(
    worker?.deleted_at &&
    worker.account_id === accountId &&
    worker.lifecycle_operation_id === lifecycleOperationId
  );
}

function deletionGuard(worker: IWorkerMonitor): WorkerLifecycleUpdateGuard {
  return {
    lifecycle_operation_id: worker.lifecycle_operation_id,
    server_id: worker.server_id,
    worker_type_id: worker.worker_type_id,
    worker_status_id: worker.worker_status_id,
    updated_at: worker.updated_at,
  };
}

async function prepareDeletionMessage(
  queue: WorkerDeletionLifecycleQueueService,
  worker: IWorkerMonitor,
  source: EnqueuePermanentWorkerDeletionInput['source'],
  lifecycleOperationId?: string
): Promise<IWorkerLifecycleQueueMessage> {
  return queue.preparePermanentDeletion({
    worker_id: worker.worker_id,
    account_id: worker.account_id,
    server_id: worker.server_id,
    worker_type_id: worker.worker_type_id,
    session_storage: worker.session_storage,
    source,
    lifecycle_operation_id: lifecycleOperationId,
    debug_trace_id: lifecycleOperationId,
  });
}

/**
 * Closes the journal -> database claim -> Kafka delivery boundary for
 * permanent worker deletion. The row stays in `deleting` with the exact
 * operation id until the remote handler creates the permanent tombstone.
 */
export async function enqueuePermanentWorkerDeletion(
  dependencies: EnqueuePermanentWorkerDeletionDependencies,
  input: EnqueuePermanentWorkerDeletionInput
): Promise<IWorkerLifecycleQueueMessage | null> {
  const { workerService, workerLifecycleQueueService } = dependencies;
  let proposedOperationId: string | undefined;
  let deletionMessage: IWorkerLifecycleQueueMessage | null = null;
  let lastClaimError: unknown;

  for (
    let attempt = 0;
    attempt < WORKER_DELETION_CLAIM_ATTEMPTS;
    attempt += 1
  ) {
    const current = await workerService.viewWorkerForMonitorConsistent(
      input.worker_id
    );
    if (!current) {
      return null;
    }
    if (current.account_id !== input.account_id) {
      throw new Error('Worker account changed during permanent deletion');
    }

    if (current.deleted_at) {
      if (!current.lifecycle_operation_id) {
        return null;
      }
      deletionMessage =
        await workerLifecycleQueueService.loadPermanentDeletionProof(
          current.worker_id,
          current.lifecycle_operation_id
        );
      if (
        !deletionMessage ||
        deletionMessage.action !== 'delete' ||
        deletionMessage.account_id !== input.account_id
      ) {
        throw new Error(
          'Worker deletion tombstone is missing its immutable deletion proof'
        );
      }
      break;
    }

    if (current.worker_status_id === EWorkerStatus.delete) {
      return null;
    }

    const lifecycleOperationId =
      current.worker_status_id === EWorkerStatus.deleting &&
      current.lifecycle_operation_id
        ? current.lifecycle_operation_id
        : proposedOperationId;
    const prepared = await prepareDeletionMessage(
      workerLifecycleQueueService,
      current,
      input.source,
      lifecycleOperationId
    );
    proposedOperationId ??= prepared.operation_id;

    if (isSameDeletionClaim(current, input.account_id, prepared.operation_id)) {
      deletionMessage = prepared;
      break;
    }

    try {
      const claimed = await workerService.updateWorkerByIdIfLifecycleMatches(
        input.account_id,
        {
          worker_id: input.worker_id,
          worker_status_id: EWorkerStatus.deleting,
          lifecycle_operation_id: prepared.operation_id,
        },
        deletionGuard(current)
      );
      if (claimed) {
        deletionMessage = prepared;
        break;
      }
    } catch (error) {
      lastClaimError = error;
      const observed = await workerService.viewWorkerForMonitorConsistent(
        input.worker_id
      );
      if (
        isSameDeletionClaim(
          observed,
          input.account_id,
          prepared.operation_id
        ) ||
        isSameDeletionTombstone(
          observed,
          input.account_id,
          prepared.operation_id
        )
      ) {
        deletionMessage = prepared;
        break;
      }
    }
  }

  if (!deletionMessage) {
    throw new Error('Worker deletion lifecycle claim was not confirmed', {
      cause: lastClaimError,
    });
  }

  await retryWorkerLifecycleBoundary(() =>
    workerLifecycleQueueService.publish(deletionMessage)
  );
  return deletionMessage;
}
