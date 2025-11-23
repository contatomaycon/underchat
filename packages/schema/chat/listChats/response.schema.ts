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
});

export const listChatsResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listChatsResultSchema),
});

export type ListChatsResult = Static<typeof listChatsResultSchema>;
export type ListChatsResponse = Static<typeof listChatsResponseSchema>;
