import { Static, Type } from '@sinclair/typebox';

export const listCrossSellAccountResponseSchema = Type.Object({
  plan_cross_sell_account_id: Type.String({ format: 'uuid' }),
  plan_cross_sell_id: Type.String({ format: 'uuid' }),
  account_id: Type.String({ format: 'uuid' }),
  account: Type.Optional(
    Type.Object({
      account_id: Type.String({ format: 'uuid' }),
      name: Type.String(),
    })
  ),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const listCrossSellAccountsResponseSchema = Type.Array(
  listCrossSellAccountResponseSchema
);

export type ListCrossSellAccountResponse = Static<
  typeof listCrossSellAccountResponseSchema
>;
export type ListCrossSellAccountsResponse = Static<
  typeof listCrossSellAccountsResponseSchema
>;
