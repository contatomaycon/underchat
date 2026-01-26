import { Static, Type } from '@sinclair/typebox';

export const generateIntegrationKeyRequestSchema = Type.Object({
  api_key_id: Type.String({ format: 'uuid' }),
});

export type GenerateIntegrationKeyRequest = Static<
  typeof generateIntegrationKeyRequestSchema
>;
