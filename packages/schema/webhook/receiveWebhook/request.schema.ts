import { Static, Type } from '@sinclair/typebox';

export const receiveWebhookParamsRequestSchema = Type.Object({
  keyapi: Type.String(),
});

export const receiveWebhookRequestSchema = Type.Any();

export type ReceiveWebhookParamsRequest = Static<
  typeof receiveWebhookParamsRequestSchema
>;
export type ReceiveWebhookRequest = Static<typeof receiveWebhookRequestSchema>;

export const webhookExpectedFieldsSchema = Type.Object({
  first_name: Type.Optional(Type.String()),
  last_name: Type.Optional(Type.String()),
  nickname: Type.Optional(Type.String()),
  birthday: Type.Optional(Type.String()),
  email: Type.Optional(Type.String()),
  phone_ddi: Type.Optional(Type.String()),
  phone: Type.Optional(Type.String()),
  document_type: Type.Optional(Type.String()),
  notes: Type.Optional(Type.String()),
  labels: Type.Optional(Type.Array(Type.String())),
  message: Type.Optional(Type.String()),
});

export type WebhookExpectedFields = Static<typeof webhookExpectedFieldsSchema>;
