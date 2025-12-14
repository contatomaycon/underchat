import { injectable } from 'tsyringe';
import { KafkaService } from './kafka.service';

@injectable()
export class KafkaBaileysQueueService {
  constructor(private readonly kafkaService: KafkaService) {}

  all = (workerId: string): string[] => {
    const worker = this.workerConnection(workerId);
    const sendMessage = this.workerSendMessage(workerId);
    const validatePhone = this.workerValidatePhone(workerId);
    const notificationMessage = this.workerNotificationMessage(workerId);

    return [worker, sendMessage, validatePhone, notificationMessage];
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
