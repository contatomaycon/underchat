import { Static, Type } from '@sinclair/typebox';

export const listScheduleWorkersResponseSchema = Type.Object({
  worker_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  number: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  type_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  is_official: Type.Optional(Type.Boolean()),
});

export const listScheduleWorkersFinalResponseSchema = Type.Array(
  listScheduleWorkersResponseSchema
);

export type ListScheduleWorkersResponse = Static<
  typeof listScheduleWorkersResponseSchema
>;
export type ListScheduleWorkersFinalResponse = Static<
  typeof listScheduleWorkersFinalResponseSchema
>;
