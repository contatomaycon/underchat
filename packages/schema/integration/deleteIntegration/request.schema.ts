import { Static, Type } from '@sinclair/typebox';

export const deleteIntegrationRequestSchema = Type.Object({
  api_key_id: Type.String({ format: 'uuid' }),
});

export type DeleteIntegrationRequest = Static<
  typeof deleteIntegrationRequestSchema
>;
