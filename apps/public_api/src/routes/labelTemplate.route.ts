import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import {
  labelTemplateCreatePermissions,
  labelTemplateDeletePermissions,
  labelTemplateUpdatePermissions,
  labelTemplateViewPermissions,
} from '@core/permissions/publicApi.permissions';
import LabelTemplateController from '@core/controllers/labelTemplate';
import { listLabelTemplateSchema } from '@core/schema/labelTemplate/listLabelTemplate';
import { createLabelTemplateSchema } from '@core/schema/labelTemplate/createLabelTemplate';
import { viewLabelTemplateSchema } from '@core/schema/labelTemplate/viewLabelTemplate';
import { deleteLabelTemplateSchema } from '@core/schema/labelTemplate/deleteLabelTemplate';
import { editLabelTemplateSchema } from '@core/schema/labelTemplate/editLabelTemplate';
import { listLabelTemplateAllSchema } from '@core/schema/labelTemplate/listLabelTemplateAll';
import { planGuard, planStatus } from '@core/middlewares/planAccess.middleware';
import { publicApiSchema } from '@core/common/functions/publicApiSchema';

export default async function publicLabelTemplateRoutes(
  server: FastifyInstance
) {
  const labelTemplateController = container.resolve(LabelTemplateController);

  server.get('/label-template', {
    schema: publicApiSchema(listLabelTemplateSchema),
    handler: labelTemplateController.listLabelTemplate,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(
          request,
          reply,
          labelTemplateViewPermissions
        ),
      planGuard,
      planStatus,
    ],
  });

  server.get('/label-template/all', {
    schema: publicApiSchema(listLabelTemplateAllSchema),
    handler: labelTemplateController.listLabelTemplateAll,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(
          request,
          reply,
          labelTemplateViewPermissions
        ),
      planGuard,
      planStatus,
    ],
  });

  server.post('/label-template', {
    schema: publicApiSchema(createLabelTemplateSchema),
    handler: labelTemplateController.createLabelTemplate,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(
          request,
          reply,
          labelTemplateCreatePermissions
        ),
      planGuard,
      planStatus,
    ],
  });

  server.get('/label-template/:label_template_id', {
    schema: publicApiSchema(viewLabelTemplateSchema),
    handler: labelTemplateController.viewLabelTemplate,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(
          request,
          reply,
          labelTemplateViewPermissions
        ),
      planGuard,
      planStatus,
    ],
  });

  server.delete('/label-template/:label_template_id', {
    schema: publicApiSchema(deleteLabelTemplateSchema),
    handler: labelTemplateController.deleteLabelTemplate,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(
          request,
          reply,
          labelTemplateDeletePermissions
        ),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/label-template/:label_template_id', {
    schema: publicApiSchema(editLabelTemplateSchema),
    handler: labelTemplateController.updateLabelTemplate,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(
          request,
          reply,
          labelTemplateUpdatePermissions
        ),
      planGuard,
      planStatus,
    ],
  });
}
