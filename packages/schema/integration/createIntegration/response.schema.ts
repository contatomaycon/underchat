import { Static, Type } from '@sinclair/typebox';

export const createIntegrationResponseSchema = Type.Object({
  api_key_id: Type.String({ format: 'uuid' }),
  key: Type.String(),
});

export type CreateIntegrationResponse = Static<
  typeof createIntegrationResponseSchema
>;
