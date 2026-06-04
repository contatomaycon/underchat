import { injectable, inject } from 'tsyringe';
import { KafkaService } from './kafka.service';
import { KAFKA_WORKER_TOPIC_CONFIG } from '@core/common/functions/kafkaTopicConfig';

@injectable()
export class KafkaBalanceQueueService {
  static readonly NUM_PARTITIONS = KAFKA_WORKER_TOPIC_CONFIG.numPartitions;
  static readonly REPLICATION_FACTOR =
    KAFKA_WORKER_TOPIC_CONFIG.replicationFactor;

  constructor(
    @inject(KafkaService)
    private readonly kafkaService: KafkaService
  ) {}

  getNumPartitions(): number {
    return KafkaBalanceQueueService.NUM_PARTITIONS;
  }

  getReplicationFactor(): number {
    return KafkaBalanceQueueService.REPLICATION_FACTOR;
  }

  all = (serverId: string): string[] => {
    const worker = this.worker(serverId);

    return [worker];
  };

  delete = (serverId: string): Promise<void> => {
    const allTopics = this.all(serverId);

    return this.kafkaService.deleteTopics(allTopics);
  };

  close = async (): Promise<void> => {
    await this.kafkaService.close();
  };

  worker = (serverId: string) => {
    return `worker.${serverId}`;
  };
}
