import { Static, Type } from '@sinclair/typebox';

export const viewWebhookMappingResponseSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
  worker_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  mapping: Type.Record(
    Type.String(),
    Type.Union([Type.String(), Type.Array(Type.String())])
  ),
  created_at: Type.Optional(Type.String()),
  updated_at: Type.Optional(Type.String()),
});

export type ViewWebhookMappingResponse = Static<
  typeof viewWebhookMappingResponseSchema
>;
