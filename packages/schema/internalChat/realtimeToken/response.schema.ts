import { Static, Type } from '@sinclair/typebox';

export const realtimeTokenResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ const: true }),
  message: Type.String(),
  data: Type.Object({
    token: Type.String(),
    url: Type.String(),
  }),
});

export type RealtimeTokenResponse = Static<typeof realtimeTokenResponseSchema>;
