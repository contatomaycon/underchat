import RegisterController from '@/controllers/register';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { container } from 'tsyringe';
import { sendTwoFactorSchema } from '@core/schema/register/sendTwoFactor';
import { verifyCodeSchema } from '@core/schema/register/verifyCode';
import { getRegisterZipcodeSchema } from '@core/schema/register/viewZipcode';
import { listRegisterStatesSchema } from '@core/schema/register/listStates';
import { listRegisterCitiesSchema } from '@core/schema/register/listCities';
import { listRegisterPlanWithItemsSchema } from '@core/schema/register/listPlanWithItems';
import { listRegisterAvailableCrossSellSchema } from '@core/schema/register/listAvailableCrossSell';
import { listRegisterCreditCardFeeSchema } from '@core/schema/register/listCreditCardFee';
import { createRegisterOrderPaymentSchema } from '@core/schema/register/createOrderPayment';
import { registerCentrifugoTokenSchema } from '@core/schema/register/centrifugoToken';
import { listRegisterMethodPaymentsSchema } from '@core/schema/register/listMethodPayments';

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

  server.get('/register/plans/with-items', {
    schema: listRegisterPlanWithItemsSchema,
    handler: registerController.listPlanWithItems,
    preHandler: [
      async (request: FastifyRequest, reply: FastifyReply) => {
        await server.authenticateRegisterJwt(request, reply);
      },
    ],
  });

  server.get('/register/plans/cross-sell/available', {
    schema: listRegisterAvailableCrossSellSchema,
    handler: registerController.listAvailableCrossSell,
    preHandler: [
      async (request: FastifyRequest, reply: FastifyReply) => {
        await server.authenticateRegisterJwt(request, reply);
      },
    ],
  });

  server.get('/register/credit-card-fee', {
    schema: listRegisterCreditCardFeeSchema,
    handler: registerController.listCreditCardFee,
    preHandler: [
      async (request: FastifyRequest, reply: FastifyReply) => {
        await server.authenticateRegisterJwt(request, reply);
      },
    ],
  });

  server.post('/register/order/payment', {
    schema: createRegisterOrderPaymentSchema,
    handler: registerController.createOrderPayment,
    preHandler: [
      async (request: FastifyRequest, reply: FastifyReply) => {
        await server.authenticateRegisterJwt(request, reply);
      },
    ],
  });

  server.post('/register/centrifugo/auth/token', {
    schema: registerCentrifugoTokenSchema,
    handler: registerController.centrifugoToken,
    preHandler: [
      async (request: FastifyRequest, reply: FastifyReply) => {
        await server.authenticateRegisterJwt(request, reply);
      },
    ],
  });

  server.get('/register/method-payments', {
    schema: listRegisterMethodPaymentsSchema,
    handler: registerController.listMethodPayments,
    preHandler: [
      async (request: FastifyRequest, reply: FastifyReply) => {
        await server.authenticateRegisterJwt(request, reply);
      },
    ],
  });
}
