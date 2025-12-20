import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';

const scheduleMessageContactSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  phone: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  phone_ddi: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const scheduleMessageAccountSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

const scheduleMessageWorkerSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

export const scheduleMessageResultSchema = Type.Object({
  id: Type.String(),
  schedule_id: Type.String({ format: 'uuid' }),
  contact: Type.Optional(
    Type.Union([scheduleMessageContactSchema, Type.Null()])
  ),
  account: Type.Optional(
    Type.Union([scheduleMessageAccountSchema, Type.Null()])
  ),
  worker: Type.Optional(Type.Union([scheduleMessageWorkerSchema, Type.Null()])),
  type: Type.String(),
  message: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.String(),
  send_date: Type.String(),
});

export const listScheduleMessagesFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(scheduleMessageResultSchema),
});

export type ScheduleMessageResult = Static<typeof scheduleMessageResultSchema>;
export type ListScheduleMessagesResponse = Static<
  typeof listScheduleMessagesFinalResponseSchema
>;
