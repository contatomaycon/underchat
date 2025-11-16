import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { Static, Type } from '@sinclair/typebox';
import { viewLinkPreviewResponseSchema } from '../viewLinkPreview/response.schema';
import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';

export const userSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  photo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const summarySchema = Type.Object({
  is_sent: Type.Boolean(),
  is_delivered: Type.Boolean(),
  is_seen: Type.Boolean(),
  is_sent_to_internal: Type.Boolean(),
});

export const messageKeySchema = Type.Object({
  remote_jid: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  remote_jid_alt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  from_me: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  participant: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  participant_alt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  addressing_mode: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  is_view_once: Type.Optional(Type.Boolean()),
});

export const imageSchema = Type.Object({
  url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  caption: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  mimetype: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  extension: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  size: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  height: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  width: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  thumbnail: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const videoSchema = Type.Object({
  url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  caption: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  mimetype: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  extension: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  size: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  duration: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  height: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  width: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  thumbnail: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const audioSchema = Type.Object({
  url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  mimetype: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  extension: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  size: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  duration: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  ptt: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  view_once: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  waveform: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const documentSchema = Type.Object({
  url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  mimetype: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  extension: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  size: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
});

export const contactSchema = Type.Object({
  contact_id: Type.String(),
  name: Type.String(),
  last_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  phone: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  phone_ddi: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  email: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  email_partial: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const quotedMessageSchema = Type.Object({
  key: messageKeySchema,
  message: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  type: Type.Optional(Type.String({ enum: Object.values(EMessageType) })),
  image: Type.Optional(Type.Union([imageSchema, Type.Null()])),
  video: Type.Optional(Type.Union([videoSchema, Type.Null()])),
  audio: Type.Optional(Type.Union([audioSchema, Type.Null()])),
  document: Type.Optional(Type.Union([documentSchema, Type.Null()])),
  contact: Type.Optional(Type.Union([contactSchema, Type.Null()])),
});

export const reactionSchema = Type.Object({
  emoji: Type.String(),
  user_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  user_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const contentSchema = Type.Object({
  type: Type.String({ enum: Object.values(EMessageType) }),
  message: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  message_quoted_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  link_preview: Type.Optional(
    Type.Union([viewLinkPreviewResponseSchema, Type.Null()])
  ),
  quoted: Type.Optional(Type.Union([quotedMessageSchema, Type.Null()])),
  image: Type.Optional(Type.Union([imageSchema, Type.Null()])),
  video: Type.Optional(Type.Union([videoSchema, Type.Null()])),
  contact: Type.Optional(Type.Union([contactSchema, Type.Null()])),
  audio: Type.Optional(Type.Union([audioSchema, Type.Null()])),
  document: Type.Optional(Type.Union([documentSchema, Type.Null()])),
  reactions: Type.Optional(
    Type.Union([Type.Array(reactionSchema), Type.Null()])
  ),
});

export const listMessageResultSchema = Type.Object({
  message_id: Type.String(),
  chat_id: Type.String(),
  message_key: Type.Optional(Type.Union([messageKeySchema, Type.Null()])),
  type_user: Type.String({ enum: Object.values(ETypeUserChat) }),
  user: Type.Optional(Type.Union([userSchema, Type.Null()])),
  content: Type.Optional(Type.Union([contentSchema, Type.Null()])),
  summary: Type.Optional(Type.Union([summarySchema, Type.Null()])),
  date: Type.String(),
  deleted: Type.Optional(Type.Boolean()),
  has_quoted: Type.Optional(Type.Boolean()),
  hash: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const listMessageResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listMessageResultSchema),
});

export type ListMessageResult = Static<typeof listMessageResultSchema>;
export type LinkPreview = Static<typeof viewLinkPreviewResponseSchema>;
export type ContentMessageChat = Static<typeof contentSchema>;
export type ImageMessageChat = Static<typeof imageSchema>;
export type VideoMessageChat = Static<typeof videoSchema>;
export type AudioMessageChat = Static<typeof audioSchema>;
export type DocumentMessageChat = Static<typeof documentSchema>;
export type ListMessageResponse = Static<typeof listMessageResponseSchema>;
