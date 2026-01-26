import { Static, Type } from '@sinclair/typebox';

export const viewIntegrationByIdResponseSchema = Type.Object({
  api_key_id: Type.String({ format: 'uuid' }),
  key: Type.String(),
  name: Type.String(),
  status: Type.String(),
  worker_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  worker_name: Type.Union([Type.String(), Type.Null()]),
});

export type ViewIntegrationByIdResponse = Static<
  typeof viewIntegrationByIdResponseSchema
>;
