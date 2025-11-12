import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import {
  contactGroupCreatePermissions,
  contactGroupDeletePermissions,
  contactGroupListPermissions,
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

export default async function contactGroupRoutes(server: FastifyInstance) {
  const contactGroupController = container.resolve(ContactGroupController);

  server.get('/contact-group', {
    schema: listContactGroupSchema,
    handler: contactGroupController.listContactGroup,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, contactGroupListPermissions),
    ],
  });

  server.get('/contact-group/all', {
    schema: listContactGroupAllSchema,
    handler: contactGroupController.listContactGroupAll,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, contactGroupListPermissions),
    ],
  });

  server.post('/contact-group', {
    schema: createContactGroupSchema,
    handler: contactGroupController.createContactGroup,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, contactGroupCreatePermissions),
    ],
  });

  server.get('/contact-group/:contact_group_id', {
    schema: viewContactGroupSchema,
    handler: contactGroupController.viewContactGroup,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, contactGroupViewPermissions),
    ],
  });

  server.delete('/contact-group/:contact_group_id', {
    schema: deleteContactGroupSchema,
    handler: contactGroupController.deleteContactGroup,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, contactGroupDeletePermissions),
    ],
  });

  server.patch('/contact-group/:contact_group_id', {
    schema: editContactGroupSchema,
    handler: contactGroupController.updateContactGroup,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, contactGroupUpdatePermissions),
    ],
  });
}
