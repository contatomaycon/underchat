import { Static, Type } from '@sinclair/typebox';

export const createMessageResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ const: true }),
  message: Type.String(),
  data: Type.Object({
    message_id: Type.String(),
    queued: Type.Boolean(),
  }),
});

export type CreateMessageResponse = Static<typeof createMessageResponseSchema>;
