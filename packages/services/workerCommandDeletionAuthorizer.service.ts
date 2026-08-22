import { inject, injectable } from 'tsyringe';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import type { IWorkerMonitor } from '@core/common/interfaces/IWorkerMonitor';
import type {
  PermanentWorkerDeletionIntentAuthorization,
  PermanentWorkerTopicDeletionRequest,
} from '@core/common/interfaces/IWorkerTopicLifecycle';
import { WorkerMonitorViewerRepository } from '@core/repositories/worker/WorkerMonitorViewer.repository';
import {
  WorkerDeletionProofError,
  WorkerDeletionProofService,
} from '@core/services/workerDeletionProof.service';

export class WorkerCommandDeletionAuthorizationError extends Error {
  constructor(readonly reason: string) {
    super(`worker_command_deletion_not_authorized:${reason}`);
    this.name = 'WorkerCommandDeletionAuthorizationError';
  }
}

/** Authoritative database/proof fence with no broker-specific side effects. */
@injectable()
export class WorkerCommandDeletionAuthorizerService {
  constructor(
    @inject(WorkerMonitorViewerRepository)
    private readonly workers: WorkerMonitorViewerRepository,
    @inject(WorkerDeletionProofService)
    private readonly proofs: WorkerDeletionProofService
  ) {}

  public async assertIntent(
    request: PermanentWorkerTopicDeletionRequest,
    resources: string[]
  ): Promise<PermanentWorkerDeletionIntentAuthorization> {
    const worker = await this.assertAuthorized(request, resources, 'intent');
    return { permanently_deleted: Boolean(worker.deleted_at) };
  }

  public async assertTombstone(
    request: PermanentWorkerTopicDeletionRequest,
    resources: string[]
  ): Promise<void> {
    const worker = await this.assertAuthorized(request, resources, 'tombstone');
    if (!worker.deleted_at) this.reject('worker_not_permanently_deleted');
  }

  private async assertAuthorized(
    request: PermanentWorkerTopicDeletionRequest,
    resources: string[],
    phase: 'intent' | 'tombstone'
  ): Promise<IWorkerMonitor> {
    this.assertRequest(request);
    try {
      await this.proofs.assert(request);
    } catch (error) {
      this.reject(
        error instanceof WorkerDeletionProofError
          ? `deletion_proof_${error.reason}`
          : 'deletion_proof_unavailable'
      );
    }

    const worker = await this.workers.viewWorkerConsistent(request.worker_id);
    const reason = this.denialReason(worker, request, phase);
    if (reason) this.reject(reason);
    if (!worker) this.reject('worker_tombstone_not_found');

    console.info(
      '[worker-command-resource-audit]',
      JSON.stringify({
        event: 'worker_command_resources.delete.authorized',
        timestamp: new Date().toISOString(),
        phase,
        worker_id: request.worker_id,
        account_id: request.account_id,
        lifecycle_operation_id: request.lifecycle_operation_id,
        trace_id: request.debug_trace_id,
        resources,
        persisted_deleted_at: worker.deleted_at,
      })
    );
    return worker;
  }

  private assertRequest(request: PermanentWorkerTopicDeletionRequest): void {
    if (request.action !== EWorkerAction.delete) this.reject('invalid_action');
    if (!request.worker_id?.trim()) this.reject('missing_worker_id');
    if (!request.account_id?.trim()) this.reject('missing_account_id');
    if (!request.lifecycle_operation_id?.trim()) {
      this.reject('missing_lifecycle_operation_id');
    }
    if (!request.debug_trace_id?.trim()) this.reject('missing_debug_trace_id');
  }

  private denialReason(
    worker: IWorkerMonitor | null,
    request: PermanentWorkerTopicDeletionRequest,
    phase: 'intent' | 'tombstone'
  ): string | null {
    if (!worker) return 'worker_tombstone_not_found';
    if (worker.account_id !== request.account_id) return 'account_mismatch';
    if (worker.lifecycle_operation_id !== request.lifecycle_operation_id) {
      return 'lifecycle_operation_mismatch';
    }
    if (worker.worker_status_id !== EWorkerStatus.deleting) {
      return 'permanent_deletion_status_mismatch';
    }
    if (phase === 'tombstone' && !worker.deleted_at) {
      return 'worker_not_permanently_deleted';
    }
    return null;
  }

  private reject(reason: string): never {
    throw new WorkerCommandDeletionAuthorizationError(reason);
  }
}
