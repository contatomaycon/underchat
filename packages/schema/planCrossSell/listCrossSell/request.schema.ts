import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { sortRequestSchema } from '@core/schema/common/sortRequestSchema';
import { Static, Type } from '@sinclair/typebox';

export const listCrossSellRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  sort_by: Type.Optional(Type.Array(sortRequestSchema)),
  product_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  price: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ListCrossSellRequest = Static<typeof listCrossSellRequestSchema>;
