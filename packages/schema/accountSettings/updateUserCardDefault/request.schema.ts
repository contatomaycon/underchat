import { Static, Type } from '@sinclair/typebox';

export const updateUserCardDefaultRequestSchema = Type.Object({
  user_card_id: Type.String({ format: 'uuid' }),
});

export type UpdateUserCardDefaultRequest = Static<
  typeof updateUserCardDefaultRequestSchema
>;
