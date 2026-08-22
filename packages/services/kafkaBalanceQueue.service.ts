import { injectable } from 'tsyringe';
import { KAFKA_WORKER_TOPIC_CONFIG } from '@core/common/functions/kafkaTopicConfig';

@injectable()
export class KafkaBalanceQueueService {
  static readonly NUM_PARTITIONS = KAFKA_WORKER_TOPIC_CONFIG.numPartitions;
  static readonly REPLICATION_FACTOR =
    KAFKA_WORKER_TOPIC_CONFIG.replicationFactor;

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
    void serverId;
    return Promise.reject(
      new Error('runtime_balance_kafka_topic_deletion_disabled')
    );
  };

  worker = (serverId: string) => {
    return `worker.${serverId}`;
  };
}
