import { Static, Type } from '@sinclair/typebox';

export const ensureWhatsappOfficialWebhookSubscriptionParamsSchema =
  Type.Object({
    worker_id: Type.String(),
  });

export type EnsureWhatsappOfficialWebhookSubscriptionParams = Static<
  typeof ensureWhatsappOfficialWebhookSubscriptionParamsSchema
>;
