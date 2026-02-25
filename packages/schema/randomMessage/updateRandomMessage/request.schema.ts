import { ERandomMessageStatus } from '@core/common/enums/ERandomMessageStatus';
import { Static, Type } from '@sinclair/typebox';

export const updateRandomMessageParamsSchema = Type.Object({
  random_message_id: Type.String({ format: 'uuid' }),
});

export const updateRandomMessageBodySchema = Type.Object({
  name: Type.Optional(
    Type.Union([Type.String({ minLength: 1, maxLength: 250 }), Type.Null()])
  ),
  status: Type.Optional(
    Type.Union([
      Type.Literal(ERandomMessageStatus.active),
      Type.Literal(ERandomMessageStatus.inactive),
      Type.Null(),
    ])
  ),
});

export type UpdateRandomMessageParams = Static<
  typeof updateRandomMessageParamsSchema
>;
export type UpdateRandomMessageBody = Static<
  typeof updateRandomMessageBodySchema
>;
export type UpdateRandomMessageRequest = UpdateRandomMessageBody;
