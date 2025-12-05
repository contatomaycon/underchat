import { Static, Type } from '@sinclair/typebox';

export const calculateUpgradeDiscountRequestSchema = Type.Object({
  plan_id: Type.String({
    format: 'uuid',
    description: 'ID do novo plano',
  }),
});

export type CalculateUpgradeDiscountRequest = Static<
  typeof calculateUpgradeDiscountRequestSchema
>;
