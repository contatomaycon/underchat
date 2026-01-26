import { Static, Type } from '@sinclair/typebox';

export const saveWebhookMappingRequestSchema = Type.Object({
  api_key_id: Type.String({ format: 'uuid' }),
  mapping: Type.Record(Type.String(), Type.String()),
});

export type SaveWebhookMappingRequest = Static<
  typeof saveWebhookMappingRequestSchema
>;
