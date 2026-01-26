import { Static, Type } from '@sinclair/typebox';

export const updateIntegrationRequestSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  worker_id: Type.String({ format: 'uuid' }),
});

export type UpdateIntegrationRequest = Static<
  typeof updateIntegrationRequestSchema
>;
