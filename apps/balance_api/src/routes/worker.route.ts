import WorkerController from '@/controllers/worker';
import { workerCreatePermissions } from '@/permissions';
import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { balanceCreateWorkerSchema } from '@core/schema/worker/balanceCreateWorker';

export default async function workerRoutes(server: FastifyInstance) {
  const workerController = container.resolve(WorkerController);

  server.post('/worker', {
    schema: balanceCreateWorkerSchema,
    handler: workerController.createWorker,
    preHandler: [
      (request, reply) =>
        server.authenticateKeyApi(request, reply, workerCreatePermissions),
    ],
  });
}
