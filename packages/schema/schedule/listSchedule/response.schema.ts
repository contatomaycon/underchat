import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';

const accountSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

const workerSchema = Type.Object({
  worker_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

export const listScheduleResponseSchema = Type.Object({
  schedule_id: Type.String({ format: 'uuid' }),
  account: accountSchema,
  worker: workerSchema,
  type: Type.String(),
  send_to: Type.String(),
  send_speed: Type.String(),
  message: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  mimetype: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  duration: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  width: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  height: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  send_date: Type.String(),
  status: Type.String(),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const listScheduleFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listScheduleResponseSchema),
});

export type ListScheduleResponse = Static<typeof listScheduleResponseSchema>;
export type ListScheduleFinalResponse = Static<
  typeof listScheduleFinalResponseSchema
>;
