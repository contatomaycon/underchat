import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';
import { ERandomMessageStatus } from '@core/common/enums/ERandomMessageStatus';
import { Static, Type } from '@sinclair/typebox';

export const createRandomMessageItemParamsRequestSchema = Type.Object({
  random_message_id: Type.String({ format: 'uuid' }),
});

export const createRandomMessageItemRequestSchema = Type.Object({
  message: Type.Object({
    value: Type.String(),
  }),
  status: Type.Object({
    value: Type.Union([
      Type.Literal(ERandomMessageStatus.active),
      Type.Literal(ERandomMessageStatus.inactive),
    ]),
  }),
  type: Type.Object({
    value: Type.String(),
  }),
  attachment_url: Type.Optional(
    Type.Union([uploadFileRequestSchema, Type.Null()])
  ),
});

export type CreateRandomMessageItemParamsRequest = Static<
  typeof createRandomMessageItemParamsRequestSchema
>;
export type CreateRandomMessageItemRequest = Static<
  typeof createRandomMessageItemRequestSchema
>;
