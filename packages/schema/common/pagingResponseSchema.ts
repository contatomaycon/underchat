import { Static, Type } from '@fastify/type-provider-typebox';

export const pagingSchema = Type.Object({
  current_page: Type.Number(),
  total_pages: Type.Number(),
  per_page: Type.Number(),
  count: Type.Number(),
  total: Type.Number(),
});

export const pagingResponseSchema = Type.Object(
  {
    pagings: pagingSchema,
  },
  { additionalProperties: false }
);

export type PagingResponseSchema = Static<typeof pagingSchema>;
