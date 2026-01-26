import { Static, Type } from '@sinclair/typebox';

export const receiveWebhookParamsRequestSchema = Type.Object({
  keyapi: Type.String(),
});

export const receiveWebhookRequestSchema = Type.Any();

export type ReceiveWebhookParamsRequest = Static<
  typeof receiveWebhookParamsRequestSchema
>;
export type ReceiveWebhookRequest = Static<typeof receiveWebhookRequestSchema>;
