import { Static, Type } from '@sinclair/typebox';

export const listAccountAddonsResponseSchema = Type.Object({
  plan_cross_sell_id: Type.String({ format: 'uuid' }),
  plan_product_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  quantity_total: Type.Number(),
  quantity_used: Type.Number(),
  quantity_plan: Type.Number(),
  quantity_addon: Type.Number(),
  source: Type.Union([Type.Literal('plan'), Type.Literal('addon')]),
});

export const listAccountAddonsFinalResponseSchema = Type.Array(
  listAccountAddonsResponseSchema
);

export type ListAccountAddonsResponse = Static<
  typeof listAccountAddonsResponseSchema
>;

export type ListAccountAddonsFinalResponse = Static<
  typeof listAccountAddonsFinalResponseSchema
>;
