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

export const linkPreviewSchema = Type.Object({
  'canonical-url': Type.Optional(Type.Union([Type.String(), Type.Null()])),
  'matched-text': Type.Optional(Type.Union([Type.String(), Type.Null()])),
  title: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  jpegThumbnail: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  highQualityThumbnail: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  originalThumbnailUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const contentSchema = Type.Object({
  type: Type.String({ enum: Object.values(EMessageType) }),
  message: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  link_preview: Type.Optional(Type.Union([linkPreviewSchema, Type.Null()])),
});

export const listMessageResponseSchema = Type.Object({
  message_id: Type.String(),
  chat_id: Type.String(),
  quoted_message_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  type_user: Type.String({ enum: Object.values(ETypeUserChat) }),
  user: Type.Optional(Type.Union([userSchema, Type.Null()])),
  content: Type.Optional(Type.Union([contentSchema, Type.Null()])),
  summary: Type.Optional(Type.Union([summarySchema, Type.Null()])),
  date: Type.String(),
});

export type ListMessageResponse = Static<typeof listMessageResponseSchema>;
export type LinkPreview = Static<typeof linkPreviewSchema>;
