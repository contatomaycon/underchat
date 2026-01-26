import { Static, Type } from '@sinclair/typebox';

export const saveWebhookMappingRequestSchema = Type.Object({
  mapping: Type.Record(Type.String(), Type.String()),
});

export type SaveWebhookMappingRequest = Static<
  typeof saveWebhookMappingRequestSchema
>;
