import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import AccountSettingsController from '@/controllers/accountSettings';
import { updatePhotoSchema } from '@core/schema/accountSettings/updatePhoto';
import { deletePhotoSchema } from '@core/schema/accountSettings/deletePhoto';
import { updateAdditionalInfoSchema } from '@core/schema/accountSettings/updateAdditionalInfo';
import { updateAddressSchema } from '@core/schema/accountSettings/updateAddress';
import { viewPhoneSchema } from '@core/schema/accountSettings/viewPhone';
import { viewDocumentSchema } from '@core/schema/accountSettings/viewDocument';
import { viewAddressSchema } from '@core/schema/accountSettings/viewAddress';
import { viewAddress1Schema } from '@core/schema/accountSettings/viewAddress1';
import { viewAddress2Schema } from '@core/schema/accountSettings/viewAddress2';
import { viewAdditionalInfoSchema } from '@core/schema/accountSettings/viewAdditionalInfo';
import { changePasswordSchema } from '@core/schema/accountSettings/changePassword';
import { viewCurrentPlanInvoiceSchema } from '@core/schema/accountSettings/viewCurrentPlanInvoice';
import { listAccountPaymentsSchema } from '@core/schema/accountSettings/listAccountPayments';
import { listUserCardsSchema } from '@core/schema/plan/listUserCards';
import { deleteUserCardSchema } from '@core/schema/accountSettings/deleteUserCard';
import { updatePlanRecurringSchema } from '@core/schema/accountSettings/updatePlanRecurring';
import { listAccountAddonsSchema } from '@core/schema/accountSettings/listAccountAddons';
import { listAccountPlanProductsSchema } from '@core/schema/accountSettings/listAccountPlanProducts';
import { updateUserCardDefaultSchema } from '@core/schema/accountSettings/updateUserCardDefault';
import { createUserCardSchema } from '@core/schema/accountSettings/createUserCard';
import { viewAccountPaymentNfseSchema } from '@core/schema/accountSettings/viewAccountPaymentNfse';
import { cancelPlanAccountSchema } from '@core/schema/accountSettings/cancelPlanAccount';
import { reactivatePlanAccountSchema } from '@core/schema/accountSettings/reactivatePlanAccount';
import { planInvoicePermissions } from '@/permissions';

export default async function accountSettingsRoutes(server: FastifyInstance) {
  const accountSettingsController = container.resolve(
    AccountSettingsController
  );

  server.patch('/account-settings/photo', {
    schema: updatePhotoSchema,
    handler: accountSettingsController.updatePhoto,
    preHandler: [(request, reply) => server.authenticateJwt(request, reply)],
  });

  server.delete('/account-settings/photo', {
    schema: deletePhotoSchema,
    handler: accountSettingsController.deletePhoto,
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

  server.patch('/account-settings/password', {
    schema: changePasswordSchema,
    handler: accountSettingsController.changePassword,
    preHandler: [(request, reply) => server.authenticateJwt(request, reply)],
  });

  server.get('/account-settings/current-plan-invoice', {
    schema: viewCurrentPlanInvoiceSchema,
    handler: accountSettingsController.viewCurrentPlanInvoice,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planInvoicePermissions),
    ],
  });

  server.get('/account-settings/payments', {
    schema: listAccountPaymentsSchema,
    handler: accountSettingsController.listAccountPayments,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planInvoicePermissions),
    ],
  });

  server.get('/account-settings/cards', {
    schema: listUserCardsSchema,
    handler: accountSettingsController.listUserCards,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planInvoicePermissions),
    ],
  });

  server.post('/account-settings/cards', {
    schema: createUserCardSchema,
    handler: accountSettingsController.createUserCard,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planInvoicePermissions),
    ],
  });

  server.delete('/account-settings/cards/:user_card_id', {
    schema: deleteUserCardSchema,
    handler: accountSettingsController.deleteUserCard,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planInvoicePermissions),
    ],
  });

  server.patch('/account-settings/plan/recurring', {
    schema: updatePlanRecurringSchema,
    handler: accountSettingsController.updatePlanRecurring,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planInvoicePermissions),
    ],
  });

  server.get('/account-settings/addons', {
    schema: listAccountAddonsSchema,
    handler: accountSettingsController.listAccountAddons,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planInvoicePermissions),
    ],
  });

  server.get('/account-settings/plan-products', {
    schema: listAccountPlanProductsSchema,
    handler: accountSettingsController.listAccountPlanProducts,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planInvoicePermissions),
    ],
  });

  server.patch('/account-settings/cards/default', {
    schema: updateUserCardDefaultSchema,
    handler: accountSettingsController.updateUserCardDefault,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planInvoicePermissions),
    ],
  });

  server.get('/account-settings/payments/:account_payment_id/nfse', {
    schema: viewAccountPaymentNfseSchema,
    handler: accountSettingsController.viewAccountPaymentNfse,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planInvoicePermissions),
    ],
  });

  server.post('/account-settings/plan/cancel', {
    schema: cancelPlanAccountSchema,
    handler: accountSettingsController.cancelPlanAccount,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planInvoicePermissions),
    ],
  });

  server.post('/account-settings/plan/reactivate', {
    schema: reactivatePlanAccountSchema,
    handler: accountSettingsController.reactivatePlanAccount,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planInvoicePermissions),
    ],
  });
}
