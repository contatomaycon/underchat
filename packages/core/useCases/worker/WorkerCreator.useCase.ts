import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { CreateWorkerResponse } from '@core/schema/worker/createWorker/response.schema';
import { CreateWorkerRequest } from '@core/schema/worker/createWorker/request.schema';
import { WorkerService } from '@core/services/worker.service';
import { v4 as uuidv4 } from 'uuid';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerImage } from '@core/common/enums/EWorkerImage';

@injectable()
export class WorkerCreatorUseCase {
  constructor(private readonly workerService: WorkerService) {}

  private getImageWorker(workerType: EWorkerType) {
    if (workerType === EWorkerType.whatsapp) {
      return EWorkerImage.whatsapp;
    }

    if (workerType === EWorkerType.telegram) {
      return EWorkerImage.telegram;
    }

    if (workerType === EWorkerType.discord) {
      return EWorkerImage.discord;
    }

    return EWorkerImage.baileys;
  }

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateWorkerRequest
  ): Promise<CreateWorkerResponse> {
    const imageName = this.getImageWorker(input.worker_type as EWorkerType);
    const containerName = uuidv4();

    const createWorker = await this.workerService.createWorker(
      t,
      imageName,
      containerName
    );

    if (!createWorker) {
      throw new Error(t('worker_creation_failed'));
    }

    return {
      worker_id: containerName,
    };
  }
}
