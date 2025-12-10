import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { zipcodeViewPermissions } from '@/permissions';
import ZipcodeController from '@/controllers/zipcode';
import { getZipcodeSchema } from '@core/schema/zipcode/viewZipcode';
import { listStatesSchema } from '@core/schema/zipcode/listStates';
import { listCitiesSchema } from '@core/schema/zipcode/listCities';

export default function zipcodeRoutes(server: FastifyInstance) {
  const zipcodeController = container.resolve(ZipcodeController);

  server.get('/zipcode', {
    schema: getZipcodeSchema,
    handler: zipcodeController.viewZipcode,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, zipcodeViewPermissions),
    ],
  });

  server.get('/zipcode/states', {
    schema: listStatesSchema,
    handler: zipcodeController.listStates,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, zipcodeViewPermissions),
    ],
  });

  server.get('/zipcode/cities', {
    schema: listCitiesSchema,
    handler: zipcodeController.listCities,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, zipcodeViewPermissions),
    ],
  });
}
