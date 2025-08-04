import { injectable } from 'tsyringe';
import { KafkaService } from './kafka.service';
import { balanceEnvironment } from '@core/config/environments';

@injectable()
export class KafkaBalanceQueueService {
  constructor(private readonly kafkaService: KafkaService) {}

  all = (): string[] => {
    const workerServerId = this.workerServerId();

    return [workerServerId];
  };

  create = (): Promise<void> => {
    const allTopics = this.all();

    return this.kafkaService.createTopics(allTopics);
  };

  workerServerId = () => {
    return `worker.${balanceEnvironment.serverId}`;
  };

  close = async (): Promise<void> => {
    await this.kafkaService.close();
  };
}
