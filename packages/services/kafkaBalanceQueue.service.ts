import { injectable } from 'tsyringe';
import { KafkaService } from './kafka.service';

@injectable()
export class KafkaBalanceQueueService {
  static readonly NUM_PARTITIONS = 6;
  static readonly REPLICATION_FACTOR = 3;

  constructor(private readonly kafkaService: KafkaService) {}

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
