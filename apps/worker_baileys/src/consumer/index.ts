import { FastifyInstance } from 'fastify';
import { startSendMessageConsume } from './sendMessage.consume';
import { startMarkMessageReadConsume } from './markMessageRead.consume';
import { startPhoneValidationConsume } from './phoneValidation.consume';
import { startNotificationMessageSendConsume } from './notificationMessageSend.consume';
import { startScheduleMessageConsume } from './scheduleMessage.consume';
import { startWorkerConfigUpdateConsume } from './workerConfigUpdate.consume';
import { startWebhookIntegrationConsume } from './webhookIntegration.consume';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { BaileysHealthCheckService } from '@core/services/baileys/methods/healthCheck.service';
import { BaileysService } from '@core/services/baileys';

const consumers: Array<{ close?: () => Promise<void> }> = [];

const CONSUMER_STAGGER_DELAY_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startConsumers(server: FastifyInstance): Promise<void> {
  if (server.baileysInitialized) {
    try {
      await server.baileysInitialized;
    } catch {}
  }

  const starters = [
    () => startSendMessageConsume(server),
    () => startMarkMessageReadConsume(server),
    () => startPhoneValidationConsume(server),
    () => startNotificationMessageSendConsume(server),
    () => startScheduleMessageConsume(server),
    () => startWorkerConfigUpdateConsume(server),
    () => startWebhookIntegrationConsume(server),
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

const baileysConsumersOnListenHook = fp(async (fastify) => {
  fastify.addHook('onListen', () => {
    try {
      const healthCheckService = container.resolve(BaileysHealthCheckService);

      fastify.baileysInitialized = healthCheckService.bootstrapConnection();
    } catch (err) {
      fastify.log.error(
        { err },
        'Baileys: falha ao iniciar bootstrap de conexão'
      );
      fastify.baileysInitialized = Promise.resolve();
    }

    startConsumers(fastify).catch((err) => {
      fastify.log.error({ err }, 'Baileys: falha ao iniciar consumidores');
    });
  });

  fastify.addHook('onClose', async () => {
    const baileysService = container.resolve(BaileysService);
    await Promise.allSettled(
      consumers
        .map((consumer) => consumer?.close?.() ?? Promise.resolve())
        .concat(baileysService.shutdown())
    );
  });
});

export default baileysConsumersOnListenHook;
