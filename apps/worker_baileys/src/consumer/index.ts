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

export function startConsumers(server: FastifyInstance): void {
  setImmediate(() => {
    consumers.push(
      startSendMessageConsume(server),
      startMarkMessageReadConsume(server),
      startPhoneValidationConsume(server),
      startNotificationMessageSendConsume(server),
      startScheduleMessageConsume(server),
      startWorkerConfigUpdateConsume(server),
      startWebhookIntegrationConsume(server)
    );
  });
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
