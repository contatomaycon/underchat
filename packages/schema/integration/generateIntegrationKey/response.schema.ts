import { Static, Type } from '@sinclair/typebox';

export const generateIntegrationKeyResponseSchema = Type.Object({
  key: Type.String(),
});

export type GenerateIntegrationKeyResponse = Static<
  typeof generateIntegrationKeyResponseSchema
>;
