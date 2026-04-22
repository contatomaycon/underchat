import 'reflect-metadata';

jest.mock('@core/services/integration.service', () => ({
  IntegrationService: class {},
}));

import { IntegrationSectorsListerUseCase } from '@core/useCases/integration/IntegrationSectorsLister.useCase';

describe('IntegrationSectorsListerUseCase', () => {
  it('delegates sectors listing', async () => {
    const result = { sectors: [] };
    const service = {
      listSectorsForWebhook: jest.fn(async () => result),
    };
    const useCase = new IntegrationSectorsListerUseCase(service as never);

    await expect(useCase.execute('acc-1')).resolves.toEqual(result);
    expect(service.listSectorsForWebhook).toHaveBeenCalledWith('acc-1');
  });
});
