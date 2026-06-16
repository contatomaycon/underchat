import { Static, Type, type TSchema } from '@sinclair/typebox';

const nullable = <TSchemaType extends TSchema>(schema: TSchemaType) =>
  Type.Union([schema, Type.Null()]);

const optionalNullable = <TSchemaType extends TSchema>(schema: TSchemaType) =>
  Type.Optional(nullable(schema));

export const asaasInvoiceWebhookRequestSchema = Type.Object({
  id: Type.String({ description: 'ID do evento' }),
  event: Type.String({ description: 'Tipo do evento' }),
  dateCreated: Type.String({ description: 'Data de criação do evento' }),
  account: Type.Optional(
    Type.Object({
      id: Type.String(),
      ownerId: optionalNullable(Type.String()),
    })
  ),
  payment: Type.Object({
    object: Type.String(),
    id: Type.String(),
    dateCreated: Type.String(),
    customer: Type.String(),
    subscription: optionalNullable(Type.String()),
    installment: optionalNullable(Type.String()),
    checkoutSession: optionalNullable(Type.String()),
    paymentLink: optionalNullable(Type.String()),
    dueDate: Type.String(),
    originalDueDate: optionalNullable(Type.String()),
    value: Type.Number(),
    netValue: Type.Number(),
    grossValue: optionalNullable(Type.Number()),
    originalValue: optionalNullable(Type.Number()),
    interestValue: optionalNullable(Type.Number()),
    nossoNumero: optionalNullable(Type.String()),
    description: optionalNullable(Type.String()),
    externalReference: optionalNullable(Type.String()),
    billingType: Type.String(),
    status: Type.String(),
    pixTransaction: optionalNullable(Type.String()),
    confirmedDate: optionalNullable(Type.String()),
    paymentDate: optionalNullable(Type.String()),
    clientPaymentDate: optionalNullable(Type.String()),
    installmentNumber: optionalNullable(Type.Number()),
    creditDate: optionalNullable(Type.String()),
    custody: optionalNullable(Type.String()),
    estimatedCreditDate: optionalNullable(Type.String()),
    invoiceUrl: optionalNullable(Type.String()),
    bankSlipUrl: optionalNullable(Type.String()),
    transactionReceiptUrl: optionalNullable(Type.String()),
    invoiceNumber: optionalNullable(Type.String()),
    deleted: Type.Boolean(),
    anticipated: Type.Boolean(),
    anticipable: Type.Boolean(),
    lastInvoiceViewedDate: optionalNullable(Type.String()),
    lastBankSlipViewedDate: optionalNullable(Type.String()),
    postalService: Type.Boolean(),
    creditCard: optionalNullable(
      Type.Object({
        creditCardNumber: optionalNullable(Type.String()),
        creditCardBrand: optionalNullable(Type.String()),
        creditCardToken: optionalNullable(Type.String()),
      })
    ),
    discount: optionalNullable(
      Type.Object({
        value: Type.Number(),
        dueDateLimitDays: Type.Number(),
        limitDate: optionalNullable(Type.String()),
        limitedDate: optionalNullable(Type.String()),
        type: Type.String(),
      })
    ),
    fine: optionalNullable(
      Type.Object({
        value: Type.Number(),
        type: Type.String(),
      })
    ),
    interest: optionalNullable(
      Type.Object({
        value: Type.Number(),
        type: Type.String(),
      })
    ),
    split: Type.Optional(
      Type.Array(
        Type.Object({
          id: Type.String(),
          walletId: Type.String(),
          fixedValue: optionalNullable(Type.Number()),
          percentualValue: optionalNullable(Type.Number()),
          status: Type.String(),
          refusalReason: optionalNullable(Type.String()),
          externalReference: optionalNullable(Type.String()),
          description: optionalNullable(Type.String()),
        })
      )
    ),
    chargeback: optionalNullable(
      Type.Object({
        status: Type.String(),
        reason: Type.String(),
      })
    ),
    escrow: optionalNullable(Type.Any()),
    refunds: optionalNullable(Type.Array(Type.Any())),
  }),
});

export type AsaasInvoiceWebhookRequest = Static<
  typeof asaasInvoiceWebhookRequestSchema
>;
