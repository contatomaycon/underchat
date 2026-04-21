import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { AccountPaymentNfSeUpserterRepository } from '@core/repositories/account/AccountPaymentNfSeUpserter.repository';

jest.mock('node:crypto', () => ({
  randomUUID: jest.fn(),
}));

function buildInvoiceData() {
  return {
    id: 'invoice-1',
    status: 'AUTHORIZED',
    type: 'SERVICE',
    statusDescription: 'Approved',
    pdfUrl: 'http://pdf',
    xmlUrl: 'http://xml',
    rpsSerie: 'RPS-1',
    number: '100',
    validationCode: 'CODE',
    value: 123.45,
  };
}

describe('AccountPaymentNfSeUpserterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('findAccountPaymentByBilling returns payment id when found', async () => {
    const repository = new AccountPaymentNfSeUpserterRepository(
      {
        query: {
          accountPayment: {
            findFirst: jest.fn(async () => ({ account_payment_id: 'pay-1' })),
          },
        },
      } as never,
      {} as never
    );

    await expect(
      repository.findAccountPaymentByBilling('billing-1')
    ).resolves.toEqual({ account_payment_id: 'pay-1' });
  });

  it('findStatusByName and findNfSeByReference return null when not found', async () => {
    const repository = new AccountPaymentNfSeUpserterRepository(
      {
        query: {
          accountPayment: {
            findFirst: jest.fn(),
          },
        },
      } as never,
      {
        query: {
          accountPaymentNfSeStatus: {
            findFirst: jest.fn(async () => null),
          },
          accountPaymentNfSe: {
            findFirst: jest.fn(async () => null),
          },
        },
      } as never
    );

    await expect(repository.findStatusByName('AUTHORIZED')).resolves.toBeNull();
    await expect(
      repository.findNfSeByReference('invoice-1')
    ).resolves.toBeNull();
  });

  it('upsertAccountPaymentNfSe creates a new record when reference is missing', async () => {
    const uuidMock = randomUUID as unknown as jest.Mock;
    uuidMock.mockReturnValue('nfse-created-1');

    const insertValues = jest.fn(() => ({
      execute: jest.fn(async () => undefined),
    }));
    const tx = {
      query: {
        accountPaymentNfSeStatus: {
          findFirst: jest.fn(async () => ({
            account_payment_nfse_status_id: 'status-1',
          })),
        },
        nfse: {
          findFirst: jest.fn(async () => ({ nfse_id: 'nfse-default' })),
        },
        accountPaymentNfSe: {
          findFirst: jest.fn(async () => null),
        },
      },
      insert: jest.fn(() => ({
        values: insertValues,
      })),
      update: jest.fn(),
    };
    const repository = new AccountPaymentNfSeUpserterRepository(
      {
        transaction: jest.fn(async (cb: (txArg: unknown) => Promise<unknown>) =>
          cb(tx)
        ),
      } as never,
      {} as never
    );

    await expect(
      repository.upsertAccountPaymentNfSe(
        'payment-1',
        buildInvoiceData() as never
      )
    ).resolves.toBeUndefined();

    expect(insertValues).toHaveBeenCalledWith({
      account_payment_nfse_id: 'nfse-created-1',
      account_payment_id: 'payment-1',
      reference: 'invoice-1',
      account_payment_nfse_status_id: 'status-1',
      nfse_id: 'nfse-default',
      type: 'SERVICE',
      status_description: 'Approved',
      pdf_url: 'http://pdf',
      xml_url: 'http://xml',
      rps_serie: 'RPS-1',
      number: '100',
      validation_code: 'CODE',
      value: '123.45',
    });
  });

  it('upsertAccountPaymentNfSe updates existing reference', async () => {
    const set = jest.fn(() => ({
      where: jest.fn(() => ({
        execute: jest.fn(async () => undefined),
      })),
    }));
    const tx = {
      query: {
        accountPaymentNfSeStatus: {
          findFirst: jest.fn(async () => ({
            account_payment_nfse_status_id: 'status-1',
          })),
        },
        nfse: {
          findFirst: jest.fn(async () => ({ nfse_id: 'nfse-default' })),
        },
        accountPaymentNfSe: {
          findFirst: jest.fn(async () => ({
            account_payment_nfse_id: 'nfse-existing',
          })),
        },
      },
      insert: jest.fn(),
      update: jest.fn(() => ({
        set,
      })),
    };
    const repository = new AccountPaymentNfSeUpserterRepository(
      {
        transaction: jest.fn(async (cb: (txArg: unknown) => Promise<unknown>) =>
          cb(tx)
        ),
      } as never,
      {} as never
    );

    await expect(
      repository.upsertAccountPaymentNfSe(
        'payment-1',
        buildInvoiceData() as never
      )
    ).resolves.toBeUndefined();

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        account_payment_id: 'payment-1',
        account_payment_nfse_status_id: 'status-1',
        nfse_id: 'nfse-default',
        value: '123.45',
      })
    );
  });

  it('throws when status or default nfse is missing', async () => {
    const txNoStatus = {
      query: {
        accountPaymentNfSeStatus: {
          findFirst: jest.fn(async () => null),
        },
        nfse: {
          findFirst: jest.fn(async () => ({ nfse_id: 'nfse-default' })),
        },
        accountPaymentNfSe: {
          findFirst: jest.fn(async () => null),
        },
      },
      insert: jest.fn(),
      update: jest.fn(),
    };
    const repoNoStatus = new AccountPaymentNfSeUpserterRepository(
      {
        transaction: jest.fn(async (cb: (txArg: unknown) => Promise<unknown>) =>
          cb(txNoStatus)
        ),
      } as never,
      {} as never
    );

    await expect(
      repoNoStatus.upsertAccountPaymentNfSe(
        'payment-1',
        buildInvoiceData() as never
      )
    ).rejects.toThrow('Status não encontrado: AUTHORIZED');

    const txNoDefaultNfse = {
      query: {
        accountPaymentNfSeStatus: {
          findFirst: jest.fn(async () => ({
            account_payment_nfse_status_id: 'status-1',
          })),
        },
        nfse: {
          findFirst: jest.fn(async () => null),
        },
        accountPaymentNfSe: {
          findFirst: jest.fn(async () => null),
        },
      },
      insert: jest.fn(),
      update: jest.fn(),
    };
    const repoNoDefaultNfse = new AccountPaymentNfSeUpserterRepository(
      {
        transaction: jest.fn(async (cb: (txArg: unknown) => Promise<unknown>) =>
          cb(txNoDefaultNfse)
        ),
      } as never,
      {} as never
    );

    await expect(
      repoNoDefaultNfse.upsertAccountPaymentNfSe(
        'payment-1',
        buildInvoiceData() as never
      )
    ).rejects.toThrow('NFSe padrão não encontrado');
  });

  it('updateNfSeStatusOnly updates status or throws when dependencies are missing', async () => {
    const set = jest.fn(() => ({
      where: jest.fn(() => ({
        execute: jest.fn(async () => undefined),
      })),
    }));
    const txSuccess = {
      query: {
        accountPaymentNfSeStatus: {
          findFirst: jest.fn(async () => ({
            account_payment_nfse_status_id: 'status-2',
          })),
        },
        accountPaymentNfSe: {
          findFirst: jest.fn(async () => ({
            account_payment_nfse_id: 'nfse-2',
          })),
        },
      },
      update: jest.fn(() => ({
        set,
      })),
    };
    const repoSuccess = new AccountPaymentNfSeUpserterRepository(
      {
        transaction: jest.fn(async (cb: (txArg: unknown) => Promise<unknown>) =>
          cb(txSuccess)
        ),
      } as never,
      {} as never
    );

    await expect(
      repoSuccess.updateNfSeStatusOnly('invoice-1', 'CANCELLED')
    ).resolves.toBeUndefined();
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        account_payment_nfse_status_id: 'status-2',
      })
    );

    const repoNoStatus = new AccountPaymentNfSeUpserterRepository(
      {
        transaction: jest.fn(async (cb: (txArg: unknown) => Promise<unknown>) =>
          cb({
            query: {
              accountPaymentNfSeStatus: {
                findFirst: jest.fn(async () => null),
              },
              accountPaymentNfSe: {
                findFirst: jest.fn(async () => ({
                  account_payment_nfse_id: 'nfse-3',
                })),
              },
            },
            update: jest.fn(),
          })
        ),
      } as never,
      {} as never
    );

    await expect(
      repoNoStatus.updateNfSeStatusOnly('invoice-1', 'UNKNOWN')
    ).rejects.toThrow('Status não encontrado: UNKNOWN');
  });
});
