import { Static, Type } from '@sinclair/typebox';

export const deleteCrossSellRequestSchema = Type.Object({
  plan_cross_sell_id: Type.String({ format: 'uuid' }),
});

export type DeleteCrossSellRequest = Static<
  typeof deleteCrossSellRequestSchema
>;
