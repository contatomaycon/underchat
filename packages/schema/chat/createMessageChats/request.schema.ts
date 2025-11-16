import { EMessageType } from '@core/common/enums/EMessageType';
import { Static, Type } from '@sinclair/typebox';
import { viewLinkPreviewResponseSchema } from '../viewLinkPreview/response.schema';
import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';

export const createMessageChatsParamsSchema = Type.Object({
  chat_id: Type.String(),
});

export const createMessageChatsBodySchema = Type.Object({
  type: Type.Union([
    Type.String({ enum: Object.values(EMessageType) }),
    Type.Object({
      value: Type.String({ enum: Object.values(EMessageType) }),
    }),
  ]),
  message: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Object({
        value: Type.String(),
      }),
    ])
  ),
  message_quoted_id: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Null(),
      Type.Object({
        value: Type.String(),
      }),
    ])
  ),
  link_preview: Type.Optional(viewLinkPreviewResponseSchema),
  images: Type.Optional(
    Type.Union([
      uploadFileRequestSchema,
      Type.Array(uploadFileRequestSchema),
      Type.Null(),
    ])
  ),
  documents: Type.Optional(
    Type.Union([
      uploadFileRequestSchema,
      Type.Array(uploadFileRequestSchema),
      Type.Null(),
    ])
  ),
  videos: Type.Optional(
    Type.Union([
      uploadFileRequestSchema,
      Type.Array(uploadFileRequestSchema),
      Type.Null(),
    ])
  ),
  audios: Type.Optional(
    Type.Union([
      uploadFileRequestSchema,
      Type.Array(uploadFileRequestSchema),
      Type.Null(),
    ])
  ),
  video_duration: Type.Optional(
    Type.Union([
      Type.Number(),
      Type.String(),
      Type.Object({
        value: Type.String(),
      }),
    ])
  ),
  audio_duration: Type.Optional(
    Type.Union([
      Type.Number(),
      Type.String(),
      Type.Object({
        value: Type.String(),
      }),
    ])
  ),
  audio_view_once: Type.Optional(
    Type.Union([
      Type.Boolean(),
      Type.String(),
      Type.Object({
        value: Type.String(),
      }),
      Type.Null(),
    ])
  ),
  audio_ptt: Type.Optional(
    Type.Union([
      Type.Boolean(),
      Type.String(),
      Type.Object({
        value: Type.String(),
      }),
      Type.Null(),
    ])
  ),
  reaction_message_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  reaction_emoji: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  delete_message_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  contacts: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Array(Type.String()),
      Type.Null(),
      Type.Object({
        value: Type.Union([Type.String(), Type.Array(Type.String())]),
      }),
    ])
  ),
  location_latitude: Type.Optional(
    Type.Union([
      Type.Number(),
      Type.String(),
      Type.Object({
        value: Type.Union([Type.Number(), Type.String()]),
      }),
    ])
  ),
  location_longitude: Type.Optional(
    Type.Union([
      Type.Number(),
      Type.String(),
      Type.Object({
        value: Type.Union([Type.Number(), Type.String()]),
      }),
    ])
  ),
  location_name: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Null(),
      Type.Object({
        value: Type.String(),
      }),
    ])
  ),
  location_address: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Null(),
      Type.Object({
        value: Type.String(),
      }),
    ])
  ),
  poll_question: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Null(),
      Type.Object({
        value: Type.String(),
      }),
    ])
  ),
  poll_options: Type.Optional(
    Type.Union([
      Type.Array(Type.String()),
      Type.Null(),
      Type.Object({
        value: Type.Array(Type.String()),
      }),
    ])
  ),
  poll_allow_multiple: Type.Optional(
    Type.Union([
      Type.Boolean(),
      Type.String(),
      Type.Object({
        value: Type.String(),
      }),
      Type.Null(),
    ])
  ),
  hash: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Null(),
      Type.Object({
        value: Type.String(),
      }),
    ])
  ),
});

export type CreateMessageChatsParams = Static<
  typeof createMessageChatsParamsSchema
>;
export type CreateMessageChatsBody = Static<
  typeof createMessageChatsBodySchema
>;
