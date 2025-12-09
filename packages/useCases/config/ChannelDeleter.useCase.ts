import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { ConfigService } from '@core/services/config.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { KafkaBalanceQueueService } from '@core/services/kafkaBalanceQueue.service';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';

@injectable()
export class ChannelDeleterUseCase {
  constructor(
    private readonly workerService: WorkerService,
    private readonly configService: ConfigService,
    private readonly streamProducerService: StreamProducerService,
    private readonly centrifugoService: CentrifugoService,
    private readonly kafkaBalanceQueueService: KafkaBalanceQueueService
  ) {}

  private async validate(
    t: TFunction<'translation', undefined>,
    channelId: string
  ) {
    const viewWorkerBalancer =
      await this.configService.viewChannelBalancer(channelId);

    if (!viewWorkerBalancer) {
      throw new Error(t('worker_not_found'));
    }
  }

  private async onChannelDeleted(
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
    await this.validate(t, channelId);

    const viewWorkerBalancer =
      await this.configService.viewChannelBalancer(channelId);

    if (!viewWorkerBalancer) {
      throw new Error(t('worker_not_found'));
    }

    const inputDeleter: IWorkerPayload = {
      action: EWorkerAction.delete,
      worker_id: channelId,
      server_id: viewWorkerBalancer.server_id,
      account_id: viewWorkerBalancer.account_id,
    };

    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(inputDeleter.account_id),
      inputDeleter
    );

    await this.onChannelDeleted(t, inputDeleter);

    const inputUpdate: IUpdateWorker = {
      worker_id: channelId,
      worker_status_id: EWorkerStatus.deleting,
    };

    return this.workerService.updateWorkerById(
      viewWorkerBalancer.account_id,
      inputUpdate
    );
  }
}
