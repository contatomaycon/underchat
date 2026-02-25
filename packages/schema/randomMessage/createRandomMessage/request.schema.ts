import { ERandomMessageStatus } from '@core/common/enums/ERandomMessageStatus';
import { Static, Type } from '@sinclair/typebox';

export const createRandomMessageRequestSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 250 }),
  status: Type.Optional(
    Type.Union([
      Type.Literal(ERandomMessageStatus.active),
      Type.Literal(ERandomMessageStatus.inactive),
    ])
  ),
});

export type CreateRandomMessageRequest = Static<
  typeof createRandomMessageRequestSchema
>;
