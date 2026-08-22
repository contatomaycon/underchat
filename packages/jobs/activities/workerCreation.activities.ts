import { IListWorkerActivities } from '@core/common/interfaces/IListWorkerActivities';
import { WorkerService } from '@core/services/worker.service';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';
import { injectable, inject } from 'tsyringe';
import { WorkerLifecycleQueueService } from '@core/services/workerLifecycleQueue.service';
import { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import { v7 as uuidv7 } from 'uuid';
import { currentTime } from '@core/common/functions/currentTime';
import {
  publishPreparedWorkerLifecycle,
  retryWorkerLifecycleBoundary,
} from '@core/common/functions/workerLifecycleBoundary';

export interface IWorkerCreationActivity {
  listWorkerNewStatusActivities(): Promise<IListWorkerActivities[]>;
  processWorkerCreation(input: IListWorkerActivities): Promise<void>;
}

@injectable()
export class WorkerCreationActivity implements IWorkerCreationActivity {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(WorkerLifecycleQueueService)
    private readonly workerLifecycleQueueService: WorkerLifecycleQueueService
  ) {}

  listWorkerNewStatusActivities = async (): Promise<
    IListWorkerActivities[]
  > => {
    return this.workerService.listWorkerNewStatus();
  };

  processWorkerCreation = async (
    input: IListWorkerActivities
  ): Promise<void> => {
    const viewWorkerType = await this.workerService.viewWorkerType(
      input.account_id,
      input.worker_id
    );

    if (!viewWorkerType) {
      throw new Error('Worker type not found');
    }

    if (viewWorkerType.worker_type_id === EWorkerType.whatsapp) {
      return;
    }

    const operationId = uuidv7();
    const lifecycleMessage: IWorkerLifecycleQueueMessage = {
      request_id: uuidv7(),
      operation_id: operationId,
      action: 'create',
      worker_id: input.worker_id,
      account_id: input.account_id,
      server_id: input.server_id,
      worker_type_id: viewWorkerType.worker_type_id as EWorkerType,
      session_storage:
        viewWorkerType.session_storage ?? EWorkerSessionStorage.legacy_volume,
      worker_status_id: EWorkerStatus.creating,
      source: 'worker_create',
      requested_at: currentTime(),
    };
    await retryWorkerLifecycleBoundary(() =>
      this.workerLifecycleQueueService.prepare(lifecycleMessage)
    );
    const inputUpdateCreating: IUpdateWorker = {
      worker_id: input.worker_id,
      worker_status_id: EWorkerStatus.creating,
      lifecycle_operation_id: operationId,
    };
    let claimed: boolean;
    try {
      claimed = await this.workerService.updateWorkerByIdIfLifecycleMatches(
        input.account_id,
        inputUpdateCreating,
        {
          lifecycle_operation_id: null,
          server_id: input.server_id,
          worker_type_id: viewWorkerType.worker_type_id as EWorkerType,
          worker_status_id: EWorkerStatus.new,
        }
      );
    } catch (claimError) {
      try {
        await publishPreparedWorkerLifecycle({
          publish: () =>
            this.workerLifecycleQueueService.publish(lifecycleMessage),
        });
      } catch (boundaryError) {
        throw new AggregateError(
          [claimError, boundaryError],
          'Scheduled worker creation claim could not be recovered'
        );
      }
      throw claimError;
    }
    if (!claimed) {
      return;
    }

    await publishPreparedWorkerLifecycle({
      publish: () => this.workerLifecycleQueueService.publish(lifecycleMessage),
    });
  };
}
