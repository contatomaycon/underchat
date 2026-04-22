import 'reflect-metadata';

jest.mock('@core/services/integration.service', () => ({
  IntegrationService: class {},
}));

import { IntegrationListerUseCase } from '@core/useCases/integration/IntegrationLister.useCase';

describe('IntegrationListerUseCase', () => {
  it('delegates integration listing', async () => {
    const request = { current_page: 1 } as never;
    const result = { results: [] };
    const service = {
      listIntegrations: jest.fn(async () => result),
    };
    const useCase = new IntegrationListerUseCase(service as never);

    await expect(useCase.execute('acc-1', request)).resolves.toEqual(result);
    expect(service.listIntegrations).toHaveBeenCalledWith('acc-1', request);
  });
});
