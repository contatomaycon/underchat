import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import {
  contactCreatePermissions,
  contactDeletePermissions,
  contactUpdatePermissions,
  contactViewPermissions,
} from '@/permissions';
import ContactController from '@/controllers/contact';
import { listContactSchema } from '@core/schema/contact/listContact';
import { createContactSchema } from '@core/schema/contact/createContact';
import { viewContactSchema } from '@core/schema/contact/viewContact';
import { viewContactPhoneSchema } from '@core/schema/contact/viewContactPhone';
import { viewContactEmailSchema } from '@core/schema/contact/viewContactEmail';
import { deleteContactSchema } from '@core/schema/contact/deleteContact';
import { editContactSchema } from '@core/schema/contact/editContact';
import { exportContactSchema } from '@core/schema/contact/exportContact';
import { validateContactSchema } from '@core/schema/contact/validateContact';
import { deleteContactPhotoSchema } from '@core/schema/contact/deletePhoto';
import { planGuard } from '@/plugins/planGuard';

export default async function contactRoutes(server: FastifyInstance) {
  const contactController = container.resolve(ContactController);

  server.get('/contact', {
    schema: listContactSchema,
    handler: contactController.listContact,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, contactViewPermissions),
      planGuard,
    ],
  });

  server.post('/contact', {
    schema: createContactSchema,
    handler: contactController.createContact,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, contactCreatePermissions),
      planGuard,
    ],
  });

  server.get('/contact/:contact_id', {
    schema: viewContactSchema,
    handler: contactController.viewContact,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, contactViewPermissions),
      planGuard,
    ],
  });

  server.get('/contact/:contact_id/phone', {
    schema: viewContactPhoneSchema,
    handler: contactController.viewContactPhone,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, contactViewPermissions),
      planGuard,
    ],
  });

  server.get('/contact/:contact_id/email', {
    schema: viewContactEmailSchema,
    handler: contactController.viewContactEmail,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, contactViewPermissions),
      planGuard,
    ],
  });

  server.delete('/contact/:contact_id', {
    schema: deleteContactSchema,
    handler: contactController.deleteContact,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, contactDeletePermissions),
      planGuard,
    ],
  });

  server.patch('/contact/:contact_id', {
    schema: editContactSchema,
    handler: contactController.editContact,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, contactUpdatePermissions),
      planGuard,
    ],
  });

  server.get('/contact/export', {
    schema: exportContactSchema,
    handler: contactController.exportContact,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, contactViewPermissions),
      planGuard,
    ],
  });

  server.post('/contact/:contact_id/validate', {
    schema: validateContactSchema,
    handler: contactController.validateContact,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, contactViewPermissions),
      planGuard,
    ],
  });

  server.delete('/contact/:contact_id/photo', {
    schema: deleteContactPhotoSchema,
    handler: contactController.deletePhoto,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, contactUpdatePermissions),
      planGuard,
    ],
  });
}
