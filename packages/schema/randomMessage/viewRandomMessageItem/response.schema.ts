import { ERandomMessageStatus } from '@core/common/enums/ERandomMessageStatus';
import { Static, Type } from '@sinclair/typebox';

export const viewRandomMessageItemResponseSchema = Type.Object({
  random_message_item_id: Type.String({ format: 'uuid' }),
  random_message_id: Type.String({ format: 'uuid' }),
  message: Type.String(),
  status: Type.Union([
    Type.Literal(ERandomMessageStatus.active),
    Type.Literal(ERandomMessageStatus.inactive),
  ]),
  type: Type.String(),
  attachment_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  mimetype: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  duration: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  width: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  height: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  updated_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ViewRandomMessageItemResponse = Static<
  typeof viewRandomMessageItemResponseSchema
>;
