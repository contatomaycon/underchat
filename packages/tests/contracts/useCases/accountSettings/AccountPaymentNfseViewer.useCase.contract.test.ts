import 'reflect-metadata';

jest.mock('@core/services/accountSettings.service', () => ({
  AccountSettingsService: class {},
}));

import { AccountPaymentNfseViewerUseCase } from '@core/useCases/accountSettings/AccountPaymentNfseViewer.useCase';

describe('AccountPaymentNfseViewerUseCase', () => {
  it('throws when nfse is not found', async () => {
    const service = {
      viewAccountPaymentNfse: jest.fn(async () => null),
    };
    const useCase = new AccountPaymentNfseViewerUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1', 'pay-1')).rejects.toThrow(
      'account_payment_nfse_not_found'
    );
  });

  it('returns account payment nfse', async () => {
    const nfse = { nfse_id: 'nf-1' };
    const service = {
      viewAccountPaymentNfse: jest.fn(async () => nfse),
    };
    const useCase = new AccountPaymentNfseViewerUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, 'acc-1', 'pay-1')
    ).resolves.toEqual(nfse);
    expect(service.viewAccountPaymentNfse).toHaveBeenCalledWith(
      'acc-1',
      'pay-1'
    );
  });
});
