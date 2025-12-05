import { Static, Type } from '@sinclair/typebox';

export const createOrderPaymentResponseSchema = Type.Object({
  order_id: Type.String({ format: 'uuid', description: 'ID do pedido criado' }),
  total_amount: Type.Number({ description: 'Valor total a ser pago' }),
  plan_price: Type.Number({ description: 'Preço do plano' }),
  addons_total: Type.Number({ description: 'Total dos adicionais' }),
  upgrade_discount: Type.Number({
    description: 'Desconto de upgrade aplicado',
  }),
  payment_method: Type.String({ description: 'Método de pagamento' }),
});

export type CreateOrderPaymentResponse = Static<
  typeof createOrderPaymentResponseSchema
>;
