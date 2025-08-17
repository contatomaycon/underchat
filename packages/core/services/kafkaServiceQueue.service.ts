import { injectable } from 'tsyringe';
import { KafkaService } from './kafka.service';

@injectable()
export class KafkaServiceQueueService {
  constructor(private readonly kafkaService: KafkaService) {}

  all = (): string[] => {
    const createServer = this.createServer();
    const workerStatus = this.workerStatus();
    const updateMessage = this.updateMessage();
    const upsertMessage = this.upsertMessage();

    return [createServer, workerStatus, updateMessage, upsertMessage];
  };

  create = (): Promise<void> => {
    const allTopics = this.all();

    return this.kafkaService.createTopics(allTopics);
  };

  delete = (): Promise<void> => {
    const allTopics = this.all();

    return this.kafkaService.deleteTopics(allTopics);
  };

  close = async (): Promise<void> => {
    await this.kafkaService.close();
  };

  createServer = () => {
    return 'create.server';
  };

  workerStatus = () => {
    return 'worker.status';
  };

  updateMessage = () => {
    return `update.message`;
  };

  upsertMessage = () => {
    return `upsert.message`;
  };
}
