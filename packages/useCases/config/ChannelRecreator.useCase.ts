import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { AccountService } from '@core/services/account.service';
import { ConfigService } from '@core/services/config.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { KafkaBalanceQueueService } from '@core/services/kafkaBalanceQueue.service';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';

@injectable()
export class ChannelRecreatorUseCase {
  constructor(
    private readonly workerService: WorkerService,
    private readonly accountService: AccountService,
    private readonly configService: ConfigService,
    private readonly streamProducerService: StreamProducerService,
    private readonly centrifugoService: CentrifugoService,
    private readonly kafkaBalanceQueueService: KafkaBalanceQueueService
  ) {}

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

  private async onChannelRecreated(
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
    channelId: string
  ): Promise<boolean> {
    const viewWorkerBalancer =
      await this.configService.viewChannelBalancer(channelId);

    if (!viewWorkerBalancer) {
      throw new Error(t('worker_not_found'));
    }

    await this.validate(t, viewWorkerBalancer.account_id);

    const inputRecreate: IWorkerPayload = {
      action: EWorkerAction.recreate,
      worker_id: channelId,
      server_id: viewWorkerBalancer.server_id,
      account_id: viewWorkerBalancer.account_id,
      worker_status_id: EWorkerStatus.recreating,
    };

    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(inputRecreate.account_id),
      inputRecreate
    );

    await this.onChannelRecreated(t, inputRecreate);

    const inputUpdate: IUpdateWorker = {
      worker_id: channelId,
      worker_status_id: EWorkerStatus.recreating,
    };

    return this.workerService.updateWorkerById(
      viewWorkerBalancer.account_id,
      inputUpdate
    );
  }
}
