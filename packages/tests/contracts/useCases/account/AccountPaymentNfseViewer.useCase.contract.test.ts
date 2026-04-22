import 'reflect-metadata';

jest.mock('@core/services/accountPayment.service', () => ({
  AccountPaymentService: class {},
}));

import { AccountPaymentNfseViewerUseCase } from '@core/useCases/account/AccountPaymentNfseViewer.useCase';

describe('AccountPaymentNfseViewerUseCase', () => {
  it('throws when nfse is not found', async () => {
    const accountPaymentService = {
      viewAccountPaymentNfse: jest.fn(async () => null),
    };
    const useCase = new AccountPaymentNfseViewerUseCase(
      accountPaymentService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1', 'pay-1')).rejects.toThrow(
      'account_payment_nfse_not_found'
    );
  });

  it('returns payment nfse', async () => {
    const nfse = { nfse_id: 'nf-1' };
    const accountPaymentService = {
      viewAccountPaymentNfse: jest.fn(async () => nfse),
    };
    const useCase = new AccountPaymentNfseViewerUseCase(
      accountPaymentService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'acc-1', 'pay-1')
    ).resolves.toEqual(nfse);
    expect(accountPaymentService.viewAccountPaymentNfse).toHaveBeenCalledWith(
      'acc-1',
      'pay-1'
    );
  });
});
