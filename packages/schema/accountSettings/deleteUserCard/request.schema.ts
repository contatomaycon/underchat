import { Static, Type } from '@sinclair/typebox';

export const deleteUserCardRequestSchema = Type.Object({
  user_card_id: Type.String({ format: 'uuid' }),
});

export type DeleteUserCardRequest = Static<typeof deleteUserCardRequestSchema>;
