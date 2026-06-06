import 'reflect-metadata';
jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';

describe('KafkaServiceQueueService', () => {
  it('builds all fixed topics and delegates delete/close', async () => {
    const deleteTopics = jest.fn(async () => undefined);
    const close = jest.fn(async () => undefined);

    const service = new KafkaServiceQueueService({
      deleteTopics,
      close,
    } as never);

    expect(service.getNumPartitions()).toBe(30);
    expect(service.getReplicationFactor()).toBe(3);
    expect(service.createServer()).toBe('create.server');
    expect(service.updateMessage()).toBe('update.message');
    expect(service.upsertMessage()).toBe('upsert.message');
    expect(service.upsertMessageHistory()).toBe('upsert.message.history');
    expect(service.upsertMessageDlq()).toBe('upsert.message.dlq');
    expect(service.updateMessageStatus()).toBe('update.message.status');
    expect(service.markMessageRead()).toBe('mark.message.read');
    expect(service.clearChatSummary()).toBe('clear.chat.summary');
    expect(service.phoneValidationResponse()).toBe('phone.validation.response');
    expect(service.updateProfileStatusExternalId()).toBe(
      'update.profile.status.external.id'
    );
    expect(service.asaasInvoiceWebhook()).toBe('asaas.invoice.webhook');
    expect(service.asaasNfseWebhook()).toBe('asaas.nfse.webhook');
    expect(service.notificationMessage()).toBe('notification.message');
    expect(service.reportConversationHistoryPdfGenerate()).toBe(
      'report.conversation.history.pdf.generate'
    );
    expect(service.scheduleStatusUpdate()).toBe('schedule.status.update');
    expect(service.workerConfigUpdate()).toBe('worker.config.update');
    expect(service.aiAgentPromptEmbedding()).toBe('ai.agent.prompt.embedding');
    expect(service.chatHistoryEmbedding()).toBe('chat.history.embedding');
    expect(service.contactValidationUpdate()).toBe('contact.validation.update');
    expect(service.configChannelsRecreateAll()).toBe(
      'config.channels.recreate.all'
    );
    expect(service.buildVersionGenerateRequest()).toBe(
      'build.version.generate.request'
    );
    expect(service.buildVersionCancelRequest()).toBe(
      'build.version.cancel.request'
    );
    expect(service.internalChatDirectMessage()).toBe(
      'internal.chat.direct.message'
    );
    expect(service.internalChatGroupMessage()).toBe(
      'internal.chat.group.message'
    );
    expect(service.workerWarmReplenishRequest()).toBe(
      'worker.warm.replenish.request'
    );
    expect(service.workerWarmDeleteRequest()).toBe(
      'worker.warm.delete.request'
    );
    expect(service.workerLifecycleRequest()).toBe('worker.lifecycle.request');

    const topics = service.all();

    expect(topics).toEqual([
      'create.server',
      'update.message',
      'upsert.message',
      'upsert.message.history',
      'upsert.message.dlq',
      'update.message.status',
      'mark.message.read',
      'clear.chat.summary',
      'phone.validation.response',
      'update.profile.status.external.id',
      'asaas.invoice.webhook',
      'asaas.nfse.webhook',
      'notification.message',
      'report.conversation.history.pdf.generate',
      'schedule.status.update',
      'worker.config.update',
      'ai.agent.prompt.embedding',
      'chat.history.embedding',
      'contact.validation.update',
      'config.channels.recreate.all',
      'build.version.generate.request',
      'build.version.cancel.request',
      'internal.chat.direct.message',
      'internal.chat.group.message',
      'worker.warm.replenish.request',
      'worker.warm.delete.request',
      'worker.lifecycle.request',
    ]);

    await expect(service.delete()).resolves.toBeUndefined();
    expect(deleteTopics).toHaveBeenCalledWith(topics);

    await expect(service.close()).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
