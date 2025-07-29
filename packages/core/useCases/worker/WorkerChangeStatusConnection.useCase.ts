import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { MessageRabbitMQService } from '@core/services/messageRabbitMQ.service';

@injectable()
export class WorkerChangeStatusConnectionUseCase {
  constructor(
    private readonly workerService: WorkerService,
    private readonly messageRabbitMQService: MessageRabbitMQService
  ) {}

  private async validate(
    t: TFunction<'translation', undefined>,
    accountId: string,
    isAdministrator: boolean,
    workerId: string
  ) {
    const existsWorkerAccountById = await this.workerService.existsWorkerById(
      isAdministrator,
      accountId,
      workerId
    );

    if (!existsWorkerAccountById) {
      throw new Error(t('worker_not_found'));
    }
  }

  private async onChangeConnectionStatus(
    t: TFunction<'translation', undefined>,
    input: StatusConnectionWorkerRequest
  ): Promise<void> {
    try {
      const payload: StatusConnectionWorkerRequest = {
        worker_id: input.worker_id,
        status: input.status,
      };

      await this.messageRabbitMQService.send(
        `worker:${input.worker_id}:status`,
        payload
      );
    } catch {
      throw new Error(t('rabbitmq_error'));
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    isAdministrator: boolean,
    input: StatusConnectionWorkerRequest
  ): Promise<boolean> {
    await this.validate(t, accountId, isAdministrator, input.worker_id);
    await this.onChangeConnectionStatus(t, input);

    return true;
  }
}
