import 'reflect-metadata';

jest.mock('@core/services/integration.service', () => ({
  IntegrationService: class {},
}));

import { IntegrationUpdaterUseCase } from '@core/useCases/integration/IntegrationUpdater.useCase';

describe('IntegrationUpdaterUseCase', () => {
  it('delegates integration update', async () => {
    const request = { name: 'Renamed' } as never;
    const service = {
      updateIntegration: jest.fn(async () => true),
    };
    const useCase = new IntegrationUpdaterUseCase(service as never);

    await expect(useCase.execute('acc-1', 'key-1', request)).resolves.toBe(
      true
    );
    expect(service.updateIntegration).toHaveBeenCalledWith(
      'acc-1',
      'key-1',
      request
    );
  });

  it('returns false when service update fails', async () => {
    const service = {
      updateIntegration: jest.fn(async () => false),
    };
    const useCase = new IntegrationUpdaterUseCase(service as never);

    await expect(useCase.execute('acc-1', 'key-1', {} as never)).resolves.toBe(
      false
    );
  });
});
