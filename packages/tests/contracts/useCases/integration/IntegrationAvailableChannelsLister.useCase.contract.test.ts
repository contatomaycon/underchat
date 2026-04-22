import 'reflect-metadata';

jest.mock('@core/services/integration.service', () => ({
  IntegrationService: class {},
}));

import { IntegrationAvailableChannelsListerUseCase } from '@core/useCases/integration/IntegrationAvailableChannelsLister.useCase';

describe('IntegrationAvailableChannelsListerUseCase', () => {
  it('delegates to integration service', async () => {
    const result = { channels: [] };
    const service = {
      listAvailableChannels: jest.fn(async () => result),
    };
    const useCase = new IntegrationAvailableChannelsListerUseCase(
      service as never
    );

    await expect(useCase.execute('acc-1')).resolves.toEqual(result);
    expect(service.listAvailableChannels).toHaveBeenCalledWith('acc-1');
  });
});
