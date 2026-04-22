import 'reflect-metadata';

jest.mock('@core/services/integration.service', () => ({
  IntegrationService: class {},
}));

import { IntegrationUsersListerUseCase } from '@core/useCases/integration/IntegrationUsersLister.useCase';

describe('IntegrationUsersListerUseCase', () => {
  it('delegates users listing', async () => {
    const result = { users: [] };
    const service = {
      listUsersForWebhook: jest.fn(async () => result),
    };
    const useCase = new IntegrationUsersListerUseCase(service as never);

    await expect(useCase.execute('acc-1')).resolves.toEqual(result);
    expect(service.listUsersForWebhook).toHaveBeenCalledWith('acc-1');
  });
});
