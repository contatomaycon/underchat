import { EMessageType } from '@core/common/enums/EMessageType';
import { viewInternalChatLinkPreviewDataSchema } from '@core/schema/internalChat/viewLinkPreview/response.schema';
import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';
import { Static, Type } from '@sinclair/typebox';

export const createMessageParamsSchema = Type.Object({
  conversation_id: Type.String({ format: 'uuid' }),
});
export const createMessageQuerySchema = Type.Object({});

const multipartStringFieldSchema = Type.Object({
  value: Type.Union([Type.String(), Type.Null()]),
});
const messageTypeFieldSchema = Type.Union([
  Type.String({ enum: Object.values(EMessageType) }),
  Type.Object({
    value: Type.String({ enum: Object.values(EMessageType) }),
  }),
]);
const optionalStringFieldSchema = Type.Union([
  Type.String(),
  multipartStringFieldSchema,
  Type.Null(),
]);
const optionalNumberFieldSchema = Type.Union([
  Type.Number(),
  Type.String(),
  Type.Object({
    value: Type.Union([Type.Number(), Type.String(), Type.Null()]),
  }),
  Type.Null(),
]);
const contactsFieldSchema = Type.Union([
  Type.Array(Type.String()),
  Type.Array(Type.Object({ value: Type.String() })),
  Type.String(),
  Type.Object({
    value: Type.Union([Type.Array(Type.String()), Type.String(), Type.Null()]),
  }),
  Type.Null(),
]);

export const createMessageBodySchema = Type.Object({
  type: messageTypeFieldSchema,
  message: Type.Optional(optionalStringFieldSchema),
  message_quoted_id: Type.Optional(optionalStringFieldSchema),
  link_preview: Type.Optional(
    Type.Union([
      viewInternalChatLinkPreviewDataSchema,
      Type.String(),
      multipartStringFieldSchema,
      Type.Null(),
    ])
  ),
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
  video_duration: Type.Optional(optionalNumberFieldSchema),
  audios: Type.Optional(
    Type.Union([
      uploadFileRequestSchema,
      Type.Array(uploadFileRequestSchema),
      Type.Null(),
    ])
  ),
  audio_duration: Type.Optional(optionalNumberFieldSchema),
  audio_view_once: Type.Optional(
    Type.Union([
      Type.Boolean(),
      Type.String(),
      Type.Object({
        value: Type.Union([Type.Boolean(), Type.String(), Type.Null()]),
      }),
      Type.Null(),
    ])
  ),
  audio_ptt: Type.Optional(
    Type.Union([
      Type.Boolean(),
      Type.String(),
      Type.Object({
        value: Type.Union([Type.Boolean(), Type.String(), Type.Null()]),
      }),
      Type.Null(),
    ])
  ),
  contacts: Type.Optional(contactsFieldSchema),
  location_latitude: Type.Optional(optionalNumberFieldSchema),
  location_longitude: Type.Optional(optionalNumberFieldSchema),
  location_name: Type.Optional(optionalStringFieldSchema),
  location_address: Type.Optional(optionalStringFieldSchema),
  hash: Type.Optional(optionalStringFieldSchema),
});

export type CreateMessageParams = Static<typeof createMessageParamsSchema>;
export type CreateMessageBody = Static<typeof createMessageBodySchema>;
