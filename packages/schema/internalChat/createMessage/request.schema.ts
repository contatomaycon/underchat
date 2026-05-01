import { EMessageType } from '@core/common/enums/EMessageType';
import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';
import { Static, Type } from '@sinclair/typebox';

export const createMessageParamsSchema = Type.Object({
  conversation_id: Type.String({ format: 'uuid' }),
});
export const createMessageQuerySchema = Type.Object({});
export const createMessageBodySchema = Type.Object({
  type: Type.String({ enum: Object.values(EMessageType) }),
  message: Type.Optional(Type.String()),
  message_quoted_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
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
  contacts: Type.Optional(
    Type.Union([Type.Array(Type.String()), Type.String(), Type.Null()])
  ),
  location_latitude: Type.Optional(Type.Union([Type.Number(), Type.String()])),
  location_longitude: Type.Optional(Type.Union([Type.Number(), Type.String()])),
  location_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  location_address: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  hash: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type CreateMessageParams = Static<typeof createMessageParamsSchema>;
export type CreateMessageBody = Static<typeof createMessageBodySchema>;
