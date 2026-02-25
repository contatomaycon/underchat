import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import {
  randomMessageCreatePermissions,
  randomMessageDeletePermissions,
  randomMessageUpdatePermissions,
  randomMessageViewPermissions,
} from '@/permissions';
import RandomMessageController from '@/controllers/randomMessage';
import { listRandomMessageSchema } from '@core/schema/randomMessage/listRandomMessage';
import { createRandomMessageSchema } from '@core/schema/randomMessage/createRandomMessage';
import { viewRandomMessageSchema } from '@core/schema/randomMessage/viewRandomMessage';
import { updateRandomMessageSchema } from '@core/schema/randomMessage/updateRandomMessage';
import { deleteRandomMessageSchema } from '@core/schema/randomMessage/deleteRandomMessage';
import { listRandomMessageItemSchema } from '@core/schema/randomMessage/listRandomMessageItem';
import { createRandomMessageItemSchema } from '@core/schema/randomMessage/createRandomMessageItem';
import { viewRandomMessageItemSchema } from '@core/schema/randomMessage/viewRandomMessageItem';
import { updateRandomMessageItemSchema } from '@core/schema/randomMessage/updateRandomMessageItem';
import { deleteRandomMessageItemSchema } from '@core/schema/randomMessage/deleteRandomMessageItem';
import { planGuard } from '@/plugins/planGuard';
import { planStatus } from '@/plugins/planStatus';

export default async function randomMessageRoutes(server: FastifyInstance) {
  const randomMessageController = container.resolve(RandomMessageController);

  server.get('/random-message', {
    schema: listRandomMessageSchema,
    handler: randomMessageController.listRandomMessage,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, randomMessageViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/random-message', {
    schema: createRandomMessageSchema,
    handler: randomMessageController.createRandomMessage,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, randomMessageCreatePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/random-message/:random_message_id', {
    schema: viewRandomMessageSchema,
    handler: randomMessageController.viewRandomMessage,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, randomMessageViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/random-message/:random_message_id', {
    schema: updateRandomMessageSchema,
    handler: randomMessageController.updateRandomMessage,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, randomMessageUpdatePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.delete('/random-message/:random_message_id', {
    schema: deleteRandomMessageSchema,
    handler: randomMessageController.deleteRandomMessage,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, randomMessageDeletePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/random-message/:random_message_id/messages', {
    schema: listRandomMessageItemSchema,
    handler: randomMessageController.listRandomMessageItem,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, randomMessageViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/random-message/:random_message_id/messages', {
    schema: createRandomMessageItemSchema,
    handler: randomMessageController.createRandomMessageItem,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, randomMessageCreatePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get(
    '/random-message/:random_message_id/messages/:random_message_item_id',
    {
      schema: viewRandomMessageItemSchema,
      handler: randomMessageController.viewRandomMessageItem,
      preHandler: [
        (request, reply) =>
          server.authenticateJwt(request, reply, randomMessageViewPermissions),
        planGuard,
        planStatus,
      ],
    }
  );

  server.patch(
    '/random-message/:random_message_id/messages/:random_message_item_id',
    {
      schema: updateRandomMessageItemSchema,
      handler: randomMessageController.updateRandomMessageItem,
      preHandler: [
        (request, reply) =>
          server.authenticateJwt(
            request,
            reply,
            randomMessageUpdatePermissions
          ),
        planGuard,
        planStatus,
      ],
    }
  );

  server.delete(
    '/random-message/:random_message_id/messages/:random_message_item_id',
    {
      schema: deleteRandomMessageItemSchema,
      handler: randomMessageController.deleteRandomMessageItem,
      preHandler: [
        (request, reply) =>
          server.authenticateJwt(
            request,
            reply,
            randomMessageDeletePermissions
          ),
        planGuard,
        planStatus,
      ],
    }
  );
}
