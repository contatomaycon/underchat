import { injectable } from 'tsyringe';
import { KafkaService } from './kafka.service';

@injectable()
export class KafkaBaileysQueueService {
  constructor(private readonly kafkaService: KafkaService) {}

  all = (workerId: string): string[] => {
    const worker = this.workerConnection(workerId);

    return [worker];
  };

  create = (workerId: string): Promise<void> => {
    const allTopics = this.all(workerId);

    return this.kafkaService.createTopics(allTopics);
  };

  delete = (workerId: string): Promise<void> => {
    const allTopics = this.all(workerId);

    return this.kafkaService.deleteTopics(allTopics);
  };

  close = async (): Promise<void> => {
    await this.kafkaService.close();
  };

  workerConnection = (workerId: string) => {
    return `worker.${workerId}.connection`;
  };

  workerSendMessage = (workerId: string) => {
    return `worker.${workerId}.send.message`;
  };
}
