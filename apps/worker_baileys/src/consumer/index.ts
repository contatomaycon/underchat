import { FastifyInstance } from 'fastify';
import { startConnectionConsume } from './connection.consume';
import { startSendMessageConsume } from './sendMessage.consume';
import { startMarkMessageReadConsume } from './markMessageRead.consume';
import { startPhoneValidationConsume } from './phoneValidation.consume';
import { startNotificationMessageSendConsume } from './notificationMessageSend.consume';
import { startScheduleMessageConsume } from './scheduleMessage.consume';
import { startWorkerConfigUpdateConsume } from './workerConfigUpdate.consume';

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
      startConnectionConsume(server),
      startSendMessageConsume(server),
      startMarkMessageReadConsume(server),
      startPhoneValidationConsume(server),
      startNotificationMessageSendConsume(server),
      startScheduleMessageConsume(server),
      startWorkerConfigUpdateConsume(server)
    );
  });
}
