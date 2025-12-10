import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import {
  expenditureCreatePermissions,
  expenditureDeletePermissions,
  expenditureUpdatePermissions,
  expenditureViewPermissions,
} from '@/permissions';
import ExpenditureController from '@/controllers/expenditure';
import { listExpenditureSchema } from '@core/schema/expenditure/listExpenditure';
import { createExpenditureSchema } from '@core/schema/expenditure/createExpenditure';
import { viewExpenditureSchema } from '@core/schema/expenditure/viewExpenditure';
import { deleteExpenditureSchema } from '@core/schema/expenditure/deleteExpenditure';
import { editExpenditureSchema } from '@core/schema/expenditure/editExpenditure';

export default async function expenditureRoutes(server: FastifyInstance) {
  const expenditureController = container.resolve(ExpenditureController);

  server.get('/expenditure', {
    schema: listExpenditureSchema,
    handler: expenditureController.listExpenditure,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, expenditureViewPermissions),
    ],
  });

  server.post('/expenditure', {
    schema: createExpenditureSchema,
    handler: expenditureController.createExpenditure,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, expenditureCreatePermissions),
    ],
  });

  server.get('/expenditure/:expenditure_id', {
    schema: viewExpenditureSchema,
    handler: expenditureController.viewExpenditure,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, expenditureViewPermissions),
    ],
  });

  server.delete('/expenditure/:expenditure_id', {
    schema: deleteExpenditureSchema,
    handler: expenditureController.deleteExpenditure,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, expenditureDeletePermissions),
    ],
  });

  server.patch('/expenditure/:expenditure_id', {
    schema: editExpenditureSchema,
    handler: expenditureController.updateExpenditure,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, expenditureUpdatePermissions),
    ],
  });
}
