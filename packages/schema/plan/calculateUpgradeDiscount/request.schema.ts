import { Static, Type } from '@sinclair/typebox';

export const calculateUpgradeDiscountRequestSchema = Type.Object({
  plan_id: Type.String({
    format: 'uuid',
    description: 'ID do novo plano',
  }),
  billing_period: Type.Optional(
    Type.Union([Type.Literal('monthly'), Type.Literal('annual')], {
      description: 'Período de cobrança selecionado',
    })
  ),
});

export type CalculateUpgradeDiscountRequest = Static<
  typeof calculateUpgradeDiscountRequestSchema
>;
