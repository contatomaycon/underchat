import 'reflect-metadata';
import { NfseProcessorService } from '@core/services/nfseProcessor.service';

describe('NfseProcessorService', () => {
  const makeData = () => ({
    invoice: { id: 'inv_1', payment: 'pay_1' },
  });

  it('throws when payment id is missing', async () => {
    const service = new NfseProcessorService(
      { getInvoice: jest.fn() } as never,
      {
        findAccountPaymentByBilling: jest.fn(),
        upsertAccountPaymentNfSe: jest.fn(),
      } as never
    );

    await expect(
      service.processWebhookEvent({
        invoice: { id: 'inv_1', payment: '' },
      } as never)
    ).rejects.toThrow('Payment ID não encontrado no webhook');
  });

  it('throws when account payment is not found', async () => {
    const service = new NfseProcessorService(
      { getInvoice: jest.fn() } as never,
      {
        findAccountPaymentByBilling: jest.fn(async () => null),
        upsertAccountPaymentNfSe: jest.fn(),
      } as never
    );

    await expect(
      service.processWebhookEvent(makeData() as never)
    ).rejects.toThrow('Account payment não encontrado para billing: pay_1');
  });

  it('throws when invoice is not found in asaas', async () => {
    const service = new NfseProcessorService(
      { getInvoice: jest.fn(async () => null) } as never,
      {
        findAccountPaymentByBilling: jest.fn(async () => ({
          account_payment_id: 'ap_1',
        })),
        upsertAccountPaymentNfSe: jest.fn(),
      } as never
    );

    await expect(
      service.processWebhookEvent(makeData() as never)
    ).rejects.toThrow('Invoice não encontrada no Asaas: inv_1');
  });

  it('upserts nfse data when everything is valid', async () => {
    const upsertAccountPaymentNfSe = jest.fn(async () => undefined);
    const service = new NfseProcessorService(
      { getInvoice: jest.fn(async () => ({ id: 'inv_1' })) } as never,
      {
        findAccountPaymentByBilling: jest.fn(async () => ({
          account_payment_id: 'ap_1',
        })),
        upsertAccountPaymentNfSe,
      } as never
    );

    await expect(
      service.processWebhookEvent(makeData() as never)
    ).resolves.toBeUndefined();
    expect(upsertAccountPaymentNfSe).toHaveBeenCalledWith('ap_1', {
      id: 'inv_1',
    });
  });
});
