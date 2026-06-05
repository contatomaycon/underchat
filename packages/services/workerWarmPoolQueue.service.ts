import { inject, injectable } from 'tsyringe';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import {
  IWorkerWarmDeleteRequest,
  IWorkerWarmReplenishRequest,
} from '@core/common/interfaces/IWorkerWarmPoolQueue';
import { KAFKA_GLOBAL_TOPIC_CONFIG } from '@core/common/functions/kafkaTopicConfig';
import { KafkaService } from '@core/services/kafka.service';

@injectable()
export class WorkerWarmPoolQueueService {
  constructor(
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaService)
    private readonly kafkaService: KafkaService
  ) {}

  getNumPartitions(): number {
    return KAFKA_GLOBAL_TOPIC_CONFIG.numPartitions;
  }

  getReplicationFactor(): number {
    return KAFKA_GLOBAL_TOPIC_CONFIG.replicationFactor;
  }

  async ensure(): Promise<void> {
    await this.kafkaService.createTopics(
      [
        this.kafkaServiceQueueService.workerWarmReplenishRequest(),
        this.kafkaServiceQueueService.workerWarmDeleteRequest(),
      ],
      this.getNumPartitions(),
      this.getReplicationFactor()
    );
  }

  async publishReplenish(payload: IWorkerWarmReplenishRequest): Promise<void> {
    await this.streamProducerService.send(
      this.kafkaServiceQueueService.workerWarmReplenishRequest(),
      payload,
      `${payload.server_id}:${payload.worker_type_id}`
    );
  }

  async publishDelete(payload: IWorkerWarmDeleteRequest): Promise<void> {
    await this.streamProducerService.send(
      this.kafkaServiceQueueService.workerWarmDeleteRequest(),
      payload,
      `${payload.server_id}:${payload.worker_type_id ?? payload.worker_id ?? ''}`
    );
  }
}
