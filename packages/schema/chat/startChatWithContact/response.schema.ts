import { EChatStatus } from '@core/common/enums/EChatStatus';
import { Static, Type } from '@sinclair/typebox';

export const accountSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
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
  entered_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const contactSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  phone: Type.String(),
  phone_ddi: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  photo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const startChatWithContactResultSchema = Type.Object({
  chat_id: Type.String(),
  account: accountSchema,
  worker: workerSchema,
  sector: Type.Optional(Type.Union([Type.Null(), sectorSchema])),
  user: Type.Optional(Type.Union([Type.Null(), userSchema])),
  secondary_users: Type.Optional(
    Type.Union([Type.Array(userSchema), Type.Null()])
  ),
  contact: Type.Optional(Type.Union([contactSchema, Type.Null()])),
  photo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  name: Type.Union([Type.String(), Type.Null()]),
  phone: Type.String(),
  status: Type.String({ enum: Object.values(EChatStatus) }),
  date: Type.String(),
  started_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  closed_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type StartChatWithContactResult = Static<
  typeof startChatWithContactResultSchema
>;
