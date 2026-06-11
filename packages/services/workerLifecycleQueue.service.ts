import { inject, injectable } from 'tsyringe';
import type { MessageHeader } from 'node-rdkafka';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KAFKA_GLOBAL_TOPIC_CONFIG } from '@core/common/functions/kafkaTopicConfig';
import { KafkaService } from '@core/services/kafka.service';
import { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';

@injectable()
export class WorkerLifecycleQueueService {
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

  topic(): string {
    return this.kafkaServiceQueueService.workerLifecycleRequest();
  }

  async ensure(): Promise<void> {
    await this.kafkaService.createTopics(
      [this.topic()],
      this.getNumPartitions(),
      this.getReplicationFactor()
    );
  }

  async publish(payload: IWorkerLifecycleQueueMessage): Promise<void> {
    const headers: MessageHeader[] = [];

    try {
      await this.streamProducerService.send(
        this.topic(),
        payload,
        payload.worker_id,
        headers
      );
    } catch (error) {
      throw error;
    }
  }
}
