import { Type, Static } from '@sinclair/typebox';

export const createUserCardResponseSchema = Type.Object({
  user_card_id: Type.String(),
  holder_name: Type.String(),
  last_number: Type.String(),
  brand: Type.String(),
  default: Type.Boolean(),
  created_at: Type.String(),
});

export type CreateUserCardResponse = Static<
  typeof createUserCardResponseSchema
>;
