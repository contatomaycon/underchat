import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { zipcodeViewPermissions } from '@/permissions';
import ZipcodeController from '@/controllers/zipcode';
import { getZipcodeSchema } from '@core/schema/zipcode/viewZipcode';

export default async function zipcodeRoutes(server: FastifyInstance) {
  const zipcodeController = container.resolve(ZipcodeController);

  server.get('/zipcode', {
    schema: getZipcodeSchema,
    handler: zipcodeController.viewZipcode,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, zipcodeViewPermissions),
    ],
  });
}
