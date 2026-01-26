import { Static, Type } from '@sinclair/typebox';

export const receiveWebhookResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export type ReceiveWebhookResponse = Static<
  typeof receiveWebhookResponseSchema
>;
