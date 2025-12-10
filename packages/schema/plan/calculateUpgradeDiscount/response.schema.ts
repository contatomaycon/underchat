import { Static, Type } from '@sinclair/typebox';

export const calculateUpgradeDiscountResponseSchema = Type.Object({
  discount: Type.Number(),
  current_plan_price: Type.Number(),
  days_used: Type.Number(),
  days_remaining: Type.Number(),
  total_days: Type.Number(),
  is_upgrade: Type.Boolean(),
});

export type CalculateUpgradeDiscountResponse = Static<
  typeof calculateUpgradeDiscountResponseSchema
>;
