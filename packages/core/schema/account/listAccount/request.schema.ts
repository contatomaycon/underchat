import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { sortRequestSchema } from '@core/schema/common/sortRequestSchema';
import { Static, Type } from '@sinclair/typebox';

export const listAccountRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  sort_by: Type.Optional(Type.Array(sortRequestSchema)),
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  account_status: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  plan: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ListAccountRequest = Static<typeof listAccountRequestSchema>;
