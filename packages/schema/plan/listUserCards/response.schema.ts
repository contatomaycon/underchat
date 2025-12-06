import { Static, Type } from '@sinclair/typebox';

export const listUserCardResponseSchema = Type.Object({
  user_card_id: Type.String({ format: 'uuid' }),
  holder_name: Type.String(),
  last_number: Type.String(),
  brand: Type.String(),
  default: Type.Boolean(),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ListUserCardResponse = Static<typeof listUserCardResponseSchema>;

export const listUserCardsFinalResponseSchema = Type.Array(
  listUserCardResponseSchema
);

export type ListUserCardsFinalResponse = Static<
  typeof listUserCardsFinalResponseSchema
>;
