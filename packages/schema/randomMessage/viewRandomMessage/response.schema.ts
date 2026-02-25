import { ERandomMessageStatus } from '@core/common/enums/ERandomMessageStatus';
import { Static, Type } from '@sinclair/typebox';

export const viewRandomMessageResponseSchema = Type.Object({
  random_message_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  status: Type.Union([
    Type.Literal(ERandomMessageStatus.active),
    Type.Literal(ERandomMessageStatus.inactive),
  ]),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  updated_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ViewRandomMessageResponse = Static<
  typeof viewRandomMessageResponseSchema
>;
