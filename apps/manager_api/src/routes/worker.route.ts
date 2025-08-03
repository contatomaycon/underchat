import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import WorkerController from '@/controllers/worker';
import { listWorkerSchema } from '@core/schema/worker/listWorker';
import {
  workerCreatePermissions,
  workerDeletePermissions,
  workerEditPermissions,
  workerLogsConnectionPermissions,
  workerRecreatePermissions,
  workerViewPermissions,
} from '@/permissions';
import { createWorkerSchema } from '@core/schema/worker/createWorker';
import { editWorkerSchema } from '@core/schema/worker/editWorker';
import { viewWorkerSchema } from '@core/schema/worker/viewWorker';
import { deleteWorkerSchema } from '@core/schema/worker/deleteWorker';
import { statusConnectionWorkerSchema } from '@core/schema/worker/statusConnection';
import { workerConnectionLogsSchema } from '@core/schema/worker/workerConnectionLogs';
import { recreateWorkerSchema } from '@core/schema/worker/recreateWorker';

export default async function workerRoutes(server: FastifyInstance) {
  const workerController = container.resolve(WorkerController);

  server.post('/worker', {
    schema: createWorkerSchema,
    handler: workerController.createWorker,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerCreatePermissions),
    ],
  });

  server.patch('/worker/:worker_id', {
    schema: recreateWorkerSchema,
    handler: workerController.recreateWorker,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerRecreatePermissions),
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

  server.get('/worker/:worker_id', {
    schema: viewWorkerSchema,
    handler: workerController.viewWorker,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerViewPermissions),
    ],
  });

  server.patch('/worker/:worker_id/:name', {
    schema: editWorkerSchema,
    handler: workerController.updateWorker,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerEditPermissions),
    ],
  });

  server.delete('/worker/:worker_id', {
    schema: deleteWorkerSchema,
    handler: workerController.deleteWorker,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerDeletePermissions),
    ],
  });

  server.post('/worker/whatsapp/unofficial', {
    schema: statusConnectionWorkerSchema,
    handler: workerController.changeStatusConnection,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerCreatePermissions),
    ],
  });

  server.get('/worker/logs/connection/:worker_id', {
    schema: workerConnectionLogsSchema,
    handler: workerController.workerConnectionLogs,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerLogsConnectionPermissions),
    ],
  });
}
