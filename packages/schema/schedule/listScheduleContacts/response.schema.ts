import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';

export const listScheduleContactsResponseSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  last_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  phone_partial: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const listScheduleContactsFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listScheduleContactsResponseSchema),
});

export type ListScheduleContactsResponse = Static<
  typeof listScheduleContactsResponseSchema
>;
export type ListScheduleContactsFinalResponse = Static<
  typeof listScheduleContactsFinalResponseSchema
>;
