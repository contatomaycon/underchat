import { injectable, inject } from 'tsyringe';
import { KafkaService } from './kafka.service';

@injectable()
export class KafkaServiceQueueService {
  static readonly NUM_PARTITIONS = 30;
  static readonly REPLICATION_FACTOR = 3;

  constructor(
    @inject(KafkaService)
    private readonly kafkaService: KafkaService
  ) {}

  getNumPartitions(): number {
    return KafkaServiceQueueService.NUM_PARTITIONS;
  }

  getReplicationFactor(): number {
    return KafkaServiceQueueService.REPLICATION_FACTOR;
  }

  all = (): string[] => {
    const createServer = this.createServer();
    const updateMessage = this.updateMessage();
    const upsertMessage = this.upsertMessage();
    const upsertMessageHistory = this.upsertMessageHistory();
    const upsertMessageDlq = this.upsertMessageDlq();
    const updateMessageStatus = this.updateMessageStatus();
    const markMessageRead = this.markMessageRead();
    const clearChatSummary = this.clearChatSummary();
    const phoneValidationResponse = this.phoneValidationResponse();
    const updateProfileStatusExternalId = this.updateProfileStatusExternalId();
    const asaasInvoiceWebhook = this.asaasInvoiceWebhook();
    const asaasNfseWebhook = this.asaasNfseWebhook();
    const notificationMessage = this.notificationMessage();
    const reportConversationHistoryPdfGenerate =
      this.reportConversationHistoryPdfGenerate();
    const scheduleStatusUpdate = this.scheduleStatusUpdate();
    const workerConfigUpdate = this.workerConfigUpdate();
    const aiAgentPromptEmbedding = this.aiAgentPromptEmbedding();
    const chatHistoryEmbedding = this.chatHistoryEmbedding();
    const contactValidationUpdate = this.contactValidationUpdate();
    const configChannelsRecreateAll = this.configChannelsRecreateAll();
    const buildVersionGenerateRequest = this.buildVersionGenerateRequest();
    const buildVersionCancelRequest = this.buildVersionCancelRequest();

    return [
      createServer,
      updateMessage,
      upsertMessage,
      upsertMessageHistory,
      upsertMessageDlq,
      updateMessageStatus,
      markMessageRead,
      clearChatSummary,
      phoneValidationResponse,
      updateProfileStatusExternalId,
      asaasInvoiceWebhook,
      asaasNfseWebhook,
      notificationMessage,
      reportConversationHistoryPdfGenerate,
      scheduleStatusUpdate,
      workerConfigUpdate,
      aiAgentPromptEmbedding,
      chatHistoryEmbedding,
      contactValidationUpdate,
      configChannelsRecreateAll,
      buildVersionGenerateRequest,
      buildVersionCancelRequest,
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

  updateMessage = () => {
    return `update.message`;
  };

  upsertMessage = () => {
    return `upsert.message`;
  };

  upsertMessageHistory = () => {
    return `upsert.message.history`;
  };

  upsertMessageDlq = () => {
    return `upsert.message.dlq`;
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

  reportConversationHistoryPdfGenerate = () => {
    return `report.conversation.history.pdf.generate`;
  };

  scheduleStatusUpdate = () => {
    return `schedule.status.update`;
  };

  workerConfigUpdate = () => {
    return `worker.config.update`;
  };

  aiAgentPromptEmbedding = () => {
    return `ai.agent.prompt.embedding`;
  };

  chatHistoryEmbedding = () => {
    return `chat.history.embedding`;
  };

  contactValidationUpdate = () => {
    return `contact.validation.update`;
  };

  configChannelsRecreateAll = () => {
    return 'config.channels.recreate.all';
  };

  buildVersionGenerateRequest = () => {
    return 'build.version.generate.request';
  };

  buildVersionCancelRequest = () => {
    return 'build.version.cancel.request';
  };
}
