import { injectable } from 'tsyringe';
import { KafkaService } from './kafka.service';

@injectable()
export class KafkaBaileysQueueService {
  static readonly NUM_PARTITIONS = 1;
  static readonly REPLICATION_FACTOR = 2;

  constructor(private readonly kafkaService: KafkaService) {}

  getNumPartitions(): number {
    return KafkaBaileysQueueService.NUM_PARTITIONS;
  }

  getReplicationFactor(): number {
    return KafkaBaileysQueueService.REPLICATION_FACTOR;
  }

  all = (workerId: string): string[] => {
    const sendMessage = this.workerSendMessage(workerId);
    const scheduleSendMessage = this.workerScheduleSendMessage(workerId);
    const validatePhone = this.workerValidatePhone(workerId);
    const notificationMessage = this.workerNotificationMessage(workerId);
    const webhookIntegration = this.workerWebhookIntegration(workerId);

    return [
      sendMessage,
      scheduleSendMessage,
      validatePhone,
      notificationMessage,
      webhookIntegration,
    ];
  };

  ensure = async (workerId: string): Promise<void> => {
    const allTopics = this.all(workerId);

    await this.kafkaService.createTopics(
      allTopics,
      KafkaBaileysQueueService.NUM_PARTITIONS,
      KafkaBaileysQueueService.REPLICATION_FACTOR
    );
  };

  delete = (workerId: string): Promise<void> => {
    const allTopics = this.all(workerId);

    return this.kafkaService.deleteTopics(allTopics);
  };

  close = async (): Promise<void> => {
    await this.kafkaService.close();
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

  workerWebhookIntegration = (workerId: string) => {
    return `worker.${workerId}.webhook.integration`;
  };

  userPhoneJidUpdate = () => {
    return 'user.phone.jid.update';
  };
}
