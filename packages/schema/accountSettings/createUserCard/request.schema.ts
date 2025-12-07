import { Type, Static } from '@sinclair/typebox';

export const createUserCardRequestSchema = Type.Object({
  number: Type.String(),
  holder_name: Type.String(),
  expiry_month: Type.String(),
  expiry_year: Type.String(),
  cvv: Type.String(),
});

export type CreateUserCardRequest = Static<typeof createUserCardRequestSchema>;
