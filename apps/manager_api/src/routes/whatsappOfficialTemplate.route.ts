import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import WhatsappOfficialTemplateController from '@/controllers/whatsappOfficialTemplate';
import {
  createWhatsappTemplateSchema,
  deactivateWhatsappTemplateSchema,
  deleteWhatsappTemplateSchema,
  listWhatsappTemplatesSchema,
  syncWhatsappTemplatesSchema,
  updateWhatsappTemplateSchema,
  uploadWhatsappTemplateMediaSchema,
  viewWhatsappTemplateSchema,
} from '@core/schema/worker/whatsappOfficialTemplate';
import {
  workerDeletePermissions,
  workerEditPermissions,
  workerViewPermissions,
} from '@/permissions';
import { planGuard } from '@/plugins/planGuard';
import { planStatus } from '@/plugins/planStatus';

export default function whatsappOfficialTemplateRoutes(
  server: FastifyInstance
) {
  const controller = container.resolve(WhatsappOfficialTemplateController);

  server.get('/worker/:worker_id/whatsapp-official/templates', {
    schema: listWhatsappTemplatesSchema,
    handler: controller.listWhatsappTemplates,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/worker/:worker_id/whatsapp-official/templates/sync', {
    schema: syncWhatsappTemplatesSchema,
    handler: controller.syncWhatsappTemplates,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerEditPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/worker/:worker_id/whatsapp-official/templates/media', {
    schema: uploadWhatsappTemplateMediaSchema,
    handler: controller.uploadWhatsappTemplateMedia,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerEditPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/worker/:worker_id/whatsapp-official/templates', {
    schema: createWhatsappTemplateSchema,
    handler: controller.createWhatsappTemplate,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerEditPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/worker/:worker_id/whatsapp-official/templates/:template_id', {
    schema: viewWhatsappTemplateSchema,
    handler: controller.viewWhatsappTemplate,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/worker/:worker_id/whatsapp-official/templates/:template_id', {
    schema: updateWhatsappTemplateSchema,
    handler: controller.updateWhatsappTemplate,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerEditPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.delete('/worker/:worker_id/whatsapp-official/templates/:template_id', {
    schema: deleteWhatsappTemplateSchema,
    handler: controller.deleteWhatsappTemplate,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerDeletePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch(
    '/worker/:worker_id/whatsapp-official/templates/:template_id/deactivate',
    {
      schema: deactivateWhatsappTemplateSchema,
      handler: controller.deactivateWhatsappTemplate,
      preHandler: [
        (request, reply) =>
          server.authenticateJwt(request, reply, workerDeletePermissions),
        planGuard,
        planStatus,
      ],
    }
  );
}
