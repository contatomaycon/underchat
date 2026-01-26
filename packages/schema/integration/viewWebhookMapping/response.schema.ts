import { Static, Type } from '@sinclair/typebox';

export const viewWebhookMappingResponseSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
  mapping: Type.Record(Type.String(), Type.String()),
  created_at: Type.Optional(Type.String()),
  updated_at: Type.Optional(Type.String()),
});

export type ViewWebhookMappingResponse = Static<
  typeof viewWebhookMappingResponseSchema
>;
