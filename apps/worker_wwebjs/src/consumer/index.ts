import { FastifyInstance } from 'fastify';
import { startSendMessageWwebjsConsume } from './sendMessage.consume';
import { startMarkMessageReadWwebjsConsume } from './markMessageRead.consume';
import { startPhoneValidationWwebjsConsume } from './phoneValidation.consume';
import { startNotificationMessageSendWwebjsConsume } from './notificationMessageSend.consume';
import { startScheduleMessageWwebjsConsume } from './scheduleMessage.consume';
import { startWorkerConfigUpdateWwebjsConsume } from './workerConfigUpdate.consume';
import { startWebhookIntegrationWwebjsConsume } from './webhookIntegration.consume';
import { startConnectionQrCodeWwebjsConsume } from './connectionQrCode.consume';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { WwebjsHealthCheckService } from '@core/services/wwebjs/methods/healthCheck.service';
import { WwebjsService } from '@core/services/wwebjs';
import { WorkerSelfMonitorService } from '@core/services/workerSelfMonitor.service';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import {
  getKafkaConsumerHealthSnapshots,
  getWorkerConsumers,
  hasUnhealthyKafkaConsumer,
  registerWorkerConsumer,
  startKafkaConsumerSupervisor,
} from './registry';
import { wwebjsEnvironment } from '@core/config/environments';

const CONSUMER_STAGGER_DELAY_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startConsumers(server: FastifyInstance): Promise<void> {
  server.qrStreamReady = false;
  try {
    registerWorkerConsumer(await startConnectionQrCodeWwebjsConsume(server), {
      monitorKafkaHealth: false,
    });
    server.qrStreamReady = true;
  } catch (err) {
    server.qrStreamReady = false;
    server.log.error({ err }, 'Erro ao iniciar consumidor Redis de QR');
    throw err;
  }

  void startDeferredConsumers(server);
  startKafkaConsumerSupervisor(server.log);
  startWorkerSelfMonitor(server);
}

function startWorkerSelfMonitor(server: FastifyInstance): void {
  const monitor = container.resolve(WorkerSelfMonitorService);
  const healthCheckService = container.resolve(WwebjsHealthCheckService);
  monitor.start({
    provider: EWorkerType.wwebjs,
    workerId: wwebjsEnvironment.wwebjsWorkerId,
    accountId: wwebjsEnvironment.wwebjsAccountId,
    workerTypeId: EWorkerType.wwebjs,
    runtimeGeneration: wwebjsEnvironment.runtimeGeneration,
    warmStandby: wwebjsEnvironment.isWarmStandby,
    getReadiness: () => healthCheckService.verifyCurrentSession(),
    hasUnhealthyKafkaConsumer,
    getKafkaConsumerHealthSnapshots,
    log: server.log,
  });
}

async function startDeferredConsumers(server: FastifyInstance): Promise<void> {
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
      registerWorkerConsumer(start());
    } catch (err) {
      server.log.error({ err }, 'Erro ao iniciar consumidor Kafka');
    }
    await delay(CONSUMER_STAGGER_DELAY_MS);
  }
}

let activationPromise: Promise<void> | null = null;

export async function activateWwebjsRuntime(
  fastify: FastifyInstance
): Promise<{ alreadyActive?: boolean }> {
  if (activationPromise) {
    await activationPromise;
    return { alreadyActive: true };
  }

  activationPromise = (async () => {
    try {
      const healthCheckService = container.resolve(WwebjsHealthCheckService);
      fastify.wwebjsInitialized = healthCheckService.bootstrapConnection();
    } catch (err) {
      fastify.log.error(
        { err },
        'Wwebjs: falha ao iniciar bootstrap de conexão'
      );
      fastify.wwebjsInitialized = Promise.resolve();
    }

    await startConsumers(fastify);
  })();

  await activationPromise;
  return { alreadyActive: false };
}

const wwebjsConsumersOnListenHook = fp(async (fastify) => {
  fastify.addHook('onListen', () => {
    if (wwebjsEnvironment.isWarmStandby) {
      fastify.log.info(
        {
          component: 'wwebjs_consumer_boot',
          type: 'warm_pool.standby',
          warm_pool_id: wwebjsEnvironment.warmPoolId,
        },
        'Wwebjs warm standby: skipping session bootstrap and consumers'
      );
      return;
    }

    try {
      const healthCheckService = container.resolve(WwebjsHealthCheckService);

      fastify.wwebjsInitialized = healthCheckService.bootstrapConnection();
    } catch (err) {
      fastify.log.error(
        { err },
        'Wwebjs: falha ao iniciar bootstrap de conexão'
      );
      fastify.wwebjsInitialized = Promise.resolve();
    }

    activationPromise = startConsumers(fastify).then(() => undefined);
    activationPromise.catch((err) => {
      fastify.log.error({ err }, 'Wwebjs: falha ao iniciar consumidores');
    });
  });

  fastify.addHook('onClose', async () => {
    const wwebjsService = container.resolve(WwebjsService);
    container.resolve(WorkerSelfMonitorService).stop();
    await Promise.allSettled(
      getWorkerConsumers()
        .map((consumer) => consumer?.close?.() ?? Promise.resolve())
        .concat(wwebjsService.shutdown())
    );
  });
});

export default wwebjsConsumersOnListenHook;
