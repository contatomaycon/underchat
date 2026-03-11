import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { createServerSchema } from '@core/schema/server/createServer';
import ServerController from '@/controllers/server';
import {
  serverBuildEditPermissions,
  serverBuildGeneratePermissions,
  serverBuildViewPermissions,
  serverCreatePermissions,
  serverDeletePermissions,
  serverEditPermissions,
  serverLogsInstallPermissions,
  serverReinstallPermissions,
  serverViewPermissions,
} from '@/permissions/server.permissions';
import { deleteServerSchema } from '@core/schema/server/deleteServer';
import { editServerSchema } from '@core/schema/server/editServer';
import { viewServerSchema } from '@core/schema/server/viewServer';
import { listServerSchema } from '@core/schema/server/listServer';
import { serverLogsInstallSchema } from '@core/schema/server/serverLogsInstall';
import { reinstallServerSchema } from '@core/schema/server/reinstallServer';
import { cancelInstallServerSchema } from '@core/schema/server/cancelInstallServer';
import { serverBuildViewSchema } from '@core/schema/server/viewServerBuild';
import { serverBuildGenerateSchema } from '@core/schema/server/generateServerBuild';
import { serverBuildCancelSchema } from '@core/schema/server/cancelServerBuild';
import { serverBuildDefaultSchema } from '@core/schema/server/setServerBuildDefault';
import { retryServerBuildSchema } from '@core/schema/server/retryServerBuild';

export default function serverRoutes(server: FastifyInstance) {
  const serverController = container.resolve(ServerController);

  server.post('/server', {
    schema: createServerSchema,
    handler: serverController.createServer,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, serverCreatePermissions),
    ],
  });

  server.get('/server', {
    schema: listServerSchema,
    handler: serverController.listServer,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, serverViewPermissions),
    ],
  });

  server.delete('/server/:server_id', {
    schema: deleteServerSchema,
    handler: serverController.deleteServer,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, serverDeletePermissions),
    ],
  });

  server.put('/server/:server_id', {
    schema: editServerSchema,
    handler: serverController.editServer,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, serverEditPermissions),
    ],
  });

  server.patch('/server/:server_id', {
    schema: reinstallServerSchema,
    handler: serverController.reinstallServer,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, serverReinstallPermissions),
    ],
  });

  server.patch('/server/:server_id/cancel-install', {
    schema: cancelInstallServerSchema,
    handler: serverController.cancelInstallServer,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, serverReinstallPermissions),
    ],
  });

  server.get('/server/build', {
    schema: serverBuildViewSchema,
    handler: serverController.listServerBuild,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, serverBuildViewPermissions),
    ],
  });

  server.post('/server/build/generate', {
    schema: serverBuildGenerateSchema,
    handler: serverController.generateServerBuild,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, serverBuildGeneratePermissions),
    ],
  });

  server.patch('/server/build/cancel', {
    schema: serverBuildCancelSchema,
    handler: serverController.cancelServerBuild,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, serverBuildEditPermissions),
    ],
  });

  server.patch('/server/build/default/:server_build_version_id', {
    schema: serverBuildDefaultSchema,
    handler: serverController.setServerBuildDefault,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, serverBuildEditPermissions),
    ],
  });

  server.post('/server/build/retry', {
    schema: retryServerBuildSchema,
    handler: serverController.retryServerBuild,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, serverBuildEditPermissions),
    ],
  });

  server.get('/server/:server_id', {
    schema: viewServerSchema,
    handler: serverController.viewServer,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, serverViewPermissions),
    ],
  });

  server.get('/server/logs/install/:server_id', {
    schema: serverLogsInstallSchema,
    handler: serverController.serverLogsInstall,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, serverLogsInstallPermissions),
    ],
  });
}
