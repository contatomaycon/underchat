import { Static, Type } from '@sinclair/typebox';
import { listPlanItemResponseSchema } from '@core/schema/plan/listPlanItems/response.schema';

export const listRegisterPlanWithItemsResponseSchema = Type.Object({
  plan_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  price: Type.Number(),
  price_old: Type.Number(),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  annual_discount: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  icon: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  is_test: Type.Boolean(),
  days_trial: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  plan_items: Type.Array(listPlanItemResponseSchema),
});

export const listRegisterPlanWithItemsFinalResponseSchema = Type.Array(
  listRegisterPlanWithItemsResponseSchema
);

export type ListRegisterPlanWithItemsResponse = Static<
  typeof listRegisterPlanWithItemsResponseSchema
>;
export type ListRegisterPlanWithItemsFinalResponse = Static<
  typeof listRegisterPlanWithItemsFinalResponseSchema
>;
