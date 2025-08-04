import { injectable } from 'tsyringe';
import { StreamProducerService } from './streamProducer.service';

@injectable()
export class QueueBalanceKafkaService {
  constructor(private readonly streamProducerService: StreamProducerService) {}

  balanceQueueAll = (serverId: string): string[] => {
    return [this.workerServerId(serverId)];
  };

  workerServerId = (serverId: string) => {
    return `worker.${serverId}`;
  };
}
