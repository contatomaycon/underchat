import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { Static, Type } from '@sinclair/typebox';
import { viewLinkPreviewResponseSchema } from '../viewLinkPreview/response.schema';

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

export const quotedMessageSchema = Type.Object({
  key: Type.Object({
    remote_jid: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    from_me: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
    id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    participant: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  }),
  message: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const contentSchema = Type.Object({
  type: Type.String({ enum: Object.values(EMessageType) }),
  message: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  message_quoted_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  link_preview: Type.Optional(
    Type.Union([viewLinkPreviewResponseSchema, Type.Null()])
  ),
  quoted: Type.Optional(Type.Union([quotedMessageSchema, Type.Null()])),
});

export const listMessageResponseSchema = Type.Object({
  message_id: Type.String(),
  chat_id: Type.String(),
  type_user: Type.String({ enum: Object.values(ETypeUserChat) }),
  user: Type.Optional(Type.Union([userSchema, Type.Null()])),
  content: Type.Optional(Type.Union([contentSchema, Type.Null()])),
  summary: Type.Optional(Type.Union([summarySchema, Type.Null()])),
  date: Type.String(),
});

export type ListMessageResponse = Static<typeof listMessageResponseSchema>;
export type LinkPreview = Static<typeof viewLinkPreviewResponseSchema>;
export type ContentMessageChat = Static<typeof contentSchema>;
