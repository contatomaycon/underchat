import 'reflect-metadata';

jest.mock('@core/services/nfse.service', () => ({
  NfseService: class {},
}));

import { NfseUpdaterUseCase } from '@core/useCases/config/NfseUpdater.useCase';

describe('NfseUpdaterUseCase', () => {
  it('delegates nfse update to service', async () => {
    const response = { success: true };
    const nfseService = {
      upsertNfse: jest.fn(async () => response),
    };
    const useCase = new NfseUpdaterUseCase(nfseService as never);
    const t = jest.fn((key: string) => key);
    const input = { city_code: '3550308' } as never;

    await expect(useCase.execute(t as never, input)).resolves.toEqual(response);
    expect(nfseService.upsertNfse).toHaveBeenCalledWith(t, input);
  });
});
