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
  message_quoted_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  link_preview: Type.Optional(viewLinkPreviewResponseSchema),
  images: Type.Optional(
    Type.Union([
      uploadFileRequestSchema,
      Type.Array(uploadFileRequestSchema),
      Type.Null(),
    ])
  ),
});

export type CreateMessageChatsParams = Static<
  typeof createMessageChatsParamsSchema
>;
export type CreateMessageChatsBody = Static<
  typeof createMessageChatsBodySchema
>;
