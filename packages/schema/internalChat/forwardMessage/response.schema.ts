import { Static, Type } from '@sinclair/typebox';

export const forwardMessageResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ const: true }),
  message: Type.String(),
  data: Type.Object({
    queued_count: Type.Number(),
  }),
});

export type ForwardMessageResponse = Static<
  typeof forwardMessageResponseSchema
>;
