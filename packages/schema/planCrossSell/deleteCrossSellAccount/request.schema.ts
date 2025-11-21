import { Static, Type } from '@sinclair/typebox';

export const deleteCrossSellAccountRequestSchema = Type.Object({
  plan_cross_sell_account_id: Type.String({ format: 'uuid' }),
});

export type DeleteCrossSellAccountRequest = Static<
  typeof deleteCrossSellAccountRequestSchema
>;
