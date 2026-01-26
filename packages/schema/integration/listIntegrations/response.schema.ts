import { Static, Type } from '@sinclair/typebox';
import { pagingSchema } from '@core/schema/common/pagingResponseSchema';

export const listIntegrationsItemSchema = Type.Object({
  api_key_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  status: Type.String(),
  worker_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  worker_name: Type.Union([Type.String(), Type.Null()]),
});

export const listIntegrationsResponseSchema = Type.Object({
  results: Type.Array(listIntegrationsItemSchema),
  pagings: pagingSchema,
});

export type ListIntegrationsItem = Static<typeof listIntegrationsItemSchema>;
export type ListIntegrationsResponse = Static<
  typeof listIntegrationsResponseSchema
>;
