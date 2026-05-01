import { Static, Type } from '@sinclair/typebox';

export const reactMessageResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ const: true }),
  message: Type.String(),
  data: Type.Null(),
});

export type ReactMessageResponse = Static<typeof reactMessageResponseSchema>;
