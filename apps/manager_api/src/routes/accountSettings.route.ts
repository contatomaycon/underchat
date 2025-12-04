import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import AccountSettingsController from '@/controllers/accountSettings';
import { updatePhotoSchema } from '@core/schema/accountSettings/updatePhoto';
import { updateAdditionalInfoSchema } from '@core/schema/accountSettings/updateAdditionalInfo';
import { updateAddressSchema } from '@core/schema/accountSettings/updateAddress';
import { viewPhoneSchema } from '@core/schema/accountSettings/viewPhone';
import { viewDocumentSchema } from '@core/schema/accountSettings/viewDocument';
import { viewAddressSchema } from '@core/schema/accountSettings/viewAddress';
import { viewAddress1Schema } from '@core/schema/accountSettings/viewAddress1';
import { viewAddress2Schema } from '@core/schema/accountSettings/viewAddress2';
import { viewAdditionalInfoSchema } from '@core/schema/accountSettings/viewAdditionalInfo';

export default async function accountSettingsRoutes(server: FastifyInstance) {
  const accountSettingsController = container.resolve(
    AccountSettingsController
  );

  server.patch('/account-settings/photo', {
    schema: updatePhotoSchema,
    handler: accountSettingsController.updatePhoto,
    preHandler: [(request, reply) => server.authenticateJwt(request, reply)],
  });

  server.patch('/account-settings/additional-info', {
    schema: updateAdditionalInfoSchema,
    handler: accountSettingsController.updateAdditionalInfo,
    preHandler: [(request, reply) => server.authenticateJwt(request, reply)],
  });

  server.patch('/account-settings/address', {
    schema: updateAddressSchema,
    handler: accountSettingsController.updateAddress,
    preHandler: [(request, reply) => server.authenticateJwt(request, reply)],
  });

  server.get('/account-settings/phone', {
    schema: viewPhoneSchema,
    handler: accountSettingsController.viewPhone,
    preHandler: [(request, reply) => server.authenticateJwt(request, reply)],
  });

  server.get('/account-settings/document', {
    schema: viewDocumentSchema,
    handler: accountSettingsController.viewDocument,
    preHandler: [(request, reply) => server.authenticateJwt(request, reply)],
  });

  server.get('/account-settings/address', {
    schema: viewAddressSchema,
    handler: accountSettingsController.viewAddress,
    preHandler: [(request, reply) => server.authenticateJwt(request, reply)],
  });

  server.get('/account-settings/address1', {
    schema: viewAddress1Schema,
    handler: accountSettingsController.viewAddress1,
    preHandler: [(request, reply) => server.authenticateJwt(request, reply)],
  });

  server.get('/account-settings/address2', {
    schema: viewAddress2Schema,
    handler: accountSettingsController.viewAddress2,
    preHandler: [(request, reply) => server.authenticateJwt(request, reply)],
  });

  server.get('/account-settings/additional-info', {
    schema: viewAdditionalInfoSchema,
    handler: accountSettingsController.viewAdditionalInfo,
    preHandler: [(request, reply) => server.authenticateJwt(request, reply)],
  });
}
