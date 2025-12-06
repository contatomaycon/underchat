import { Static, Type } from '@sinclair/typebox';

export const asaasNfseWebhookRequestSchema = Type.Object({
  id: Type.String({ description: 'ID do evento' }),
  event: Type.Union(
    [
      Type.Literal('INVOICE_CREATED'),
      Type.Literal('INVOICE_UPDATED'),
      Type.Literal('INVOICE_SYNCHRONIZED'),
      Type.Literal('INVOICE_AUTHORIZED'),
      Type.Literal('INVOICE_PROCESSING_CANCELLATION'),
      Type.Literal('INVOICE_CANCELED'),
      Type.Literal('INVOICE_CANCELLATION_DENIED'),
      Type.Literal('INVOICE_ERROR'),
    ],
    { description: 'Tipo do evento' }
  ),
  dateCreated: Type.String({ description: 'Data de criação do evento' }),
  invoice: Type.Object({
    object: Type.String(),
    id: Type.String(),
    status: Type.String(),
    customer: Type.String(),
    type: Type.String(),
    statusDescription: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    serviceDescription: Type.Optional(Type.String()),
    pdfUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    xmlUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    rpsSerie: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    rpsNumber: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    number: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    validationCode: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    value: Type.Number(),
    deductions: Type.Number(),
    effectiveDate: Type.String(),
    observations: Type.Optional(Type.String()),
    estimatedTaxesDescription: Type.Optional(Type.String()),
    payment: Type.Optional(Type.String()),
    installment: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    taxes: Type.Optional(
      Type.Object({
        retainIss: Type.Optional(Type.Boolean()),
        iss: Type.Optional(Type.Number()),
        cofins: Type.Optional(Type.Number()),
        csll: Type.Optional(Type.Number()),
        inss: Type.Optional(Type.Number()),
        ir: Type.Optional(Type.Number()),
        pis: Type.Optional(Type.Number()),
      })
    ),
    municipalServiceCode: Type.Optional(Type.String()),
    municipalServiceName: Type.Optional(Type.String()),
  }),
});

export type AsaasNfseWebhookRequest = Static<
  typeof asaasNfseWebhookRequestSchema
>;
