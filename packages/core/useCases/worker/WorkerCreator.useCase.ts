import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { CreateWorkerResponse } from '@core/schema/worker/createWorker/response.schema';
import { CreateWorkerRequest } from '@core/schema/worker/createWorker/request.schema';
import { WorkerService } from '@core/services/worker.service';
import { v4 as uuidv4 } from 'uuid';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerImage } from '@core/common/enums/EWorkerImage';
import { ICreateWorker } from '@core/common/interfaces/ICreateWorker';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';

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

    const serverId = await this.workerService.viewWorkerBalancerServerId();

    if (!serverId) {
      throw new Error(t('worker_balancer_server_not_disponible'));
    }

    const containerId = await this.workerService.createContainerWorker(
      t,
      imageName,
      containerName
    );

    if (!containerId) {
      throw new Error(t('worker_creation_failed'));
    }

    const workerData: ICreateWorker = {
      worker_status_id: EWorkerStatus.online,
      worker_type_id: input.worker_type,
      server_id: serverId,
      account_id: input.account_id,
      name: containerName,
      container_id: containerId,
    };

    const workerId = await this.workerService.createWorker(workerData);

    if (!workerId) {
      throw new Error(t('worker_creation_failed'));
    }

    return {
      worker_id: workerId,
    };
  }
}
