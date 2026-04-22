import 'reflect-metadata';

jest.mock('@core/services/integration.service', () => ({
  IntegrationService: class {},
}));

import { IntegrationSectorUsersListerUseCase } from '@core/useCases/integration/IntegrationSectorUsersLister.useCase';

describe('IntegrationSectorUsersListerUseCase', () => {
  it('delegates sector users listing', async () => {
    const result = { users: [] };
    const service = {
      listSectorUsersForWebhook: jest.fn(async () => result),
    };
    const useCase = new IntegrationSectorUsersListerUseCase(service as never);

    await expect(useCase.execute('acc-1', 'sec-1')).resolves.toEqual(result);
    expect(service.listSectorUsersForWebhook).toHaveBeenCalledWith(
      'acc-1',
      'sec-1'
    );
  });
});
