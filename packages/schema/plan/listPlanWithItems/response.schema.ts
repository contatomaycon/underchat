import { Static, Type } from '@sinclair/typebox';
import { listPlanItemResponseSchema } from '../listPlanItems/response.schema';

export const listPlanWithItemsResponseSchema = Type.Object({
  plan_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  price: Type.Number(),
  price_old: Type.Number(),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  annual_discount: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  icon: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  plan_items: Type.Array(listPlanItemResponseSchema),
});

export const listPlanWithItemsFinalResponseSchema = Type.Array(
  listPlanWithItemsResponseSchema
);

export type ListPlanWithItemsResponse = Static<
  typeof listPlanWithItemsResponseSchema
>;
export type ListPlanWithItemsFinalResponse = Static<
  typeof listPlanWithItemsFinalResponseSchema
>;
