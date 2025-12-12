import { IListWorkerActivities } from '@core/common/interfaces/IListWorkerActivities';
import { WorkerService } from '@core/services/worker.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaBalanceQueueService } from '@core/services/kafkaBalanceQueue.service';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';
import { injectable } from 'tsyringe';

export interface IWorkerCreationActivity {
  listWorkerNewStatusActivities(): Promise<IListWorkerActivities[]>;
  processWorkerCreation(input: IListWorkerActivities): Promise<void>;
}

@injectable()
export class WorkerCreationActivity implements IWorkerCreationActivity {
  constructor(
    private readonly workerService: WorkerService,
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaBalanceQueueService: KafkaBalanceQueueService
  ) {}

  listWorkerNewStatusActivities = async (): Promise<
    IListWorkerActivities[]
  > => {
    return this.workerService.listWorkerNewStatus();
  };

  processWorkerCreation = async (
    input: IListWorkerActivities
  ): Promise<void> => {
    const [viewWorkerType, viewWorkerNameAndId] = await Promise.all([
      this.workerService.viewWorkerType(input.account_id, input.worker_id),
      this.workerService.viewWorkerNameAndId(input.account_id, input.worker_id),
    ]);

    if (!viewWorkerType) {
      throw new Error('Worker type not found');
    }

    if (!viewWorkerNameAndId) {
      throw new Error('Worker name not found');
    }

    const inputUpdateCreating: IUpdateWorker = {
      worker_id: input.worker_id,
      worker_status_id: EWorkerStatus.creating,
    };

    await this.workerService.updateWorkerById(
      input.account_id,
      inputUpdateCreating
    );

    const payloadCreate: IWorkerPayload = {
      action: EWorkerAction.create,
      worker_id: input.worker_id,
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: viewWorkerType.worker_type_id as EWorkerType,
      server_id: input.server_id,
      account_id: input.account_id,
      name: viewWorkerNameAndId.name ?? '',
    };

    await this.streamProducerService.send(
      this.kafkaBalanceQueueService.worker(input.server_id),
      payloadCreate
    );
  };
}
