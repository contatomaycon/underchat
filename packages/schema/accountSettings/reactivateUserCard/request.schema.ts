import { Static, Type } from '@sinclair/typebox';

export const reactivateUserCardRequestSchema = Type.Object({
  user_card_id: Type.String({ format: 'uuid' }),
});

export type ReactivateUserCardRequest = Static<
  typeof reactivateUserCardRequestSchema
>;
