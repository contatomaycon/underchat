import { Static, Type } from '@sinclair/typebox';

export const accountBasicSchema = Type.Object({
  account_id: Type.String(),
  name: Type.String(),
});

export const listAccountsResponseSchema = Type.Array(accountBasicSchema);

export type AccountBasic = Static<typeof accountBasicSchema>;
export type ListAccountsResponse = Static<typeof listAccountsResponseSchema>;
