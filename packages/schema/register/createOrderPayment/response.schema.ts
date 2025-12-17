import { Static, Type } from '@sinclair/typebox';

export const registerPixPaymentDataSchema = Type.Object({
  payment_id: Type.String(),
  qr_code: Type.String(),
  payload: Type.String(),
  expiration_date: Type.String(),
});

export const registerCreditCardPaymentDataSchema = Type.Object({
  payment_id: Type.String(),
  status: Type.String(),
  is_confirmed: Type.Boolean(),
});

export const registerBoletoPaymentDataSchema = Type.Object({
  payment_id: Type.String(),
  identification_field: Type.String(),
  nosso_numero: Type.String(),
  qr_code: Type.Optional(Type.String()),
  payload: Type.Optional(Type.String()),
  expiration_date: Type.Optional(Type.String()),
  bank_slip_url: Type.String(),
  due_date: Type.String(),
});

export const createRegisterOrderPaymentResponseSchema = Type.Object({
  order_id: Type.String({ format: 'uuid' }),
  total_amount: Type.Number(),
  plan_price: Type.Number(),
  addons_total: Type.Number(),
  upgrade_discount: Type.Number(),
  payment_method: Type.String(),
  pix_payment: Type.Optional(registerPixPaymentDataSchema),
  credit_card_payment: Type.Optional(registerCreditCardPaymentDataSchema),
  boleto_payment: Type.Optional(registerBoletoPaymentDataSchema),
});

export type CreateRegisterOrderPaymentResponse = Static<
  typeof createRegisterOrderPaymentResponseSchema
>;
