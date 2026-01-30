import { FastifyInstance } from 'fastify';
import { startSendMessageConsume } from './sendMessage.consume';
import { startMarkMessageReadConsume } from './markMessageRead.consume';
import { startPhoneValidationConsume } from './phoneValidation.consume';
import { startNotificationMessageSendConsume } from './notificationMessageSend.consume';
import { startScheduleMessageConsume } from './scheduleMessage.consume';
import { startWorkerConfigUpdateConsume } from './workerConfigUpdate.consume';
import { startWebhookIntegrationConsume } from './webhookIntegration.consume';
import fp from 'fastify-plugin';

const consumers: Array<{ close?: () => Promise<void> }> = [];

const CONSUMER_STAGGER_DELAY_MS = 500;
const CONSUMER_INITIAL_DELAY_MS = 3000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function startConsumers(server: FastifyInstance): void {
  const starters = [
    () => startSendMessageConsume(server),
    () => startMarkMessageReadConsume(server),
    () => startPhoneValidationConsume(server),
    () => startNotificationMessageSendConsume(server),
    () => startScheduleMessageConsume(server),
    () => startWorkerConfigUpdateConsume(server),
    () => startWebhookIntegrationConsume(server),
  ];

  setTimeout(async () => {
    for (const start of starters) {
      try {
        consumers.push(start());
      } catch (err) {
        server.log.error({ err }, 'Erro ao iniciar consumidor Kafka');
      }
      await delay(CONSUMER_STAGGER_DELAY_MS);
    }
  }, CONSUMER_INITIAL_DELAY_MS);
}

const baileysConsumersOnListenHook = fp(async (fastify) => {
  fastify.addHook('onListen', () => {
    try {
      startConsumers(fastify);
    } catch (err) {
      fastify.log.error({ err }, 'Baileys: falha ao iniciar consumidores');
    }
  });

  fastify.addHook('onClose', async () => {
    await Promise.allSettled(
      consumers.map((consumer) => consumer?.close?.() ?? Promise.resolve())
    );
  });
});

export default baileysConsumersOnListenHook;
