import RegisterController from '@/controllers/register';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { container } from 'tsyringe';
import { sendTwoFactorSchema } from '@core/schema/register/sendTwoFactor';
import { verifyCodeSchema } from '@core/schema/register/verifyCode';
import { getRegisterZipcodeSchema } from '@core/schema/register/viewZipcode';
import { listRegisterStatesSchema } from '@core/schema/register/listStates';
import { listRegisterCitiesSchema } from '@core/schema/register/listCities';

export default function registerRoutes(server: FastifyInstance) {
  const registerController = container.resolve(RegisterController);

  server.post('/register/send-two-factor', {
    schema: sendTwoFactorSchema,
    handler: registerController.sendTwoFactor,
  });

  server.post('/register/verify-code', {
    schema: verifyCodeSchema,
    handler: registerController.verifyCode,
  });

  server.get('/register/view-zipcode', {
    schema: getRegisterZipcodeSchema,
    handler: registerController.viewZipcode,
    preHandler: [
      async (request: FastifyRequest, reply: FastifyReply) => {
        await server.authenticateRegisterJwt(request, reply);
      },
    ],
  });

  server.get('/register/states', {
    schema: listRegisterStatesSchema,
    handler: registerController.listStates,
    preHandler: [
      async (request: FastifyRequest, reply: FastifyReply) => {
        await server.authenticateRegisterJwt(request, reply);
      },
    ],
  });

  server.get('/register/cities', {
    schema: listRegisterCitiesSchema,
    handler: registerController.listCities,
    preHandler: [
      async (request: FastifyRequest, reply: FastifyReply) => {
        await server.authenticateRegisterJwt(request, reply);
      },
    ],
  });
}
