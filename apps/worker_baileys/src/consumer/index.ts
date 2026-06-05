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
import { getWorkerConsumers, registerWorkerConsumer } from './registry';
import { baileysEnvironment } from '@core/config/environments';

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
      registerWorkerConsumer(start());
    } catch (err) {
      server.log.error({ err }, 'Erro ao iniciar consumidor Kafka');
    }
    await delay(CONSUMER_STAGGER_DELAY_MS);
  }
}

let activationPromise: Promise<void> | null = null;

export async function activateBaileysRuntime(
  fastify: FastifyInstance
): Promise<{ alreadyActive?: boolean }> {
  if (activationPromise) {
    await activationPromise;
    return { alreadyActive: true };
  }

  activationPromise = (async () => {
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

    await startConsumers(fastify);
  })();

  await activationPromise;
  return { alreadyActive: false };
}

const baileysConsumersOnListenHook = fp(async (fastify) => {
  fastify.addHook('onListen', () => {
    if (baileysEnvironment.isWarmStandby) {
      fastify.log.info(
        {
          component: 'baileys_consumer_boot',
          type: 'warm_pool.standby',
          warm_pool_id: baileysEnvironment.warmPoolId,
        },
        'Baileys warm standby: skipping session bootstrap and consumers'
      );
      return;
    }

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

    activationPromise = startConsumers(fastify).then(() => undefined);
    activationPromise.catch((err) => {
      fastify.log.error({ err }, 'Baileys: falha ao iniciar consumidores');
    });
  });

  fastify.addHook('onClose', async () => {
    const baileysService = container.resolve(BaileysService);
    await Promise.allSettled(
      getWorkerConsumers()
        .map((consumer) => consumer?.close?.() ?? Promise.resolve())
        .concat(baileysService.shutdown())
    );
  });
});

export default baileysConsumersOnListenHook;
