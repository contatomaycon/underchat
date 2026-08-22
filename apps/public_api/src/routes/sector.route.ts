import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import SectorController from '@core/controllers/sector';
import {
  sectorCreatePermissions,
  sectorDeletePermissions,
  sectorEditPermissions,
  sectorViewPermissions,
} from '@core/permissions/publicApi.permissions';
import { createSectorSchema } from '@core/schema/sector/createSector';
import { deleteSectorSchema } from '@core/schema/sector/deleteSector';
import { listSectorSchema } from '@core/schema/sector/listSector';
import { viewSectorSchema } from '@core/schema/sector/viewSector';
import { editSectorSchema } from '@core/schema/sector/editSector';
import { listSectorUsersSchema } from '@core/schema/sector/listSectorUsers';
import { planGuard, planStatus } from '@core/middlewares/planAccess.middleware';
import { publicApiSchema } from '@core/common/functions/publicApiSchema';

export default function publicSectorRoutes(server: FastifyInstance) {
  const sectorController = container.resolve(SectorController);

  server.get('/sector', {
    schema: publicApiSchema(listSectorSchema),
    handler: sectorController.listSector,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(
          request,
          reply,
          sectorViewPermissions
        ),
      planGuard,
      planStatus,
    ],
  });

  server.get('/sector/:sector_id', {
    schema: publicApiSchema(viewSectorSchema),
    handler: sectorController.viewSector,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(
          request,
          reply,
          sectorViewPermissions
        ),
      planGuard,
      planStatus,
    ],
  });

  server.delete('/sector/:sector_id', {
    schema: publicApiSchema(deleteSectorSchema),
    handler: sectorController.deleteSector,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(
          request,
          reply,
          sectorDeletePermissions
        ),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/sector/:sector_id', {
    schema: publicApiSchema(editSectorSchema),
    handler: sectorController.editSector,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(
          request,
          reply,
          sectorEditPermissions
        ),
      planGuard,
      planStatus,
    ],
  });

  server.post('/sector', {
    schema: publicApiSchema(createSectorSchema),
    handler: sectorController.createSector,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(
          request,
          reply,
          sectorCreatePermissions
        ),
      planGuard,
      planStatus,
    ],
  });

  server.get('/sector/:sector_id/users', {
    schema: publicApiSchema(listSectorUsersSchema),
    handler: sectorController.listSectorUsers,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(
          request,
          reply,
          sectorViewPermissions
        ),
      planGuard,
      planStatus,
    ],
  });
}
