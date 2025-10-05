import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import SectorController from '@/controllers/sector';
import {
  sectorCreatePermissions,
  sectorDeletePermissions,
  sectorEditPermissions,
  sectorListPermissions,
  sectorViewPermissions,
} from '@/permissions';
import { createSectorSchema } from '@core/schema/sector/createSector';
import { deleteSectorSchema } from '@core/schema/sector/deleteSector';
import { listSectorSchema } from '@core/schema/sector/listSector';
import { viewSectorSchema } from '@core/schema/sector/viewSector';
import { editSectorSchema } from '@core/schema/sector/editSector';
import { listSectorRoleAccountSchema } from '@core/schema/sector/listSectorRoleAccount';
import { viewSectorRoleAccountSectorSchema } from '@core/schema/sector/viewSectorRoleAccountSector';
import { createSectorRoleSchema } from '@core/schema/sector/createSectorRole';

export default async function sectorRoutes(server: FastifyInstance) {
  const sectorController = container.resolve(SectorController);

  server.get('/sector', {
    schema: listSectorSchema,
    handler: sectorController.listSector,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, sectorListPermissions),
    ],
  });

  server.get('/sector/:sector_id', {
    schema: viewSectorSchema,
    handler: sectorController.viewSector,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, sectorViewPermissions),
    ],
  });

  server.delete('/sector/:sector_id', {
    schema: deleteSectorSchema,
    handler: sectorController.deleteSector,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, sectorDeletePermissions),
    ],
  });

  server.patch('/sector/:sector_id', {
    schema: editSectorSchema,
    handler: sectorController.editSector,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, sectorEditPermissions),
    ],
  });

  server.post('/sector', {
    schema: createSectorSchema,
    handler: sectorController.createSector,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, sectorCreatePermissions),
    ],
  });

  server.get('/sector-role/account', {
    schema: listSectorRoleAccountSchema,
    handler: sectorController.listSectorRoleAccount,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, sectorListPermissions),
    ],
  });

  server.get('/sector-role/account/:sector_id', {
    schema: viewSectorRoleAccountSectorSchema,
    handler: sectorController.listSectorRoleAccountSector,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, sectorViewPermissions),
    ],
  });

  server.post('/sector-role/:sector_id', {
    schema: createSectorRoleSchema,
    handler: sectorController.createSectorRole,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, sectorCreatePermissions),
    ],
  });
}
