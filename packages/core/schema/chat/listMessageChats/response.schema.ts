import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { Static, Type } from '@sinclair/typebox';

export const userSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  photo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const summarySchema = Type.Object({
  is_sent: Type.Boolean(),
  is_delivered: Type.Boolean(),
  is_seen: Type.Boolean(),
});

export const listMessageResponseSchema = Type.Object({
  message_id: Type.String(),
  chat_id: Type.String(),
  quoted_message_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  type_user: Type.String({ enum: Object.values(ETypeUserChat) }),
  user: Type.Optional(Type.Union([userSchema, Type.Null()])),
  type: Type.String({ enum: Object.values(EMessageType) }),
  message: Type.Union([Type.String(), Type.Null()]),
  summary: Type.Optional(Type.Union([summarySchema, Type.Null()])),
  date: Type.String(),
});

export type ListMessageResponse = Static<typeof listMessageResponseSchema>;
