import { EChatStatus } from '@core/common/enums/EChatStatus';
import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';

export const accountSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
});

export const summarySchema = Type.Object({
  last_message: Type.Union([Type.String(), Type.Null()]),
  last_date: Type.Union([Type.String(), Type.Null()]),
  unread_count: Type.Integer(),
});

export const workerSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
});

export const sectorSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  color: Type.Optional(Type.String()),
});

export const userSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  photo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const contactSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  phone: Type.String(),
  phone_ddi: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  photo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const labelSchema = Type.Object({
  label_template_id: Type.String(),
  label: Type.String(),
  color: Type.String(),
});

export const listChatsResultSchema = Type.Object({
  chat_id: Type.String(),
  summary: Type.Optional(Type.Union([summarySchema, Type.Null()])),
  account: accountSchema,
  worker: workerSchema,
  sector: Type.Optional(Type.Union([Type.Null(), sectorSchema])),
  user: Type.Optional(Type.Union([Type.Null(), userSchema])),
  contact: Type.Optional(Type.Union([contactSchema, Type.Null()])),
  photo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  name: Type.Union([Type.String(), Type.Null()]),
  phone: Type.String(),
  status: Type.String({ enum: Object.values(EChatStatus) }),
  date: Type.String(),
  started_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  closed_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  protocol_ura: Type.Optional(
    Type.Union([Type.Array(Type.String()), Type.Null()])
  ),
  protocol_start: Type.Optional(
    Type.Union([Type.Array(Type.String()), Type.Null()])
  ),
  protocol_transfer: Type.Optional(
    Type.Union([Type.Array(Type.String()), Type.Null()])
  ),
  label: Type.Optional(Type.Union([Type.Array(labelSchema), Type.Null()])),
});

export const listChatsResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listChatsResultSchema),
  counts: Type.Object({
    queue: Type.Number(),
    in_chat: Type.Number(),
    chatbot: Type.Number(),
    closed: Type.Number(),
    my_chats: Type.Number(),
  }),
});

export type ListChatsResult = Static<typeof listChatsResultSchema>;
export type ListChatsResponse = Static<typeof listChatsResponseSchema>;
