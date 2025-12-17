import { Static, Type } from '@sinclair/typebox';

export const updateCreditCardFeeResponseSchema = Type.Object({
  credit_card_fee_id: Type.String({ format: 'uuid' }),
  installment_1_rate: Type.Number(),
  installment_2_rate: Type.Number(),
  installment_3_rate: Type.Number(),
  installment_4_rate: Type.Number(),
  installment_5_rate: Type.Number(),
  installment_6_rate: Type.Number(),
  installment_7_rate: Type.Number(),
  installment_8_rate: Type.Number(),
  installment_9_rate: Type.Number(),
  installment_10_rate: Type.Number(),
  installment_11_rate: Type.Number(),
  installment_12_rate: Type.Number(),
  created_at: Type.String(),
  updated_at: Type.String(),
});

export type UpdateCreditCardFeeResponse = Static<
  typeof updateCreditCardFeeResponseSchema
>;
