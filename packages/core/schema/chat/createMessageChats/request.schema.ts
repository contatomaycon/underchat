import { EMessageType } from '@core/common/enums/EMessageType';
import { Static, Type } from '@sinclair/typebox';
import { viewLinkPreviewResponseSchema } from '../viewLinkPreview/response.schema';

export const createMessageChatsParamsSchema = Type.Object({
  chat_id: Type.String(),
});

export const createMessageChatsBodySchema = Type.Object({
  type: Type.String({ enum: Object.values(EMessageType) }),
  message: Type.Optional(Type.String()),
  message_quoted_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  link_preview: Type.Optional(viewLinkPreviewResponseSchema),
});

export type CreateMessageChatsParams = Static<
  typeof createMessageChatsParamsSchema
>;
export type CreateMessageChatsBody = Static<
  typeof createMessageChatsBodySchema
>;
