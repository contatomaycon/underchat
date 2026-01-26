import { Static, Type } from '@sinclair/typebox';

export const viewIntegrationByIdRequestSchema = Type.Object({
  api_key_id: Type.String({ format: 'uuid' }),
});

export type ViewIntegrationByIdRequest = Static<
  typeof viewIntegrationByIdRequestSchema
>;
