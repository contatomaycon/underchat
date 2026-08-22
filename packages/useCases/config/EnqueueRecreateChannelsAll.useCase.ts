import { injectable, inject } from 'tsyringe';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import {
  IConfigChannelsRecreateAllFilters,
  IConfigChannelsRecreateAllPayload,
} from '@core/common/interfaces/IConfigChannelsRecreateAllPayload';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { v7 as uuidv7 } from 'uuid';

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
    filters: IConfigChannelsRecreateAllFilters
  ): Promise<void> {
    const payload: IConfigChannelsRecreateAllPayload = {
      request_id: uuidv7(),
      account_id: accountId,
      ...this.normalizeFilters(filters),
    };

    const topic = this.kafkaServiceQueueService.configChannelsRecreateAll();

    await this.streamProducerService.send(topic, payload, accountId);
  }

  private normalizeFilters(
    filters: IConfigChannelsRecreateAllFilters
  ): IConfigChannelsRecreateAllFilters {
    return {
      ...filters,
      status: filters.status ?? EWorkerStatus.online,
      type: filters.type ?? undefined,
      ...(filters.session_storage
        ? { session_storage: filters.session_storage }
        : {}),
      account: filters.account || undefined,
      name: filters.name || undefined,
      number: filters.number || undefined,
    };
  }
}
