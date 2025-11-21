import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { sortRequestSchema } from '@core/schema/common/sortRequestSchema';
import { Static, Type } from '@sinclair/typebox';

export const listSectorRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  sort_by: Type.Optional(Type.Array(sortRequestSchema)),
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  account: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  sector_status: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  color: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ListSectorRequest = Static<typeof listSectorRequestSchema>;
