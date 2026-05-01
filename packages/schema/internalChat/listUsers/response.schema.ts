import { Static, Type } from '@sinclair/typebox';
import { internalChatUserListResponseSchema } from '../common';

export const listUsersResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ const: true }),
  message: Type.String(),
  data: internalChatUserListResponseSchema,
});

export type ListUsersResponse = Static<typeof listUsersResponseSchema>;
