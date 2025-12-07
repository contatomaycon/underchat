import { Static, Type } from '@sinclair/typebox';

export const asaasInvoiceWebhookRequestSchema = Type.Object({
  id: Type.String({ description: 'ID do evento' }),
  event: Type.String({ description: 'Tipo do evento' }),
  dateCreated: Type.String({ description: 'Data de criação do evento' }),
  payment: Type.Object({
    object: Type.String(),
    id: Type.String(),
    dateCreated: Type.String(),
    customer: Type.String(),
    subscription: Type.Optional(Type.String()),
    installment: Type.Optional(Type.String()),
    paymentLink: Type.Optional(Type.String()),
    dueDate: Type.String(),
    originalDueDate: Type.Optional(Type.String()),
    value: Type.Number(),
    netValue: Type.Number(),
    originalValue: Type.Optional(Type.Number()),
    interestValue: Type.Optional(Type.Number()),
    nossoNumero: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    externalReference: Type.Optional(Type.String()),
    billingType: Type.String(),
    status: Type.String(),
    pixTransaction: Type.Optional(Type.String()),
    confirmedDate: Type.Optional(Type.String()),
    paymentDate: Type.Optional(Type.String()),
    clientPaymentDate: Type.Optional(Type.String()),
    installmentNumber: Type.Optional(Type.Number()),
    creditDate: Type.Optional(Type.String()),
    custody: Type.Optional(Type.String()),
    estimatedCreditDate: Type.Optional(Type.String()),
    invoiceUrl: Type.Optional(Type.String()),
    bankSlipUrl: Type.Optional(Type.String()),
    transactionReceiptUrl: Type.Optional(Type.String()),
    invoiceNumber: Type.Optional(Type.String()),
    deleted: Type.Boolean(),
    anticipated: Type.Boolean(),
    anticipable: Type.Boolean(),
    lastInvoiceViewedDate: Type.Optional(Type.String()),
    lastBankSlipViewedDate: Type.Optional(Type.String()),
    postalService: Type.Boolean(),
    creditCard: Type.Optional(
      Type.Object({
        creditCardNumber: Type.String(),
        creditCardBrand: Type.String(),
        creditCardToken: Type.String(),
      })
    ),
    discount: Type.Optional(
      Type.Object({
        value: Type.Number(),
        dueDateLimitDays: Type.Number(),
        limitedDate: Type.Optional(Type.String()),
        type: Type.String(),
      })
    ),
    fine: Type.Optional(
      Type.Object({
        value: Type.Number(),
        type: Type.String(),
      })
    ),
    interest: Type.Optional(
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
          fixedValue: Type.Optional(Type.Number()),
          percentualValue: Type.Optional(Type.Number()),
          status: Type.String(),
          refusalReason: Type.Optional(Type.String()),
          externalReference: Type.Optional(Type.String()),
          description: Type.Optional(Type.String()),
        })
      )
    ),
    chargeback: Type.Optional(
      Type.Object({
        status: Type.String(),
        reason: Type.String(),
      })
    ),
    refunds: Type.Optional(Type.Array(Type.Any())),
  }),
});

export type AsaasInvoiceWebhookRequest = Static<
  typeof asaasInvoiceWebhookRequestSchema
>;
