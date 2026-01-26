import { Static, Type } from '@sinclair/typebox';

export const viewWebhookDataRequestSchema = Type.Object({
  api_key_id: Type.String({ format: 'uuid' }),
});

export type ViewWebhookDataRequest = Static<
  typeof viewWebhookDataRequestSchema
>;
