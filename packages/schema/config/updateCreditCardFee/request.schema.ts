import { Static, Type } from '@sinclair/typebox';

export const updateCreditCardFeeRequestSchema = Type.Object({
  installment_1_rate: Type.Number({ minimum: 0 }),
  installment_2_rate: Type.Number({ minimum: 0 }),
  installment_3_rate: Type.Number({ minimum: 0 }),
  installment_4_rate: Type.Number({ minimum: 0 }),
  installment_5_rate: Type.Number({ minimum: 0 }),
  installment_6_rate: Type.Number({ minimum: 0 }),
  installment_7_rate: Type.Number({ minimum: 0 }),
  installment_8_rate: Type.Number({ minimum: 0 }),
  installment_9_rate: Type.Number({ minimum: 0 }),
  installment_10_rate: Type.Number({ minimum: 0 }),
  installment_11_rate: Type.Number({ minimum: 0 }),
  installment_12_rate: Type.Number({ minimum: 0 }),
});

export type UpdateCreditCardFeeRequest = Static<
  typeof updateCreditCardFeeRequestSchema
>;
