import { Static, Type } from '@sinclair/typebox';

export const listAccountsResponseSchema = Type.Object({
  account_id: Type.String(),
  name: Type.String(),
});

export type ListAccountsResponse = Static<typeof listAccountsResponseSchema>;
