import { Static, Type } from '@sinclair/typebox';

export const newCardSchema = Type.Object({
  number: Type.String({ description: 'Número do cartão' }),
  holder_name: Type.String({ description: 'Nome do portador' }),
  expiry_month: Type.String({ description: 'Mês de expiração (MM)' }),
  expiry_year: Type.String({ description: 'Ano de expiração (AA)' }),
  cvv: Type.String({ description: 'CVV do cartão' }),
});

export const createOrderPaymentRequestSchema = Type.Object({
  plan_id: Type.String({
    format: 'uuid',
    description: 'ID do plano escolhido',
  }),
  billing_period: Type.Union(
    [Type.Literal('monthly'), Type.Literal('annual')],
    { description: 'Período de cobrança selecionado' }
  ),
  addons: Type.Optional(
    Type.Array(
      Type.Object({
        plan_product_id: Type.String({
          format: 'uuid',
          description: 'ID do adicional',
        }),
        quantity: Type.Number({
          minimum: 1,
          description: 'Quantidade do adicional',
        }),
      }),
      {
        description: 'Adicionais selecionados com suas quantidades',
      }
    )
  ),
  payment_method: Type.Union(
    [Type.Literal('boleto'), Type.Literal('credit_card'), Type.Literal('pix')],
    { description: 'Método de pagamento' }
  ),
  credit_card_id: Type.Optional(
    Type.String({
      format: 'uuid',
      description:
        'ID do cartão de crédito selecionado (se usar cartão existente)',
    })
  ),
  new_card: Type.Optional(
    Type.Object(
      {
        number: Type.String({ description: 'Número do cartão' }),
        holder_name: Type.String({ description: 'Nome do portador' }),
        expiry_month: Type.String({ description: 'Mês de expiração (MM)' }),
        expiry_year: Type.String({ description: 'Ano de expiração (AA)' }),
        cvv: Type.String({ description: 'CVV do cartão' }),
      },
      { description: 'Dados do novo cartão (se adicionar novo cartão)' }
    )
  ),
  recurring_payment: Type.Optional(
    Type.Boolean({
      description: 'Se o pagamento deve ser recorrente (apenas para cartão)',
    })
  ),
  installments: Type.Optional(
    Type.Number({
      minimum: 1,
      maximum: 12,
      description: 'Número de parcelas (apenas para cartão e plano anual)',
    })
  ),
});

export type CreateOrderPaymentRequest = Static<
  typeof createOrderPaymentRequestSchema
>;
export type NewCard = Static<typeof newCardSchema>;
