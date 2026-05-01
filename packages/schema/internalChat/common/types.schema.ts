import { Static, Type } from '@sinclair/typebox';
import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EInternalChatConversationType } from '@core/common/enums/internalChat/EInternalChatConversationType';
import { EInternalChatConversationParticipantRole } from '@core/common/enums/internalChat/EInternalChatConversationParticipantRole';
import { EInternalChatActivityState } from '@core/common/enums/internalChat/EInternalChatActivityState';

export const internalChatUserSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  photo: Type.Union([Type.String(), Type.Null()]),
  email: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  sector: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  position: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const internalChatParticipantSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  photo: Type.Union([Type.String(), Type.Null()]),
  email: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  sector: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  position: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  role: Type.String({
    enum: Object.values(EInternalChatConversationParticipantRole),
  }),
  unread_count: Type.Number(),
  closed_at: Type.Union([Type.String(), Type.Null()]),
});

export const internalChatConversationSchema = Type.Object({
  conversation_id: Type.String({ format: 'uuid' }),
  account_id: Type.String({ format: 'uuid' }),
  type: Type.String({ enum: Object.values(EInternalChatConversationType) }),
  name: Type.Union([Type.String(), Type.Null()]),
  photo: Type.Union([Type.String(), Type.Null()]),
  leader_user_id: Type.Union([Type.String(), Type.Null()]),
  last_message_id: Type.Union([Type.String(), Type.Null()]),
  last_message_preview: Type.Union([Type.String(), Type.Null()]),
  last_message_at: Type.Union([Type.String(), Type.Null()]),
  unread_count: Type.Number(),
  is_closed_for_me: Type.Boolean(),
  participants: Type.Array(internalChatParticipantSchema),
  created_at: Type.String(),
  updated_at: Type.String(),
});

export const internalChatMessageContentSchema = Type.Object(
  {
    type: Type.String({ enum: Object.values(EMessageType) }),
    message: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    message_quoted_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    quoted: Type.Optional(Type.Any()),
    image: Type.Optional(Type.Any()),
    video: Type.Optional(Type.Any()),
    audio: Type.Optional(Type.Any()),
    document: Type.Optional(Type.Any()),
    location: Type.Optional(Type.Any()),
    contact: Type.Optional(Type.Any()),
    contacts: Type.Optional(Type.Array(Type.Any())),
    reactions: Type.Optional(
      Type.Array(
        Type.Object({
          emoji: Type.String(),
          user_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          user_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        })
      )
    ),
    version: Type.Optional(Type.Array(Type.Any())),
  },
  { additionalProperties: true }
);

export const internalChatMessageSchema = Type.Object({
  message_id: Type.String(),
  conversation_id: Type.String({ format: 'uuid' }),
  account_id: Type.String({ format: 'uuid' }),
  type_user: Type.String({ enum: Object.values(ETypeUserChat) }),
  user: Type.Union([
    Type.Object({
      id: Type.String({ format: 'uuid' }),
      name: Type.String(),
      photo: Type.Union([Type.String(), Type.Null()]),
    }),
    Type.Null(),
  ]),
  content: internalChatMessageContentSchema,
  date: Type.String(),
  deleted: Type.Optional(Type.Boolean()),
  hash: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const internalChatConversationListResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(internalChatConversationSchema),
});

export const internalChatUserListResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(internalChatUserSchema),
});

export const internalChatMessageListResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(internalChatMessageSchema),
});

export const internalChatActivityStateSchema = Type.String({
  enum: Object.values(EInternalChatActivityState),
});

export type InternalChatConversationResponse = Static<
  typeof internalChatConversationSchema
>;
export type InternalChatMessageResponse = Static<
  typeof internalChatMessageSchema
>;
