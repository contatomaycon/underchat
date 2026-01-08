import { FastifyInstance } from 'fastify';
import { startBalanceConsume } from './balance.consume';
import { startWorkerConsume } from './worker.consume';
import { startMessageUpdateConsume } from './messageUpdate.consume';
import { startMessageUpsertConsume } from './messageUpsert.consume';
import { startMessageStatusUpdateConsume } from './messageStatusUpdate.consume';
import { startChatSummaryClearConsume } from './chatSummaryClear.consume';
import { startPhoneValidationResponseConsume } from './phoneValidationResponse.consume';
import { startProfileStatusExternalIdUpdateConsume } from './profileStatusExternalIdUpdate.consume';
import { startAsaasInvoiceWebhookConsume } from './asaasInvoiceWebhook.consume';
import { startAsaasNfseWebhookConsume } from './asaasNfseWebhook.consume';
import { startNotificationMessageConsume } from './notificationMessage.consume';
import { startUserPhoneJidUpdateConsume } from './userPhoneJidUpdate.consume';
import { startReportConversationHistoryPdfGenerateConsume } from './reportConversationHistoryPdfGenerate.consume';
import { startScheduleStatusUpdateConsume } from './scheduleStatusUpdate.consume';
import { startAiAgentPromptEmbeddingConsume } from './aiAgentPromptEmbedding.consume';
import { startChatHistoryEmbeddingConsume } from './chatHistoryEmbedding.consume';

const consumers: Array<{ close?: () => Promise<void> }> = [];

export function registerConsumersCloseHook(server: FastifyInstance): void {
  server.addHook('onClose', async () => {
    await Promise.allSettled(
      consumers.map((consumer) => consumer?.close?.() ?? Promise.resolve())
    );
  });
}

export function startConsumers(server: FastifyInstance): void {
  setImmediate(() => {
    consumers.push(
      startBalanceConsume(server),
      startWorkerConsume(server),
      startMessageUpdateConsume(server),
      startMessageUpsertConsume(server),
      startMessageStatusUpdateConsume(server),
      startChatSummaryClearConsume(server),
      startPhoneValidationResponseConsume(server),
      startProfileStatusExternalIdUpdateConsume(server),
      startAsaasInvoiceWebhookConsume(server),
      startAsaasNfseWebhookConsume(server),
      startNotificationMessageConsume(server),
      startUserPhoneJidUpdateConsume(server),
      startReportConversationHistoryPdfGenerateConsume(server),
      startScheduleStatusUpdateConsume(server),
      startAiAgentPromptEmbeddingConsume(server),
      startChatHistoryEmbeddingConsume(server)
    );
  });
}
