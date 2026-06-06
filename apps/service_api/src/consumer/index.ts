import { FastifyInstance } from 'fastify';
import { startBalanceConsume } from './balance.consume';
import { startMessageUpdateConsume } from './messageUpdate.consume';
import { startMessageUpsertConsume } from './messageUpsert.consume';
import { startMessageUpsertDlqConsume } from './messageUpsertDlq.consume';
import { startMessageHistorySyncConsume } from './messageHistorySync.consume';
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
import { startBuildVersionGenerateConsume } from './buildVersionGenerate.consume';
import { startBuildVersionCancelConsume } from './buildVersionCancel.consume';
import { startInternalChatDirectMessageConsume } from './internalChatDirectMessage.consume';
import { startInternalChatGroupMessageConsume } from './internalChatGroupMessage.consume';
import { startWorkerWarmReplenishConsume } from './workerWarmReplenish.consume';
import { startWorkerWarmDeleteConsume } from './workerWarmDelete.consume';
import { startWorkerLifecycleConsume } from './workerLifecycle.consume';
import fp from 'fastify-plugin';
import { buildEnvironment } from '@core/config/environments';
import { selectServiceApiConsumerStarters } from '@core/common/functions/selectServiceApiConsumerStarters';

const consumers: Array<{ close?: () => Promise<void> }> = [];

const CONSUMER_STAGGER_DELAY_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startConsumers(server: FastifyInstance): Promise<void> {
  const enableBuildConsumers = buildEnvironment.serviceApiEnableBuildConsumers;
  const enableNonBuildConsumers =
    buildEnvironment.serviceApiEnableNonBuildConsumers;

  const nonBuildConsumerStarters = [
    () => startBalanceConsume(server),
    () => startMessageUpdateConsume(server),
    () => startMessageUpsertConsume(server),
    () => startMessageUpsertDlqConsume(server),
    () => startMessageHistorySyncConsume(server),
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
    () => startInternalChatDirectMessageConsume(server),
    () => startInternalChatGroupMessageConsume(server),
    () => startWorkerWarmReplenishConsume(server),
    () => startWorkerWarmDeleteConsume(server),
    () => startWorkerLifecycleConsume(server),
  ];
  const buildConsumerStarters = [
    () => startBuildVersionGenerateConsume(server),
    () => startBuildVersionCancelConsume(server),
  ];
  const starters = selectServiceApiConsumerStarters({
    enableBuildConsumers,
    enableNonBuildConsumers,
    buildConsumerStarters,
    nonBuildConsumerStarters,
  });

  if (!enableNonBuildConsumers) {
    server.log.info(
      'Service API: non-build Kafka consumers are disabled by SERVICE_API_ENABLE_NON_BUILD_CONSUMERS=false'
    );
  }

  if (!enableBuildConsumers) {
    server.log.info(
      'Service API: build Kafka consumers are disabled by SERVICE_API_ENABLE_BUILD_CONSUMERS=false'
    );
  }

  if (starters.length === 0) {
    server.log.warn(
      'Service API: all Kafka consumers are disabled by environment flags'
    );
    return;
  }

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
