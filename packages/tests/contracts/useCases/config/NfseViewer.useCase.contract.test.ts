import 'reflect-metadata';

jest.mock('@core/services/nfse.service', () => ({
  NfseService: class {},
}));

import { NfseViewerUseCase } from '@core/useCases/config/NfseViewer.useCase';

describe('NfseViewerUseCase', () => {
  it('throws when nfse is not found', async () => {
    const nfseService = {
      viewNfse: jest.fn(async () => null),
    };
    const useCase = new NfseViewerUseCase(nfseService as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never)).rejects.toThrow('nfse_not_found');
  });

  it('returns nfse data', async () => {
    const nfse = { nfse_integration_id: 'nfse-1' };
    const nfseService = {
      viewNfse: jest.fn(async () => nfse),
    };
    const useCase = new NfseViewerUseCase(nfseService as never);

    await expect(useCase.execute(jest.fn() as never)).resolves.toEqual(nfse);
  });
});
