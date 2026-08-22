import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { WorkerRuntimeEventOutboxService } from '@core/services/workerRuntimeEventOutbox.service';
import { WorkerSelfHealRequestDispatcherService } from '@core/services/workerSelfHealRequestDispatcher.service';

export const workerRuntimeEventOutboxPlugin: FastifyPluginAsync = async (
  server
) => {
  const outbox = container.resolve(WorkerRuntimeEventOutboxService);
  const selfHealDispatcher = container.resolve(
    WorkerSelfHealRequestDispatcherService
  );

  server.addHook('onListen', () => {
    outbox.start({
      onError: (error: unknown) => {
        server.log.error(
          {
            error_name: error instanceof Error ? error.name : 'UnknownError',
            type: 'worker_runtime_event_outbox_drain_failed',
          },
          'Worker runtime event outbox drain failed'
        );
      },
    });
    selfHealDispatcher.start({
      onError: (error: unknown) => {
        server.log.error(
          {
            error_name: error instanceof Error ? error.name : 'UnknownError',
            type: 'worker_self_heal_dispatch_failed',
          },
          'Worker self-heal request dispatch failed'
        );
      },
    });
  });

  server.addHook('onClose', async () => {
    await Promise.all([outbox.close(), selfHealDispatcher.close()]);
  });
};

export default fp(workerRuntimeEventOutboxPlugin, {
  name: 'worker-runtime-event-outbox-plugin',
  dependencies: ['database', 'redis', 'centrifugo'],
});
