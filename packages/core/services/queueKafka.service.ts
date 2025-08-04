import { injectable } from 'tsyringe';
import { KafkaService } from './kafka.service';

@injectable()
export class QueueBalanceKafkaService {
  constructor(private readonly kafkaService: KafkaService) {}

  balanceQueueAll = (serverId: string): string[] => {
    return [this.workerServerId(serverId)];
  };

  workerServerId = (serverId: string) => {
    return `worker.${serverId}`;
  };
}
