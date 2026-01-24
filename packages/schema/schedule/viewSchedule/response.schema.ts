import { Static, Type } from '@sinclair/typebox';

const accountSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

const workerSchema = Type.Object({
  worker_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

const contactSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  phone_partial: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const contactGroupSchema = Type.Object({
  contact_group_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

export const viewScheduleResponseSchema = Type.Object({
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
  contacts: Type.Optional(Type.Array(contactSchema)),
  contact_groups: Type.Optional(Type.Array(contactGroupSchema)),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  updated_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ViewScheduleResponse = Static<typeof viewScheduleResponseSchema>;
