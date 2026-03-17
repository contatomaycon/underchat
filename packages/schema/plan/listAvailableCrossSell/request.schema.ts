import { Static, Type } from '@sinclair/typebox';

export const listAvailableCrossSellRequestSchema = Type.Object({
  pricing_mode: Type.Optional(
    Type.Union([Type.Literal('full'), Type.Literal('proportional')], {
      default: 'full',
    })
  ),
});

export type ListAvailableCrossSellRequest = Static<
  typeof listAvailableCrossSellRequestSchema
>;
