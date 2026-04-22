import 'reflect-metadata';

jest.mock('@core/services/integration.service', () => ({
  IntegrationService: class {},
}));

import { IntegrationStatusUpdaterUseCase } from '@core/useCases/integration/IntegrationStatusUpdater.useCase';

describe('IntegrationStatusUpdaterUseCase', () => {
  it('delegates status update', async () => {
    const service = {
      updateIntegrationStatus: jest.fn(async () => true),
    };
    const useCase = new IntegrationStatusUpdaterUseCase(service as never);

    await expect(
      useCase.execute('acc-1', 'key-1', 'active' as never)
    ).resolves.toBe(true);

    expect(service.updateIntegrationStatus).toHaveBeenCalledWith(
      'acc-1',
      'key-1',
      'active'
    );
  });
});
