import { Static, Type } from '@sinclair/typebox';

export const createCrossSellAccountRequestSchema = Type.Object({
  plan_cross_sell_id: Type.String({ format: 'uuid' }),
  account_id: Type.String({ format: 'uuid' }),
});

export type CreateCrossSellAccountRequest = Static<
  typeof createCrossSellAccountRequestSchema
>;
