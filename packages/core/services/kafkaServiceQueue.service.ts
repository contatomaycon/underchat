import { injectable } from 'tsyringe';
import { KafkaService } from './kafka.service';

@injectable()
export class KafkaServiceQueueService {
  constructor(private readonly kafkaService: KafkaService) {}

  all = (): string[] => {
    const createServer = this.createServer();
    const workerStatus = this.workerStatus();

    return [createServer, workerStatus];
  };

  create = (): Promise<void> => {
    const allTopics = this.all();

    return this.kafkaService.createTopics(allTopics);
  };

  createServer = () => {
    return 'create.server';
  };

  workerStatus = () => {
    return 'worker.status';
  };

  close = async (): Promise<void> => {
    await this.kafkaService.close();
  };
}
