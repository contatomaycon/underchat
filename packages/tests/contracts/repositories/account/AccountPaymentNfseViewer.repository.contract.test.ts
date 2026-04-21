import 'reflect-metadata';
import { AccountPaymentNfseViewerRepository } from '@core/repositories/account/AccountPaymentNfseViewer.repository';

describe('AccountPaymentNfseViewerRepository', () => {
  it('returns mapped NFSe payload', async () => {
    const findFirst = jest.fn(async () => ({
      account_payment_id: 'payment-1',
      apn: [
        {
          account_payment_nfse_id: 'nfse-1',
          type: 'SERVICE',
          status_description: 'Approved',
          rps_serie: 'RPS-1',
          number: '100',
          validation_code: 'VALID',
          value: '90.00',
          pdf_url: 'http://pdf',
          xml_url: 'http://xml',
          created_at: '2026-04-21T10:00:00.000Z',
          aps: {
            name: 'authorized',
          },
        },
      ],
    }));
    const db = {
      query: {
        accountPayment: {
          findFirst,
        },
      },
    };
    const repository = new AccountPaymentNfseViewerRepository(db as never);

    await expect(
      repository.viewAccountPaymentNfse('acc-1', 'payment-1')
    ).resolves.toEqual({
      account_payment_nfse_id: 'nfse-1',
      type: 'SERVICE',
      status_description: 'Approved',
      rps_serie: 'RPS-1',
      number: '100',
      validation_code: 'VALID',
      value: '90.00',
      pdf_url: 'http://pdf',
      xml_url: 'http://xml',
      created_at: '2026-04-21T10:00:00.000Z',
      status_name: 'authorized',
    });
  });

  it('applies fallbacks for nullable fields', async () => {
    const findFirst = jest.fn(async () => ({
      account_payment_id: 'payment-1',
      apn: [
        {
          account_payment_nfse_id: 'nfse-1',
          type: null,
          status_description: null,
          rps_serie: null,
          number: null,
          validation_code: null,
          value: null,
          pdf_url: null,
          xml_url: null,
          created_at: null,
          aps: null,
        },
      ],
    }));
    const db = {
      query: {
        accountPayment: {
          findFirst,
        },
      },
    };
    const repository = new AccountPaymentNfseViewerRepository(db as never);

    await expect(
      repository.viewAccountPaymentNfse('acc-1', 'payment-1')
    ).resolves.toEqual({
      account_payment_nfse_id: 'nfse-1',
      type: null,
      status_description: null,
      rps_serie: null,
      number: null,
      validation_code: null,
      value: null,
      pdf_url: null,
      xml_url: null,
      created_at: '',
      status_name: '',
    });
  });

  it('returns null when payment has no NFSe rows', async () => {
    const repository = new AccountPaymentNfseViewerRepository({
      query: {
        accountPayment: {
          findFirst: jest.fn(async () => null),
        },
      },
    } as never);

    await expect(
      repository.viewAccountPaymentNfse('acc-1', 'payment-1')
    ).resolves.toBeNull();
  });
});
