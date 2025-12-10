import { Static, Type } from '@sinclair/typebox';

export const listAccountPlanProductsResponseSchema = Type.Object({
  plan_product_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  quantity_total: Type.Number(),
  quantity_used: Type.Number(),
  quantity_plan: Type.Number(),
  quantity_addon: Type.Number(),
  source: Type.Union([Type.Literal('plan'), Type.Literal('addon')]),
});

export const listAccountPlanProductsFinalResponseSchema = Type.Array(
  listAccountPlanProductsResponseSchema
);

export type ListAccountPlanProductsResponse = Static<
  typeof listAccountPlanProductsResponseSchema
>;

export type ListAccountPlanProductsFinalResponse = Static<
  typeof listAccountPlanProductsFinalResponseSchema
>;
