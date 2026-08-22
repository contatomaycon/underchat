import { inject, injectable } from 'tsyringe';
import type {
  PermanentWorkerDeletionIntentAuthorization,
  PermanentWorkerTopicDeletionRequest,
  WorkerTopicMutationLease,
} from '@core/common/interfaces/IWorkerTopicLifecycle';
import { workerCommandSubject } from '@core/common/functions/workerCommandEnvelope';
import { WorkerCommandEpochService } from '@core/services/workerCommandEpoch.service';
import {
  WorkerCommandJetStreamControlPlaneService,
  type WorkerCommandResourceDeletionResult,
} from '@core/services/workerCommandJetStreamControlPlane.service';
import { workerCommandDurableName } from '@core/services/workerCommandJetStreamIngress.service';
import { WorkerLifecycleQueueService } from '@core/services/workerLifecycleQueue.service';
import { WorkerCommandDeletionAuthorizerService } from '@core/services/workerCommandDeletionAuthorizer.service';

export interface WorkerCommandPermanentDeletionAuthorization {
  authorization: PermanentWorkerDeletionIntentAuthorization;
  epoch: string | null;
}

/**
 * Permanent worker deletion boundary for the shared JetStream architecture.
 * It never creates, deletes or queries a per-worker Kafka topic.
 */
@injectable()
export class WorkerCommandResourceLifecycleService {
  constructor(
    @inject(WorkerCommandEpochService)
    private readonly epochs: WorkerCommandEpochService,
    @inject(WorkerCommandDeletionAuthorizerService)
    private readonly deletionAuthorizer: WorkerCommandDeletionAuthorizerService,
    @inject(WorkerCommandJetStreamControlPlaneService)
    private readonly controlPlane: WorkerCommandJetStreamControlPlaneService,
    @inject(WorkerLifecycleQueueService)
    private readonly lifecycleQueue: WorkerLifecycleQueueService
  ) {}

  public async beginPermanentDeletion(
    request: PermanentWorkerTopicDeletionRequest,
    lease: WorkerTopicMutationLease
  ): Promise<WorkerCommandPermanentDeletionAuthorization> {
    lease.assertActive();
    const resources = this.resources(request.worker_id);
    const authorization = await this.deletionAuthorizer.assertIntent(
      request,
      resources
    );
    lease.assertActive();

    const snapshot = await this.epochs.get(request.worker_id);
    lease.assertActive();
    if (!snapshot) return { authorization, epoch: null };
    this.assertEpochIdentity(
      snapshot.record.account_id,
      request.account_id,
      request.worker_id
    );
    if (snapshot.record.state === 'active') {
      await this.epochs.transition(
        request.worker_id,
        snapshot.record.epoch,
        'draining'
      );
      lease.assertActive();
    }
    return { authorization, epoch: snapshot.record.epoch };
  }

  public async finalizePermanentDeletion(
    request: PermanentWorkerTopicDeletionRequest,
    lease: WorkerTopicMutationLease
  ): Promise<WorkerCommandResourceDeletionResult> {
    lease.assertActive();
    const resources = this.resources(request.worker_id);
    await this.deletionAuthorizer.assertTombstone(request, resources);
    lease.assertActive();

    const snapshot = await this.epochs.get(request.worker_id);
    lease.assertActive();
    if (snapshot) {
      this.assertEpochIdentity(
        snapshot.record.account_id,
        request.account_id,
        request.worker_id
      );
      if (snapshot.record.state !== 'closed') {
        await this.epochs.transition(
          request.worker_id,
          snapshot.record.epoch,
          'closed'
        );
        lease.assertActive();
      }
    }

    const result = await this.controlPlane.deleteWorkerResources(
      request.worker_id
    );
    lease.assertActive();
    await this.lifecycleQueue.completePermanentDeletionFinalization(
      request.worker_id,
      request.account_id,
      request.lifecycle_operation_id
    );
    lease.assertActive();

    console.info(
      '[worker-command-resource-audit]',
      JSON.stringify({
        event: 'worker_command_resources.delete.completed',
        timestamp: new Date().toISOString(),
        worker_id: request.worker_id,
        account_id: request.account_id,
        lifecycle_operation_id: request.lifecycle_operation_id,
        trace_id: request.debug_trace_id,
        ...result,
      })
    );
    return result;
  }

  private resources(workerId: string): string[] {
    return [
      workerCommandSubject(workerId),
      `durable:${workerCommandDurableName(workerId)}`,
    ];
  }

  private assertEpochIdentity(
    persistedAccountId: string,
    expectedAccountId: string,
    workerId: string
  ): void {
    if (persistedAccountId !== expectedAccountId) {
      throw new Error(`worker_command_epoch_account_mismatch:${workerId}`);
    }
  }
}
