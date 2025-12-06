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
    const updateMessageStatus = this.updateMessageStatus();
    const markMessageRead = this.markMessageRead();
    const clearChatSummary = this.clearChatSummary();
    const phoneValidationResponse = this.phoneValidationResponse();
    const updateProfileStatusExternalId = this.updateProfileStatusExternalId();
    const asaasInvoiceWebhook = this.asaasInvoiceWebhook();
    const asaasNfseWebhook = this.asaasNfseWebhook();
    const notificationMessage = this.notificationMessage();

    return [
      createServer,
      workerStatus,
      updateMessage,
      upsertMessage,
      updateMessageStatus,
      markMessageRead,
      clearChatSummary,
      phoneValidationResponse,
      updateProfileStatusExternalId,
      asaasInvoiceWebhook,
      asaasNfseWebhook,
      notificationMessage,
    ];
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

  updateMessageStatus = () => {
    return `update.message.status`;
  };

  markMessageRead = () => {
    return `mark.message.read`;
  };

  clearChatSummary = () => {
    return `clear.chat.summary`;
  };

  phoneValidationResponse = () => {
    return `phone.validation.response`;
  };

  updateProfileStatusExternalId = () => {
    return `update.profile.status.external.id`;
  };

  asaasInvoiceWebhook = () => {
    return `asaas.invoice.webhook`;
  };

  asaasNfseWebhook = () => {
    return `asaas.nfse.webhook`;
  };

  notificationMessage = () => {
    return `notification.message`;
  };
}
