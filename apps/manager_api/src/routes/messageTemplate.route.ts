import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import {
  messageTemplateCreatePermissions,
  messageTemplateDeletePermissions,
  messageTemplateListPermissions,
  messageTemplateUpdatePermissions,
  messageTemplateViewPermissions,
} from '@/permissions';
import MessageTemplateController from '@/controllers/messageTemplate';
import { listMessageTemplateSchema } from '@core/schema/messageTemplate/listMessageTemplate';
import { createMessageTemplateSchema } from '@core/schema/messageTemplate/createMessageTemplate';
import { viewMessageTemplateSchema } from '@core/schema/messageTemplate/viewMessageTemplate';
import { deleteMessageTemplateSchema } from '@core/schema/messageTemplate/deleteMessageTemplate';
import { editMessageTemplateSchema } from '@core/schema/messageTemplate/editMessageTemplate';

export default async function messageTemplateRoutes(server: FastifyInstance) {
  const messageTemplateController = container.resolve(
    MessageTemplateController
  );

  server.get('/message-template', {
    schema: listMessageTemplateSchema,
    handler: messageTemplateController.listMessageTemplate,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, messageTemplateListPermissions),
    ],
  });

  server.post('/message-template', {
    schema: createMessageTemplateSchema,
    handler: messageTemplateController.createMessageTemplate,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(
          request,
          reply,
          messageTemplateCreatePermissions
        ),
    ],
  });

  server.get('/message-template/:message_template_id', {
    schema: viewMessageTemplateSchema,
    handler: messageTemplateController.viewMessageTemplate,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, messageTemplateViewPermissions),
    ],
  });

  server.delete('/message-template/:message_template_id', {
    schema: deleteMessageTemplateSchema,
    handler: messageTemplateController.deleteMessageTemplate,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(
          request,
          reply,
          messageTemplateDeletePermissions
        ),
    ],
  });

  server.patch('/message-template/:message_template_id', {
    schema: editMessageTemplateSchema,
    handler: messageTemplateController.updateMessageTemplate,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(
          request,
          reply,
          messageTemplateUpdatePermissions
        ),
    ],
  });
}
