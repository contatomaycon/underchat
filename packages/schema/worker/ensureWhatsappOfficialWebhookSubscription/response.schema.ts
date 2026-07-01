import { Static, Type } from '@sinclair/typebox';

export const ensureWhatsappOfficialWebhookSubscriptionResponseSchema =
  Type.Object({
    worker_id: Type.String(),
    account_id: Type.String(),
    waba_id: Type.String(),
    phone_number_id: Type.String(),
    subscribed: Type.Boolean(),
  });

export type EnsureWhatsappOfficialWebhookSubscriptionResponse = Static<
  typeof ensureWhatsappOfficialWebhookSubscriptionResponseSchema
>;
