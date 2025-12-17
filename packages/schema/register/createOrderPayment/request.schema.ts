import { Static, Type } from '@sinclair/typebox';

const newCardSchema = Type.Object({
  number: Type.String(),
  holder_name: Type.String(),
  expiry_month: Type.String(),
  expiry_year: Type.String(),
  cvv: Type.String(),
});

export const createRegisterOrderPaymentRequestSchema = Type.Object({
  account_name: Type.String(),
  user: Type.Object({
    name: Type.String(),
    last_name: Type.String(),
    email: Type.String(),
    password: Type.String(),
    phone_ddi: Type.String(),
    phone_ddd: Type.Optional(Type.String()),
    phone: Type.String(),
    document_type_id: Type.String({ format: 'uuid' }),
    document: Type.String(),
    birth_date: Type.Optional(Type.String()),
    country_id: Type.Number(),
    zip_code: Type.String(),
    address1: Type.String(),
    address2: Type.Optional(Type.String()),
    district: Type.String(),
    state_fiscal_code: Type.Optional(Type.String()),
    city_fiscal_code: Type.Optional(Type.String()),
  }),
  plan_id: Type.String({ format: 'uuid' }),
  billing_period: Type.Union([Type.Literal('monthly'), Type.Literal('annual')]),
  addons: Type.Optional(
    Type.Array(
      Type.Object({
        plan_cross_sell_id: Type.String({ format: 'uuid' }),
      })
    )
  ),
  payment_method: Type.Union([
    Type.Literal('boleto'),
    Type.Literal('credit_card'),
    Type.Literal('pix'),
  ]),
  credit_card_id: Type.Optional(Type.String({ format: 'uuid' })),
  new_card: Type.Optional(newCardSchema),
  recurring_payment: Type.Optional(Type.Boolean()),
  installments: Type.Optional(Type.Number({ minimum: 1, maximum: 12 })),
});

export type CreateRegisterOrderPaymentRequest = Static<
  typeof createRegisterOrderPaymentRequestSchema
>;
