import { Static, Type } from '@sinclair/typebox';

export const unblockUserRequestSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
});

export type UnblockUserRequest = Static<typeof unblockUserRequestSchema>;
