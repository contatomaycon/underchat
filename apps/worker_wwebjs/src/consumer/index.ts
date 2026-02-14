import { FastifyInstance } from 'fastify';
import { startSendMessageWwebjsConsume } from './sendMessage.consume';
import { startMarkMessageReadWwebjsConsume } from './markMessageRead.consume';
import { startPhoneValidationWwebjsConsume } from './phoneValidation.consume';
import { startNotificationMessageSendWwebjsConsume } from './notificationMessageSend.consume';
import { startScheduleMessageWwebjsConsume } from './scheduleMessage.consume';
import { startWorkerConfigUpdateWwebjsConsume } from './workerConfigUpdate.consume';
import { startWebhookIntegrationWwebjsConsume } from './webhookIntegration.consume';
import fp from 'fastify-plugin';

const consumers: Array<{ close?: () => Promise<void> }> = [];

const CONSUMER_STAGGER_DELAY_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startConsumers(server: FastifyInstance): Promise<void> {
  if (server.wwebjsInitialized) {
    try {
      await server.wwebjsInitialized;
    } catch {}
  }

  const starters = [
    () => startSendMessageWwebjsConsume(server),
    () => startMarkMessageReadWwebjsConsume(server),
    () => startPhoneValidationWwebjsConsume(server),
    () => startNotificationMessageSendWwebjsConsume(server),
    () => startScheduleMessageWwebjsConsume(server),
    () => startWorkerConfigUpdateWwebjsConsume(server),
    () => startWebhookIntegrationWwebjsConsume(server),
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

const wwebjsConsumersOnListenHook = fp(async (fastify) => {
  fastify.addHook('onListen', () => {
    startConsumers(fastify).catch((err) => {
      fastify.log.error({ err }, 'Wwebjs: falha ao iniciar consumidores');
    });
  });

  fastify.addHook('onClose', async () => {
    await Promise.allSettled(
      consumers.map((consumer) => consumer?.close?.() ?? Promise.resolve())
    );
  });
});

export default wwebjsConsumersOnListenHook;
