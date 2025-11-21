import { Static, Type } from '@sinclair/typebox';

export const listCrossSellAccountRequestSchema = Type.Object({
  plan_cross_sell_id: Type.String({ format: 'uuid' }),
});

export type ListCrossSellAccountRequest = Static<
  typeof listCrossSellAccountRequestSchema
>;
