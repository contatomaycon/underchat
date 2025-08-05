import { injectable } from 'tsyringe';
import { KafkaService } from './kafka.service';

@injectable()
export class KafkaBalanceQueueService {
  constructor(private readonly kafkaService: KafkaService) {}

  all = (serverId: string): string[] => {
    const worker = this.worker(serverId);

    return [worker];
  };

  create = (serverId: string): Promise<void> => {
    const allTopics = this.all(serverId);

    return this.kafkaService.createTopics(allTopics);
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
