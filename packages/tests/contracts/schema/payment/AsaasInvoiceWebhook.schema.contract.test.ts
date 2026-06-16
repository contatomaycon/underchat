import { Value } from '@sinclair/typebox/value';
import { asaasInvoiceWebhookRequestSchema } from '@core/schema/payment/Webhook/request.schema';

const makeAsaasCheckoutViewedPayload = () => ({
  id: 'evt_bdaf5c611b55dc82906787d5bfe1e5e2&1378397100',
  event: 'PAYMENT_CHECKOUT_VIEWED',
  dateCreated: '2026-06-15 15:52:36',
  account: {
    id: '9b7946f0-3bb6-49d8-a3bb-dd0c96772367',
    ownerId: null,
  },
  payment: {
    object: 'payment',
    id: 'pay_59w03zozngvnla4o',
    dateCreated: '2026-06-15',
    customer: 'cus_000168648053',
    checkoutSession: null,
    paymentLink: null,
    value: 159.48,
    netValue: 154.23,
    grossValue: null,
    originalValue: null,
    interestValue: null,
    description:
      'A fatura anterior foi contestada, entramos em contato e informaram que o cartão foi cancelado.\r\n\r\nPagamento da fatura 019ae6ac-e874-719b-8ee7-1f9d8bc667da',
    billingType: 'CREDIT_CARD',
    confirmedDate: null,
    creditCard: {
      creditCardNumber: null,
      creditCardBrand: null,
    },
    pixTransaction: null,
    status: 'PENDING',
    dueDate: '2026-06-15',
    originalDueDate: '2026-06-15',
    paymentDate: null,
    clientPaymentDate: null,
    installmentNumber: null,
    invoiceUrl: 'https://www.asaas.com/i/59w03zozngvnla4o',
    invoiceNumber: '834816047',
    externalReference: null,
    deleted: false,
    anticipated: false,
    anticipable: false,
    creditDate: null,
    estimatedCreditDate: null,
    transactionReceiptUrl: null,
    nossoNumero: null,
    bankSlipUrl: null,
    lastInvoiceViewedDate: '2026-06-15T18:52:34Z',
    lastBankSlipViewedDate: null,
    discount: {
      value: 0.0,
      limitDate: null,
      dueDateLimitDays: 0.0,
      type: 'PERCENTAGE',
    },
    fine: {
      value: 0.0,
      type: 'PERCENTAGE',
    },
    interest: {
      value: 0.0,
      type: 'PERCENTAGE',
    },
    postalService: false,
    escrow: null,
    refunds: null,
  },
});

describe('Asaas invoice webhook schema', () => {
  it('accepts the PAYMENT_CHECKOUT_VIEWED payload sent by Asaas', () => {
    expect(
      Value.Check(
        asaasInvoiceWebhookRequestSchema,
        makeAsaasCheckoutViewedPayload()
      )
    ).toBe(true);
  });

  it('accepts credit card webhook data without a token', () => {
    const payload = makeAsaasCheckoutViewedPayload();
    payload.payment.creditCard = {
      creditCardNumber: null,
      creditCardBrand: null,
    };

    expect(Value.Check(asaasInvoiceWebhookRequestSchema, payload)).toBe(true);
  });

  it('keeps the payment id required', () => {
    const payload = makeAsaasCheckoutViewedPayload();
    delete (payload.payment as Record<string, unknown>).id;

    expect(Value.Check(asaasInvoiceWebhookRequestSchema, payload)).toBe(false);
  });
});
