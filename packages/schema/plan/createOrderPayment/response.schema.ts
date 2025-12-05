import { Static, Type } from '@sinclair/typebox';

export const pixPaymentDataSchema = Type.Object({
  payment_id: Type.String({ description: 'ID do pagamento no Asaas' }),
  qr_code: Type.String({ description: 'QR Code do PIX em base64' }),
  payload: Type.String({ description: 'Código PIX copia e cola' }),
  expiration_date: Type.String({
    description: 'Data de expiração do QR Code',
  }),
});

export const createOrderPaymentResponseSchema = Type.Object({
  order_id: Type.String({ format: 'uuid', description: 'ID do pedido criado' }),
  total_amount: Type.Number({ description: 'Valor total a ser pago' }),
  plan_price: Type.Number({ description: 'Preço do plano' }),
  addons_total: Type.Number({ description: 'Total dos adicionais' }),
  upgrade_discount: Type.Number({
    description: 'Desconto de upgrade aplicado',
  }),
  payment_method: Type.String({ description: 'Método de pagamento' }),
  pix_payment: Type.Optional(pixPaymentDataSchema),
});

export type CreateOrderPaymentResponse = Static<
  typeof createOrderPaymentResponseSchema
>;
export type PixPaymentData = Static<typeof pixPaymentDataSchema>;
