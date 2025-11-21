import { Static, Type } from '@sinclair/typebox';

export const listPlanItemResponseSchema = Type.Object({
  plan_item_id: Type.String({ format: 'uuid' }),
  plan_id: Type.String({ format: 'uuid' }),
  plan_product_id: Type.String({ format: 'uuid' }),
  plan_product: Type.Optional(
    Type.Object({
      plan_product_id: Type.String({ format: 'uuid' }),
      name: Type.Union([Type.String(), Type.Null()]),
    })
  ),
  quantity: Type.Number(),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const listPlanItemsResponseSchema = Type.Array(
  listPlanItemResponseSchema
);

export type ListPlanItemResponse = Static<typeof listPlanItemResponseSchema>;
export type ListPlanItemsResponse = Static<typeof listPlanItemsResponseSchema>;
