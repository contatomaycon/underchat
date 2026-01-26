import { Static, Type } from '@sinclair/typebox';

export const createIntegrationRequestSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  worker_id: Type.String({ format: 'uuid' }),
});

export type CreateIntegrationRequest = Static<
  typeof createIntegrationRequestSchema
>;
