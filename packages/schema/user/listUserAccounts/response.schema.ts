import { Static, Type } from '@sinclair/typebox';

export const listUserAccountsResponseItemSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

export const listUserAccountsResponseSchema = Type.Array(
  listUserAccountsResponseItemSchema
);

export type ListUserAccountsResponseItem = Static<
  typeof listUserAccountsResponseItemSchema
>;
export type ListUserAccountsResponse = Static<
  typeof listUserAccountsResponseSchema
>;
