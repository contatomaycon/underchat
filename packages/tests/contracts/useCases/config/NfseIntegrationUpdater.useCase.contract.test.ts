import 'reflect-metadata';

jest.mock('@core/services/nfse.service', () => ({
  NfseService: class {},
}));

import { NfseIntegrationUpdaterUseCase } from '@core/useCases/config/NfseIntegrationUpdater.useCase';

describe('NfseIntegrationUpdaterUseCase', () => {
  it('delegates nfse integration upsert to service', async () => {
    const response = { success: true };
    const nfseService = {
      upsertNfseIntegration: jest.fn(async () => response),
    };
    const useCase = new NfseIntegrationUpdaterUseCase(nfseService as never);
    const t = jest.fn((key: string) => key);
    const input = { provider: 'nfs-e' } as never;

    await expect(useCase.execute(t as never, input)).resolves.toEqual(response);
    expect(nfseService.upsertNfseIntegration).toHaveBeenCalledWith(t, input);
  });
});
