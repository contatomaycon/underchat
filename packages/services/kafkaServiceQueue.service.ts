import { injectable } from 'tsyringe';
import { KAFKA_GLOBAL_TOPIC_CONFIG } from '@core/common/functions/kafkaTopicConfig';

@injectable()
export class KafkaServiceQueueService {
  static readonly NUM_PARTITIONS = KAFKA_GLOBAL_TOPIC_CONFIG.numPartitions;
  static readonly REPLICATION_FACTOR =
    KAFKA_GLOBAL_TOPIC_CONFIG.replicationFactor;

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
    const updateMessageStatus = this.updateMessageStatus();
    const clearChatSummary = this.clearChatSummary();
    const phoneValidationResponse = this.phoneValidationResponse();
    const userPhoneJidUpdate = this.userPhoneJidUpdate();
    const updateProfileStatusExternalId = this.updateProfileStatusExternalId();
    const asaasInvoiceWebhook = this.asaasInvoiceWebhook();
    const asaasNfseWebhook = this.asaasNfseWebhook();
    const notificationMessage = this.notificationMessage();
    const officialWhatsappSendMessage = this.officialWhatsappSendMessage();
    const officialWhatsappWebhookEvent = this.officialWhatsappWebhookEvent();
    const reportConversationHistoryPdfGenerate =
      this.reportConversationHistoryPdfGenerate();
    const scheduleStatusUpdate = this.scheduleStatusUpdate();
    const aiAgentPromptEmbedding = this.aiAgentPromptEmbedding();
    const chatHistoryEmbedding = this.chatHistoryEmbedding();
    const contactValidationUpdate = this.contactValidationUpdate();
    const configChannelsRecreateAll = this.configChannelsRecreateAll();
    const buildVersionGenerateRequest = this.buildVersionGenerateRequest();
    const buildVersionCancelRequest = this.buildVersionCancelRequest();
    const internalChatDirectMessage = this.internalChatDirectMessage();
    const internalChatGroupMessage = this.internalChatGroupMessage();
    const workerWarmReplenishRequest = this.workerWarmReplenishRequest();
    const workerWarmDeleteRequest = this.workerWarmDeleteRequest();
    const workerLifecycleRequest = this.workerLifecycleRequest();

    return [
      createServer,
      updateMessage,
      upsertMessage,
      upsertMessageHistory,
      updateMessageStatus,
      clearChatSummary,
      phoneValidationResponse,
      userPhoneJidUpdate,
      updateProfileStatusExternalId,
      asaasInvoiceWebhook,
      asaasNfseWebhook,
      notificationMessage,
      officialWhatsappSendMessage,
      officialWhatsappWebhookEvent,
      reportConversationHistoryPdfGenerate,
      scheduleStatusUpdate,
      aiAgentPromptEmbedding,
      chatHistoryEmbedding,
      contactValidationUpdate,
      configChannelsRecreateAll,
      buildVersionGenerateRequest,
      buildVersionCancelRequest,
      internalChatDirectMessage,
      internalChatGroupMessage,
      workerWarmReplenishRequest,
      workerWarmDeleteRequest,
      workerLifecycleRequest,
    ];
  };

  delete = (): Promise<void> => {
    return Promise.reject(
      new Error('runtime_global_kafka_topic_deletion_disabled')
    );
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

  updateMessageStatus = () => {
    return `update.message.status`;
  };

  clearChatSummary = () => {
    return `clear.chat.summary`;
  };

  phoneValidationResponse = () => {
    return `phone.validation.response`;
  };

  userPhoneJidUpdate = () => {
    return 'user.phone.jid.update';
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

  officialWhatsappSendMessage = () => {
    return 'official.whatsapp.send.message';
  };

  officialWhatsappWebhookEvent = () => {
    return 'official.whatsapp.webhook.event';
  };

  reportConversationHistoryPdfGenerate = () => {
    return `report.conversation.history.pdf.generate`;
  };

  scheduleStatusUpdate = () => {
    return `schedule.status.update`;
  };

  workerWarmReplenishRequest = () => {
    return 'worker.warm.replenish.request';
  };

  workerWarmDeleteRequest = () => {
    return 'worker.warm.delete.request';
  };

  workerLifecycleRequest = () => {
    return 'worker.lifecycle.request';
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

  internalChatDirectMessage = () => {
    return 'internal.chat.direct.message';
  };

  internalChatGroupMessage = () => {
    return 'internal.chat.group.message';
  };
}
