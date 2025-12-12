import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import {
  contactGroupCreatePermissions,
  contactGroupDeletePermissions,
  contactGroupUpdatePermissions,
  contactGroupViewPermissions,
} from '@/permissions';
import { listContactGroupSchema } from '@core/schema/contactGroup/listContactGroup';
import ContactGroupController from '@/controllers/contactGroup';
import { listContactGroupAllSchema } from '@core/schema/contactGroup/listContactGroupAll';
import { createContactGroupSchema } from '@core/schema/contactGroup/createContactGroup';
import { viewContactGroupSchema } from '@core/schema/contactGroup/viewContactGroup';
import { deleteContactGroupSchema } from '@core/schema/contactGroup/deleteContactGroup';
import { editContactGroupSchema } from '@core/schema/contactGroup/editContactGroup';
import { createContactGroupAssignmentSchema } from '@core/schema/contactGroup/createContactGroupAssignment';
import { planGuard } from '@/plugins/planGuard';
import { planStatus } from '@/plugins/planStatus';

export default async function contactGroupRoutes(server: FastifyInstance) {
  const contactGroupController = container.resolve(ContactGroupController);

  server.get('/contact-group', {
    schema: listContactGroupSchema,
    handler: contactGroupController.listContactGroup,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, contactGroupViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/contact-group/all', {
    schema: listContactGroupAllSchema,
    handler: contactGroupController.listContactGroupAll,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, contactGroupViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/contact-group', {
    schema: createContactGroupSchema,
    handler: contactGroupController.createContactGroup,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, contactGroupCreatePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/contact-group/:contact_group_id', {
    schema: viewContactGroupSchema,
    handler: contactGroupController.viewContactGroup,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, contactGroupViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.delete('/contact-group/:contact_group_id', {
    schema: deleteContactGroupSchema,
    handler: contactGroupController.deleteContactGroup,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, contactGroupDeletePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/contact-group/:contact_group_id', {
    schema: editContactGroupSchema,
    handler: contactGroupController.updateContactGroup,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, contactGroupUpdatePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/contact-group-assignment', {
    schema: createContactGroupAssignmentSchema,
    handler: contactGroupController.createContactGroupAssignment,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, contactGroupCreatePermissions),
      planGuard,
      planStatus,
    ],
  });
}
