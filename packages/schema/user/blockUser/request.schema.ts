import { Static, Type } from '@sinclair/typebox';

export const blockUserRequestSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
});

export type BlockUserRequest = Static<typeof blockUserRequestSchema>;
