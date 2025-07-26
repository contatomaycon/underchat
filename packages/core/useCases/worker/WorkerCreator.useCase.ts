import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { CreateWorkerResponse } from '@core/schema/worker/createWorker/response.schema';
import { CreateWorkerRequest } from '@core/schema/worker/createWorker/request.schema';
import { WorkerService } from '@core/services/worker.service';

@injectable()
export class WorkerCreatorUseCase {
  constructor(private readonly workerService: WorkerService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateWorkerRequest
  ): Promise<CreateWorkerResponse> {
    return {
      worker_id: 'teste',
    };
  }
}
