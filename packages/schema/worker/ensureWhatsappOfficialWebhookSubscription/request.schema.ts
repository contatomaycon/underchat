import { Static, Type } from '@sinclair/typebox';

export const ensureWhatsappOfficialWebhookSubscriptionRequestSchema =
  Type.Object({
    code: Type.String({ minLength: 1 }),
    business_id: Type.Optional(Type.String({ minLength: 1 })),
    waba_id: Type.String({ minLength: 1 }),
    phone_number_id: Type.Optional(Type.String({ minLength: 1 })),
  });

export type EnsureWhatsappOfficialWebhookSubscriptionRequest = Static<
  typeof ensureWhatsappOfficialWebhookSubscriptionRequestSchema
>;
