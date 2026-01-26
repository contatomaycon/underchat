import { Static, Type } from '@sinclair/typebox';

export const updateIntegrationStatusResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export type UpdateIntegrationStatusResponse = Static<
  typeof updateIntegrationStatusResponseSchema
>;
