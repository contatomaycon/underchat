import { injectable, inject } from 'tsyringe';
import { KafkaService } from './kafka.service';
import { KAFKA_WORKER_TOPIC_CONFIG } from '@core/common/functions/kafkaTopicConfig';

@injectable()
export class KafkaBaileysQueueService {
  static readonly NUM_PARTITIONS = KAFKA_WORKER_TOPIC_CONFIG.numPartitions;
  static readonly REPLICATION_FACTOR =
    KAFKA_WORKER_TOPIC_CONFIG.replicationFactor;

  constructor(
    @inject(KafkaService)
    private readonly kafkaService: KafkaService
  ) {}

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
    const sendMessageDlq = this.workerSendMessageDlq(workerId);
    const consumerDlq = this.workerConsumerDlq(workerId);

    return [
      sendMessage,
      scheduleSendMessage,
      validatePhone,
      notificationMessage,
      webhookIntegration,
      sendMessageDlq,
      consumerDlq,
    ];
  };

  deletable = (workerId: string): string[] => {
    const scheduleSendMessage = this.workerScheduleSendMessage(workerId);
    const validatePhone = this.workerValidatePhone(workerId);
    const notificationMessage = this.workerNotificationMessage(workerId);
    const webhookIntegration = this.workerWebhookIntegration(workerId);

    return [
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
    const allTopics = this.deletable(workerId);

    return this.kafkaService.deleteTopics(allTopics);
  };

  deleteAllIncludingSend = (workerId: string): Promise<void> => {
    const allTopics = this.all(workerId);

    return this.kafkaService.deleteTopics(allTopics);
  };

  close = async (): Promise<void> => {
    await this.kafkaService.close();
  };

  workerSendMessage = (workerId: string) => {
    return `worker.${workerId}.send.message`;
  };

  workerSendMessageDlq = (workerId: string) => {
    return `worker.${workerId}.send.message.dlq`;
  };

  workerConsumerDlq = (workerId: string) => {
    return `worker.${workerId}.consumer.dlq`;
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
