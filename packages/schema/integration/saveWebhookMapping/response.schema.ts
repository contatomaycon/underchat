import { Static, Type } from '@sinclair/typebox';

export const saveWebhookMappingResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export type SaveWebhookMappingResponse = Static<
  typeof saveWebhookMappingResponseSchema
>;
