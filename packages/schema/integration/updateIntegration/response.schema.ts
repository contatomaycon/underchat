import { Static, Type } from '@sinclair/typebox';

export const updateIntegrationResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export type UpdateIntegrationResponse = Static<
  typeof updateIntegrationResponseSchema
>;
