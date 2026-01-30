import { FastifyInstance } from 'fastify';
import { startSendMessageConsume } from './sendMessage.consume';
import { startMarkMessageReadConsume } from './markMessageRead.consume';
import { startPhoneValidationConsume } from './phoneValidation.consume';
import { startNotificationMessageSendConsume } from './notificationMessageSend.consume';
import { startScheduleMessageConsume } from './scheduleMessage.consume';
import { startWorkerConfigUpdateConsume } from './workerConfigUpdate.consume';
import { startWebhookIntegrationConsume } from './webhookIntegration.consume';

const consumers: Array<{ close?: () => Promise<void> }> = [];

export function registerConsumersCloseHook(server: FastifyInstance): void {
  server.addHook('onClose', async () => {
    await Promise.allSettled(
      consumers.map((consumer) => consumer?.close?.() ?? Promise.resolve())
    );
  });
}

export function startConsumers(server: FastifyInstance): void {
  consumers.push(
    startSendMessageConsume(server),
    startMarkMessageReadConsume(server),
    startPhoneValidationConsume(server),
    startNotificationMessageSendConsume(server),
    startScheduleMessageConsume(server),
    startWorkerConfigUpdateConsume(server),
    startWebhookIntegrationConsume(server)
  );
}
