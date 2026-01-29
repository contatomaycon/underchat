import { FastifyInstance } from 'fastify';
import { startConnectionConsume } from './connection.consume';
import { startSendMessageConsume } from './sendMessage.consume';
import { startMarkMessageReadConsume } from './markMessageRead.consume';
import { startPhoneValidationConsume } from './phoneValidation.consume';
import { startNotificationMessageSendConsume } from './notificationMessageSend.consume';
import { startScheduleMessageConsume } from './scheduleMessage.consume';
import { startWorkerConfigUpdateConsume } from './workerConfigUpdate.consume';
import { startWebhookIntegrationConsume } from './webhookIntegration.consume';

const consumers: Array<{ close?: () => Promise<void> }> = [];

export function registerConsumersCloseHook(server: FastifyInstance): void {
  console.log(
    '[worker_baileys:init] consumer/index.ts: registerConsumersCloseHook chamado',
    { ts: Date.now() }
  );
  server.addHook('onClose', async () => {
    console.log('[worker_baileys:init] consumer/index.ts: onClose iniciado', {
      ts: Date.now(),
    });
    await Promise.allSettled(
      consumers.map((consumer) => consumer?.close?.() ?? Promise.resolve())
    );
    console.log('[worker_baileys:init] consumer/index.ts: onClose concluído', {
      ts: Date.now(),
    });
  });
  console.log(
    '[worker_baileys:init] consumer/index.ts: registerConsumersCloseHook concluído',
    { ts: Date.now() }
  );
}

export function startConsumers(server: FastifyInstance): void {
  console.log(
    '[worker_baileys:init] consumer/index.ts: startConsumers chamado',
    { ts: Date.now() }
  );
  setImmediate(() => {
    const t0 = Date.now();
    console.log(
      '[worker_baileys:init] consumer/index.ts: setImmediate callback iniciado',
      { ts: Date.now() }
    );
    let t = Date.now();
    consumers.push(startConnectionConsume(server));
    console.log(
      '[worker_baileys:init] consumer/index.ts: startConnectionConsume retornou',
      { ts: Date.now(), ms: Date.now() - t }
    );
    t = Date.now();
    consumers.push(startSendMessageConsume(server));
    console.log(
      '[worker_baileys:init] consumer/index.ts: startSendMessageConsume retornou',
      { ts: Date.now(), ms: Date.now() - t }
    );
    t = Date.now();
    consumers.push(startMarkMessageReadConsume(server));
    console.log(
      '[worker_baileys:init] consumer/index.ts: startMarkMessageReadConsume retornou',
      { ts: Date.now(), ms: Date.now() - t }
    );
    t = Date.now();
    consumers.push(startPhoneValidationConsume(server));
    console.log(
      '[worker_baileys:init] consumer/index.ts: startPhoneValidationConsume retornou',
      { ts: Date.now(), ms: Date.now() - t }
    );
    t = Date.now();
    consumers.push(startNotificationMessageSendConsume(server));
    console.log(
      '[worker_baileys:init] consumer/index.ts: startNotificationMessageSendConsume retornou',
      { ts: Date.now(), ms: Date.now() - t }
    );
    t = Date.now();
    consumers.push(startScheduleMessageConsume(server));
    console.log(
      '[worker_baileys:init] consumer/index.ts: startScheduleMessageConsume retornou',
      { ts: Date.now(), ms: Date.now() - t }
    );
    t = Date.now();
    consumers.push(startWorkerConfigUpdateConsume(server));
    console.log(
      '[worker_baileys:init] consumer/index.ts: startWorkerConfigUpdateConsume retornou',
      { ts: Date.now(), ms: Date.now() - t }
    );
    t = Date.now();
    consumers.push(startWebhookIntegrationConsume(server));
    console.log(
      '[worker_baileys:init] consumer/index.ts: startWebhookIntegrationConsume retornou',
      { ts: Date.now(), ms: Date.now() - t }
    );
    console.log(
      '[worker_baileys:init] consumer/index.ts: todos consumers iniciados',
      { ts: Date.now(), msTotal: Date.now() - t0 }
    );
  });
  console.log(
    '[worker_baileys:init] consumer/index.ts: startConsumers retornou (setImmediate agendado)',
    { ts: Date.now() }
  );
}
