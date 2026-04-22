import 'reflect-metadata';

jest.mock('@core/services/accountSettings.service', () => ({
  AccountSettingsService: class {},
}));

import { EPaymentStatus } from '@core/common/enums/EPaymentStatus';
import { AccountPaymentNfseGeneratorUseCase } from '@core/useCases/accountSettings/AccountPaymentNfseGenerator.useCase';

describe('AccountPaymentNfseGeneratorUseCase', () => {
  it('throws when account payment does not exist', async () => {
    const service = {
      findAccountPaymentById: jest.fn(async () => null),
      findNfSeByAccountPaymentId: jest.fn(),
      generateAccountPaymentNfse: jest.fn(),
    };
    const useCase = new AccountPaymentNfseGeneratorUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1', 'pay-1')).rejects.toThrow(
      'account_payment_not_found'
    );
    expect(service.findNfSeByAccountPaymentId).not.toHaveBeenCalled();
    expect(service.generateAccountPaymentNfse).not.toHaveBeenCalled();
  });

  it('throws when payment status is not paid', async () => {
    const service = {
      findAccountPaymentById: jest.fn(async () => ({
        payment_status_id: EPaymentStatus.pending,
        billing: { id: 'bill' },
      })),
      findNfSeByAccountPaymentId: jest.fn(),
      generateAccountPaymentNfse: jest.fn(),
    };
    const useCase = new AccountPaymentNfseGeneratorUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1', 'pay-1')).rejects.toThrow(
      'account_payment_not_paid'
    );
    expect(service.findNfSeByAccountPaymentId).not.toHaveBeenCalled();
  });

  it('throws when nfse already exists for payment', async () => {
    const payment = {
      payment_status_id: EPaymentStatus.confirmed,
      billing: { id: 'bill' },
    };
    const service = {
      findAccountPaymentById: jest.fn(async () => payment),
      findNfSeByAccountPaymentId: jest.fn(async () => ({ nfse_id: 'nf-1' })),
      generateAccountPaymentNfse: jest.fn(),
    };
    const useCase = new AccountPaymentNfseGeneratorUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1', 'pay-1')).rejects.toThrow(
      'account_payment_nfse_already_generated'
    );
    expect(service.generateAccountPaymentNfse).not.toHaveBeenCalled();
  });

  it('starts nfse generation for paid payment', async () => {
    const payment = {
      payment_status_id: EPaymentStatus.received,
      billing: { amount: 100 },
    };
    const service = {
      findAccountPaymentById: jest.fn(async () => payment),
      findNfSeByAccountPaymentId: jest.fn(async () => null),
      generateAccountPaymentNfse: jest.fn(async () => undefined),
    };
    const useCase = new AccountPaymentNfseGeneratorUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', 'pay-1')
    ).resolves.toEqual({
      success: true,
      message: 'account_payment_nfse_generation_started',
    });
    expect(service.generateAccountPaymentNfse).toHaveBeenCalledWith(
      t,
      'pay-1',
      payment.billing,
      true
    );
  });
});
