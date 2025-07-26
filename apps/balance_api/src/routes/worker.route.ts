import WorkerController from '@/controllers/worker';
import { workerCreatePermissions } from '@/permissions';
import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { createWorkerSchema } from '@core/schema/worker/createWorker';

export default async function workerRoutes(server: FastifyInstance) {
  const workerController = container.resolve(WorkerController);

  server.post('/worker', {
    schema: createWorkerSchema,
    handler: workerController.createWorker,
    preHandler: [
      (request, reply) =>
        server.authenticateKeyApi(request, reply, workerCreatePermissions),
    ],
  });
}
