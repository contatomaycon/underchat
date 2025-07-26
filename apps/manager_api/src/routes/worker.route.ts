import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import WorkerController from '@/controllers/worker';
import { listWorkerSchema } from '@core/schema/worker/listWorker';
import { workerCreatePermissions, workerViewPermissions } from '@/permissions';
import { managerCreateWorkerSchema } from '@core/schema/worker/managerCreateWorker';

export default async function workerRoutes(server: FastifyInstance) {
  const workerController = container.resolve(WorkerController);

  server.post('/worker', {
    schema: managerCreateWorkerSchema,
    handler: workerController.createWorker,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerCreatePermissions),
    ],
  });

  server.get('/worker', {
    schema: listWorkerSchema,
    handler: workerController.listWorker,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerViewPermissions),
    ],
  });
}
