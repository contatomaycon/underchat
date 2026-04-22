import 'reflect-metadata';

jest.mock('@core/services/accountPayment.service', () => ({
  AccountPaymentService: class {},
}));

import { EPaymentStatus } from '@core/common/enums/EPaymentStatus';
import { AccountPaymentNfseGeneratorUseCase } from '@core/useCases/account/AccountPaymentNfseGenerator.useCase';

describe('AccountPaymentNfseGeneratorUseCase', () => {
  it('throws when payment does not exist', async () => {
    const accountPaymentService = {
      findAccountPaymentById: jest.fn(async () => null),
      findNfSeByAccountPaymentId: jest.fn(),
      generateAccountPaymentNfse: jest.fn(),
    };
    const useCase = new AccountPaymentNfseGeneratorUseCase(
      accountPaymentService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1', 'pay-1')).rejects.toThrow(
      'account_payment_not_found'
    );
  });

  it('throws when payment status is not paid', async () => {
    const accountPaymentService = {
      findAccountPaymentById: jest.fn(async () => ({
        payment_status_id: EPaymentStatus.pending,
        billing: { id: 'b1' },
      })),
      findNfSeByAccountPaymentId: jest.fn(),
      generateAccountPaymentNfse: jest.fn(),
    };
    const useCase = new AccountPaymentNfseGeneratorUseCase(
      accountPaymentService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1', 'pay-1')).rejects.toThrow(
      'account_payment_not_paid'
    );
  });

  it('throws when nfse already exists', async () => {
    const payment = {
      payment_status_id: EPaymentStatus.confirmed,
      billing: { id: 'b1' },
    };
    const accountPaymentService = {
      findAccountPaymentById: jest.fn(async () => payment),
      findNfSeByAccountPaymentId: jest.fn(async () => ({ nfse_id: 'nf-1' })),
      generateAccountPaymentNfse: jest.fn(),
    };
    const useCase = new AccountPaymentNfseGeneratorUseCase(
      accountPaymentService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1', 'pay-1')).rejects.toThrow(
      'account_payment_nfse_already_generated'
    );
  });

  it('starts nfse generation for paid payment', async () => {
    const payment = {
      payment_status_id: EPaymentStatus.received,
      billing: { id: 'b1' },
    };
    const accountPaymentService = {
      findAccountPaymentById: jest.fn(async () => payment),
      findNfSeByAccountPaymentId: jest.fn(async () => null),
      generateAccountPaymentNfse: jest.fn(async () => undefined),
    };
    const useCase = new AccountPaymentNfseGeneratorUseCase(
      accountPaymentService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', 'pay-1')
    ).resolves.toEqual({
      success: true,
      message: 'account_payment_nfse_generation_started',
    });
    expect(
      accountPaymentService.generateAccountPaymentNfse
    ).toHaveBeenCalledWith(t, 'pay-1', payment.billing, true);
  });
});
