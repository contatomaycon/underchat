import { WorkerImageReconcilerService } from '@core/services/workerImageReconciler.service';
import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';

export default async function workerImageReconcilerPlugin(
  server: FastifyInstance
): Promise<void> {
  const reconciler = container.resolve(WorkerImageReconcilerService);

  server.addHook('onReady', async (): Promise<void> => {
    reconciler.start();
  });
  server.addHook('onClose', async (): Promise<void> => {
    await reconciler.stop();
  });
}
