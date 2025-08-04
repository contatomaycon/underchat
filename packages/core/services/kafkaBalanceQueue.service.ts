import { injectable } from 'tsyringe';
import { KafkaService } from './kafka.service';
import { balanceEnvironment } from '@core/config/environments';

@injectable()
export class KafkaBalanceQueueService {
  constructor(private readonly kafkaService: KafkaService) {}

  all = (): string[] => {
    const worker = this.worker();

    return [worker];
  };

  create = (): Promise<void> => {
    const allTopics = this.all();

    return this.kafkaService.createTopics(allTopics);
  };

  worker = () => {
    return `worker.${balanceEnvironment.serverId}`;
  };

  close = async (): Promise<void> => {
    await this.kafkaService.close();
  };
}
