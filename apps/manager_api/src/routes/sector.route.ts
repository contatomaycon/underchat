import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import SectorController from '@core/controllers/sector';
import {
  sectorCreatePermissions,
  sectorDeletePermissions,
  sectorEditPermissions,
  sectorViewPermissions,
} from '@/permissions';
import { createSectorSchema } from '@core/schema/sector/createSector';
import { deleteSectorSchema } from '@core/schema/sector/deleteSector';
import { listSectorSchema } from '@core/schema/sector/listSector';
import { viewSectorSchema } from '@core/schema/sector/viewSector';
import { editSectorSchema } from '@core/schema/sector/editSector';
import { listSectorUsersSchema } from '@core/schema/sector/listSectorUsers';
import { planGuard } from '@/plugins/planGuard';
import { planStatus } from '@/plugins/planStatus';

export default function sectorRoutes(server: FastifyInstance) {
  const sectorController = container.resolve(SectorController);

  server.get('/sector', {
    schema: listSectorSchema,
    handler: sectorController.listSector,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, sectorViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/sector/:sector_id', {
    schema: viewSectorSchema,
    handler: sectorController.viewSector,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, sectorViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.delete('/sector/:sector_id', {
    schema: deleteSectorSchema,
    handler: sectorController.deleteSector,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, sectorDeletePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/sector/:sector_id', {
    schema: editSectorSchema,
    handler: sectorController.editSector,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, sectorEditPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/sector', {
    schema: createSectorSchema,
    handler: sectorController.createSector,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, sectorCreatePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/sector/:sector_id/users', {
    schema: listSectorUsersSchema,
    handler: sectorController.listSectorUsers,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, sectorViewPermissions),
      planGuard,
      planStatus,
    ],
  });
}
