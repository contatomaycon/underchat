import WorkerController from '@/controllers/worker';
import {
  workerCreatePermissions,
  workerDeletePermissions,
} from '@/permissions';
import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { balanceCreateWorkerSchema } from '@core/schema/worker/balanceCreateWorker';
import { balanceDeleteWorkerSchema } from '@core/schema/worker/balanceDeleteWorker';

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

  server.delete('/worker/:worker_id', {
    schema: balanceDeleteWorkerSchema,
    handler: workerController.deleteWorker,
    preHandler: [
      (request, reply) =>
        server.authenticateKeyApi(request, reply, workerDeletePermissions),
    ],
  });
}
