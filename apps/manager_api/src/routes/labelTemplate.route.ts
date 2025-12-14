import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import {
  labelTemplateCreatePermissions,
  labelTemplateDeletePermissions,
  labelTemplateUpdatePermissions,
  labelTemplateViewPermissions,
} from '@/permissions';
import LabelTemplateController from '@/controllers/labelTemplate';
import { listLabelTemplateSchema } from '@core/schema/labelTemplate/listLabelTemplate';
import { createLabelTemplateSchema } from '@core/schema/labelTemplate/createLabelTemplate';
import { viewLabelTemplateSchema } from '@core/schema/labelTemplate/viewLabelTemplate';
import { deleteLabelTemplateSchema } from '@core/schema/labelTemplate/deleteLabelTemplate';
import { editLabelTemplateSchema } from '@core/schema/labelTemplate/editLabelTemplate';
import { listLabelTemplateAllSchema } from '@core/schema/labelTemplate/listLabelTemplateAll';
import { planGuard } from '@/plugins/planGuard';
import { planStatus } from '@/plugins/planStatus';

export default async function labelTemplateRoutes(server: FastifyInstance) {
  const labelTemplateController = container.resolve(LabelTemplateController);

  server.get('/label-template', {
    schema: listLabelTemplateSchema,
    handler: labelTemplateController.listLabelTemplate,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, labelTemplateViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/label-template/all', {
    schema: listLabelTemplateAllSchema,
    handler: labelTemplateController.listLabelTemplateAll,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, labelTemplateViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/label-template', {
    schema: createLabelTemplateSchema,
    handler: labelTemplateController.createLabelTemplate,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, labelTemplateCreatePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/label-template/:label_template_id', {
    schema: viewLabelTemplateSchema,
    handler: labelTemplateController.viewLabelTemplate,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, labelTemplateViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.delete('/label-template/:label_template_id', {
    schema: deleteLabelTemplateSchema,
    handler: labelTemplateController.deleteLabelTemplate,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, labelTemplateDeletePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/label-template/:label_template_id', {
    schema: editLabelTemplateSchema,
    handler: labelTemplateController.updateLabelTemplate,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, labelTemplateUpdatePermissions),
      planGuard,
      planStatus,
    ],
  });
}
