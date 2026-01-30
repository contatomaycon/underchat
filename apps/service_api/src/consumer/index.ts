import { FastifyInstance } from 'fastify';
import { startBalanceConsume } from './balance.consume';
import { startWorkerConsume } from './worker.consume';
import { startMessageUpdateConsume } from './messageUpdate.consume';
import { startMessageUpsertConsume } from './messageUpsert.consume';
import { startMessageUpsertDlqConsume } from './messageUpsertDlq.consume';
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
import { startContactValidationUpdateConsume } from './contactValidationUpdate.consume';
import { startConfigChannelsRecreateAllConsume } from './configChannelsRecreateAll.consume';
import fp from 'fastify-plugin';

const consumers: Array<{ close?: () => Promise<void> }> = [];

const CONSUMER_STAGGER_DELAY_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startConsumers(server: FastifyInstance): Promise<void> {
  const starters = [
    () => startBalanceConsume(server),
    () => startWorkerConsume(server),
    () => startMessageUpdateConsume(server),
    () => startMessageUpsertConsume(server),
    () => startMessageUpsertDlqConsume(server),
    () => startMessageStatusUpdateConsume(server),
    () => startChatSummaryClearConsume(server),
    () => startPhoneValidationResponseConsume(server),
    () => startProfileStatusExternalIdUpdateConsume(server),
    () => startAsaasInvoiceWebhookConsume(server),
    () => startAsaasNfseWebhookConsume(server),
    () => startNotificationMessageConsume(server),
    () => startUserPhoneJidUpdateConsume(server),
    () => startReportConversationHistoryPdfGenerateConsume(server),
    () => startScheduleStatusUpdateConsume(server),
    () => startAiAgentPromptEmbeddingConsume(server),
    () => startChatHistoryEmbeddingConsume(server),
    () => startContactValidationUpdateConsume(server),
    () => startConfigChannelsRecreateAllConsume(server),
  ];

  for (const start of starters) {
    try {
      consumers.push(start());
    } catch (err) {
      server.log.error({ err }, 'Erro ao iniciar consumidor Kafka');
    }
    await delay(CONSUMER_STAGGER_DELAY_MS);
  }
}

const serviceApiConsumersOnListenHook = fp(async (fastify) => {
  fastify.addHook('onListen', () => {
    startConsumers(fastify).catch((err) => {
      fastify.log.error({ err }, 'Service API: falha ao iniciar consumidores');
    });
  });

  fastify.addHook('onClose', async () => {
    await Promise.allSettled(
      consumers.map((consumer) => consumer?.close?.() ?? Promise.resolve())
    );
  });
});

export default serviceApiConsumersOnListenHook;
