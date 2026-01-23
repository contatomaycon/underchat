import { Static, Type } from '@sinclair/typebox';

export const listReleaseAccountsResponseSchema = Type.Array(
  Type.Object({
    account_id: Type.String({ format: 'uuid' }),
    name: Type.String(),
  })
);

export type ListReleaseAccountsResponse = Static<
  typeof listReleaseAccountsResponseSchema
>;
