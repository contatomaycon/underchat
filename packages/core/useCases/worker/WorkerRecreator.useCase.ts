import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { AccountService } from '@core/services/account.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { KafkaBalanceQueueService } from '@core/services/kafkaBalanceQueue.service';

@injectable()
export class WorkerRecreatorUseCase {
  constructor(
    private readonly workerService: WorkerService,
    private readonly accountService: AccountService,
    private readonly streamProducerService: StreamProducerService,
    private readonly centrifugoService: CentrifugoService,
    private readonly kafkaBalanceQueueService: KafkaBalanceQueueService
  ) {}

  private queueCentrifugo(data: IWorkerPayload): string {
    return `worker.${data.account_id}`;
  }

  private async validate(
    t: TFunction<'translation', undefined>,
    accountId: string
  ) {
    const existsAccountById =
      await this.accountService.existsAccountById(accountId);

    if (!existsAccountById) {
      throw new Error(t('account_not_found'));
    }
  }

  private async onWorkerRecreated(
    t: TFunction<'translation', undefined>,
    payload: IWorkerPayload
  ): Promise<void> {
    try {
      await this.streamProducerService.send(
        this.kafkaBalanceQueueService.worker(payload.server_id),
        payload
      );
    } catch {
      throw new Error(t('kafka_error'));
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    isAdministrator: boolean,
    workerId: string
  ): Promise<boolean> {
    await this.validate(t, accountId);

    const viewWorkerBalancer = await this.workerService.viewWorkerBalancer(
      accountId,
      isAdministrator,
      workerId
    );

    if (!viewWorkerBalancer) {
      throw new Error(t('worker_balancer_not_available'));
    }

    const inputRecreate: IWorkerPayload = {
      action: EWorkerAction.recreate,
      worker_id: workerId,
      server_id: viewWorkerBalancer.server_id,
      account_id: accountId,
      is_administrator: isAdministrator,
      worker_status_id: EWorkerStatus.recreating,
    };

    await this.centrifugoService.publish(
      this.queueCentrifugo(inputRecreate),
      inputRecreate
    );

    await this.onWorkerRecreated(t, inputRecreate);

    return this.workerService.updateWorkerById(
      isAdministrator,
      accountId,
      inputRecreate
    );
  }
}
