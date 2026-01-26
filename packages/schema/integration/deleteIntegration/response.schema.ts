import { Static, Type } from '@sinclair/typebox';

export const deleteIntegrationResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export type DeleteIntegrationResponse = Static<
  typeof deleteIntegrationResponseSchema
>;
