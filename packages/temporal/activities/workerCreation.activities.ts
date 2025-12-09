import { IListWorkerActivities } from '@core/common/interfaces/IListWorkerActivities';
import { WorkerService } from '@core/services/worker.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaBalanceQueueService } from '@core/services/kafkaBalanceQueue.service';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { container } from 'tsyringe';

export interface IWorkerCreationActivity {
  listWorkerNewStatusActivities(): Promise<IListWorkerActivities[]>;
  processWorkerCreation(input: IListWorkerActivities): Promise<void>;
}

export async function listWorkerNewStatusActivities(): Promise<
  IListWorkerActivities[]
> {
  const workerService = container.resolve(WorkerService);

  return workerService.listWorkerNewStatus();
}

export async function processWorkerCreation(
  input: IListWorkerActivities
): Promise<void> {
  const streamProducerService = container.resolve(StreamProducerService);
  const kafkaBalanceQueueService = container.resolve(KafkaBalanceQueueService);
  const workerService = container.resolve(WorkerService);

  const [viewWorkerType, viewWorkerNameAndId] = await Promise.all([
    workerService.viewWorkerType(input.account_id, input.worker_id),
    workerService.viewWorkerNameAndId(input.account_id, input.worker_id),
  ]);

  if (!viewWorkerType) {
    throw new Error('Worker type not found');
  }

  if (!viewWorkerNameAndId) {
    throw new Error('Worker name not found');
  }

  const payloadCreate: IWorkerPayload = {
    action: EWorkerAction.create,
    worker_id: input.worker_id,
    worker_status_id: input.worker_status_id,
    worker_type_id: viewWorkerType.worker_type_id as EWorkerType,
    server_id: input.server_id,
    account_id: input.account_id,
    name: viewWorkerNameAndId.name ?? '',
  };

  await streamProducerService.send(
    kafkaBalanceQueueService.worker(input.server_id),
    payloadCreate
  );
}
