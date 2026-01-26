import { Static, Type } from '@sinclair/typebox';

export const viewIntegrationResponseSchema = Type.Object({
  api_key_id: Type.String({ format: 'uuid' }),
  key: Type.String(),
  name: Type.String(),
  status: Type.String(),
});

export type ViewIntegrationResponse = Static<
  typeof viewIntegrationResponseSchema
>;
