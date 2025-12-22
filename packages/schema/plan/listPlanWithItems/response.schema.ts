import { Static, Type } from '@sinclair/typebox';
import { listPlanItemResponseSchema } from '../listPlanItems/response.schema';
import { EPlanStatus } from '@core/common/enums/EPlanStatus';

export const listPlanWithItemsResponseSchema = Type.Object({
  plan_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  price: Type.Number(),
  price_old: Type.Number(),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  annual_discount: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  icon: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  is_test: Type.Boolean(),
  days_trial: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  is_exclusive: Type.Boolean(),
  status: Type.Enum(EPlanStatus),
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
