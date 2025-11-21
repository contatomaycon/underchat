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
  workerProfileStatusPermissions,
  workerProfileInfoPermissions,
} from '@/permissions';
import { createWorkerSchema } from '@core/schema/worker/createWorker';
import { editWorkerSchema } from '@core/schema/worker/editWorker';
import { viewWorkerSchema } from '@core/schema/worker/viewWorker';
import { deleteWorkerSchema } from '@core/schema/worker/deleteWorker';
import { statusConnectionWorkerSchema } from '@core/schema/worker/statusConnection';
import { workerConnectionLogsSchema } from '@core/schema/worker/workerConnectionLogs';
import { recreateWorkerSchema } from '@core/schema/worker/recreateWorker';
import { uploadProfileStatusSchema } from '@core/schema/worker/uploadProfileStatus';
import { listProfileStatusSchema } from '@core/schema/worker/listProfileStatus';
import { updateProfileStatusSchema } from '@core/schema/worker/updateProfileStatus';
import { deleteProfileStatusSchema } from '@core/schema/worker/deleteProfileStatus';
import { uploadProfileInfoSchema } from '@core/schema/worker/uploadProfileInfo';
import { viewProfileInfoSchema } from '@core/schema/worker/viewProfileInfo';
import { viewWorkerConfigSchema } from '@core/schema/worker/viewWorkerConfig';
import { updateWorkerConfigSchema } from '@core/schema/worker/updateWorkerConfig';

export default function workerRoutes(server: FastifyInstance) {
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

  server.post('/worker/:worker_id/profile/status', {
    schema: uploadProfileStatusSchema,
    handler: workerController.uploadProfileStatus,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerProfileStatusPermissions),
    ],
  });

  server.get('/worker/:worker_id/profile/status', {
    schema: listProfileStatusSchema,
    handler: workerController.listProfileStatus,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerProfileStatusPermissions),
    ],
  });

  server.patch('/worker/profile/status/:worker_profile_status_id', {
    schema: updateProfileStatusSchema,
    handler: workerController.updateProfileStatus,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerProfileStatusPermissions),
    ],
  });

  server.delete('/worker/profile/status/:worker_profile_status_id', {
    schema: deleteProfileStatusSchema,
    handler: workerController.deleteProfileStatus,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerProfileStatusPermissions),
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

  server.post('/worker/:worker_id/profile/info', {
    schema: uploadProfileInfoSchema,
    handler: workerController.uploadProfileInfo,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerProfileInfoPermissions),
    ],
  });

  server.get('/worker/:worker_id/profile/info', {
    schema: viewProfileInfoSchema,
    handler: workerController.viewProfileInfo,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerProfileInfoPermissions),
    ],
  });

  server.get('/worker/:worker_id/config', {
    schema: viewWorkerConfigSchema,
    handler: workerController.viewWorkerConfig,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerViewPermissions),
    ],
  });

  server.post('/worker/:worker_id/config', {
    schema: updateWorkerConfigSchema,
    handler: workerController.updateWorkerConfig,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerEditPermissions),
    ],
  });
}
