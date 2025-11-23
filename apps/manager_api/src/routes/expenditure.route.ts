import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import {
  expenditureViewPermissions,
  expenditureCreatePermissions,
  expenditureUpdatePermissions,
  expenditureDeletePermissions,
} from '@/permissions';
import ExpenditureController from '@/controllers/expenditure';
import { listExpenditureSchema } from '@core/schema/expenditure/listExpenditure';
import { createExpenditureSchema } from '@core/schema/expenditure/createExpenditure';
import { updateExpenditureSchema } from '@core/schema/expenditure/updateExpenditure';
import { deleteExpenditureSchema } from '@core/schema/expenditure/deleteExpenditure';

export default function expenditureRoutes(server: FastifyInstance) {
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

  server.patch('/expenditure/:expenditure_id', {
    schema: updateExpenditureSchema,
    handler: expenditureController.updateExpenditure,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, expenditureUpdatePermissions),
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
}
