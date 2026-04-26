import { injectable, inject } from 'tsyringe';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IConfigChannelsRecreateAllPayload } from '@core/common/interfaces/IConfigChannelsRecreateAllPayload';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';

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
      ...this.normalizeFilters(filters),
    };

    const topic = this.kafkaServiceQueueService.configChannelsRecreateAll();

    await this.streamProducerService.send(topic, payload, accountId);
  }

  private normalizeFilters(
    filters: Omit<IConfigChannelsRecreateAllPayload, 'account_id'>
  ): Omit<IConfigChannelsRecreateAllPayload, 'account_id'> {
    return {
      ...filters,
      status: filters.status ?? EWorkerStatus.online,
      type: filters.type ?? undefined,
      account: filters.account || undefined,
      name: filters.name || undefined,
      number: filters.number || undefined,
    };
  }
}
