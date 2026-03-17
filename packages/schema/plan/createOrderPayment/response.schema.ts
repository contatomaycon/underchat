import { Static, Type } from '@sinclair/typebox';

export const pixPaymentDataSchema = Type.Object({
  payment_id: Type.String({ description: 'ID do pagamento no Asaas' }),
  qr_code: Type.String({ description: 'QR Code do PIX em base64' }),
  payload: Type.String({ description: 'Código PIX copia e cola' }),
  expiration_date: Type.String({
    description: 'Data de expiração do QR Code',
  }),
});

export const creditCardPaymentDataSchema = Type.Object({
  payment_id: Type.String({ description: 'ID do pagamento no Asaas' }),
  status: Type.String({ description: 'Status do pagamento' }),
  is_confirmed: Type.Boolean({ description: 'Se o pagamento foi confirmado' }),
});

export const boletoPaymentDataSchema = Type.Object({
  payment_id: Type.String({ description: 'ID do pagamento no Asaas' }),
  identification_field: Type.String({
    description: 'Linha digitável do boleto',
  }),
  nosso_numero: Type.String({ description: 'Nosso número do boleto' }),
  qr_code: Type.Optional(
    Type.String({ description: 'QR Code do PIX do boleto em base64' })
  ),
  payload: Type.Optional(
    Type.String({ description: 'Código PIX copia e cola do boleto' })
  ),
  expiration_date: Type.Optional(
    Type.String({ description: 'Data de expiração do QR Code do PIX' })
  ),
  bank_slip_url: Type.String({ description: 'URL do boleto para download' }),
  due_date: Type.String({ description: 'Data de vencimento do boleto' }),
});

export const createOrderPaymentResponseSchema = Type.Object({
  order_id: Type.String({ format: 'uuid', description: 'ID do pedido criado' }),
  order_type: Type.Optional(
    Type.Union([Type.Literal('plan'), Type.Literal('addon')], {
      description: 'Tipo do pedido processado',
    })
  ),
  total_amount: Type.Number({ description: 'Valor total a ser pago' }),
  plan_price: Type.Number({ description: 'Preço do plano' }),
  addons_total: Type.Number({ description: 'Total dos adicionais' }),
  upgrade_discount: Type.Number({
    description: 'Desconto de upgrade aplicado',
  }),
  payment_method: Type.String({ description: 'Método de pagamento' }),
  pix_payment: Type.Optional(pixPaymentDataSchema),
  credit_card_payment: Type.Optional(creditCardPaymentDataSchema),
  boleto_payment: Type.Optional(boletoPaymentDataSchema),
});

export type CreateOrderPaymentResponse = Static<
  typeof createOrderPaymentResponseSchema
>;
export type PixPaymentData = Static<typeof pixPaymentDataSchema>;
export type CreditCardPaymentData = Static<typeof creditCardPaymentDataSchema>;
export type BoletoPaymentData = Static<typeof boletoPaymentDataSchema>;
