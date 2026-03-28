import { injectable, inject } from 'tsyringe';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IConfigChannelsRecreateAllPayload } from '@core/common/interfaces/IConfigChannelsRecreateAllPayload';

@injectable()
export class EnqueueRecreateChannelsAllUseCase {
  constructor(
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {}

  async execute(
    accountId: string,
    filters: Omit<IConfigChannelsRecreateAllPayload, 'account_id'>
  ): Promise<void> {
    const payload: IConfigChannelsRecreateAllPayload = {
      account_id: accountId,
      ...filters,
    };

    const topic = this.kafkaServiceQueueService.configChannelsRecreateAll();

    await this.streamProducerService.send(topic, payload, accountId);
  }
}
