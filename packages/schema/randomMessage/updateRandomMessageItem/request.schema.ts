import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';
import { ERandomMessageStatus } from '@core/common/enums/ERandomMessageStatus';
import { Static, Type } from '@sinclair/typebox';

export const updateRandomMessageItemParamsRequestSchema = Type.Object({
  random_message_id: Type.String({ format: 'uuid' }),
  random_message_item_id: Type.String({ format: 'uuid' }),
});

export const updateRandomMessageItemRequestSchema = Type.Object({
  message: Type.Object({
    value: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  }),
  status: Type.Object({
    value: Type.Optional(
      Type.Union([
        Type.Literal(ERandomMessageStatus.active),
        Type.Literal(ERandomMessageStatus.inactive),
        Type.Null(),
      ])
    ),
  }),
  type: Type.Object({
    value: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  }),
  attachment_url: Type.Optional(
    Type.Union([uploadFileRequestSchema, Type.Null()])
  ),
});

export type UpdateRandomMessageItemParamsRequest = Static<
  typeof updateRandomMessageItemParamsRequestSchema
>;
export type UpdateRandomMessageItemRequest = Static<
  typeof updateRandomMessageItemRequestSchema
>;
