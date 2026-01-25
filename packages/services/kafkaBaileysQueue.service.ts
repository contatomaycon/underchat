import { injectable } from 'tsyringe';
import { KafkaService } from './kafka.service';

@injectable()
export class KafkaBaileysQueueService {
  static readonly NUM_PARTITIONS = 6;
  static readonly REPLICATION_FACTOR = 3;

  constructor(private readonly kafkaService: KafkaService) {}

  getNumPartitions(): number {
    return KafkaBaileysQueueService.NUM_PARTITIONS;
  }

  getReplicationFactor(): number {
    return KafkaBaileysQueueService.REPLICATION_FACTOR;
  }

  all = (workerId: string): string[] => {
    const worker = this.workerConnection(workerId);
    const sendMessage = this.workerSendMessage(workerId);
    const scheduleSendMessage = this.workerScheduleSendMessage(workerId);
    const validatePhone = this.workerValidatePhone(workerId);
    const notificationMessage = this.workerNotificationMessage(workerId);

    return [
      worker,
      sendMessage,
      scheduleSendMessage,
      validatePhone,
      notificationMessage,
    ];
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

  workerScheduleSendMessage = (workerId: string) => {
    return `worker.${workerId}.schedule.send.message`;
  };

  workerValidatePhone = (workerId: string) => {
    return `worker.${workerId}.validate.phone`;
  };

  workerNotificationMessage = (workerId: string) => {
    return `worker.${workerId}.notification.message`;
  };

  userPhoneJidUpdate = () => {
    return 'user.phone.jid.update';
  };
}
