import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import ScheduleController from '@/controllers/schedule';
import {
  scheduleCreatePermissions,
  scheduleDeletePermissions,
  scheduleUpdatePermissions,
  scheduleViewPermissions,
} from '@/permissions';
import { listScheduleSchema } from '@core/schema/schedule/listSchedule';
import { createScheduleSchema } from '@core/schema/schedule/createSchedule';
import { viewScheduleSchema } from '@core/schema/schedule/viewSchedule';
import { deleteScheduleSchema } from '@core/schema/schedule/deleteSchedule';
import { editScheduleSchema } from '@core/schema/schedule/editSchedule';
import { listScheduleWorkersSchema } from '@core/schema/schedule/listScheduleWorkers';
import { listScheduleChatbotsSchema } from '@core/schema/schedule/listScheduleChatbots';
import { listScheduleContactsSchema } from '@core/schema/schedule/listScheduleContacts';
import { listScheduleContactGroupsSchema } from '@core/schema/schedule/listScheduleContactGroups';
import { listScheduleMessagesSchema } from '@core/schema/schedule/listScheduleMessages';
import { planGuard } from '@/plugins/planGuard';
import { planStatus } from '@/plugins/planStatus';

export default function scheduleRoutes(server: FastifyInstance) {
  const scheduleController = container.resolve(ScheduleController);

  server.get('/schedule', {
    schema: listScheduleSchema,
    handler: scheduleController.listSchedule,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, scheduleViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/schedule', {
    schema: createScheduleSchema,
    handler: scheduleController.createSchedule,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, scheduleCreatePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/schedule/:schedule_id', {
    schema: viewScheduleSchema,
    handler: scheduleController.viewSchedule,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, scheduleViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.delete('/schedule/:schedule_id', {
    schema: deleteScheduleSchema,
    handler: scheduleController.deleteSchedule,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, scheduleDeletePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/schedule/:schedule_id', {
    schema: editScheduleSchema,
    handler: scheduleController.updateSchedule,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, scheduleUpdatePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/schedule/workers', {
    schema: listScheduleWorkersSchema,
    handler: scheduleController.listScheduleWorkers,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, scheduleViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/schedule/chatbots', {
    schema: listScheduleChatbotsSchema,
    handler: scheduleController.listScheduleChatbots,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, scheduleViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/schedule/contacts', {
    schema: listScheduleContactsSchema,
    handler: scheduleController.listScheduleContacts,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, scheduleViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/schedule/contact-groups', {
    schema: listScheduleContactGroupsSchema,
    handler: scheduleController.listScheduleContactGroups,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, scheduleViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/schedule/messages', {
    schema: listScheduleMessagesSchema,
    handler: scheduleController.listScheduleMessages,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, scheduleViewPermissions),
      planGuard,
      planStatus,
    ],
  });
}
