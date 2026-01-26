import { Static, Type } from '@sinclair/typebox';

export const viewWebhookMappingRequestSchema = Type.Object({
  api_key_id: Type.String({ format: 'uuid' }),
});

export type ViewWebhookMappingRequest = Static<
  typeof viewWebhookMappingRequestSchema
>;
