import 'reflect-metadata';

jest.mock('@core/services/integration.service', () => ({
  IntegrationService: class {},
}));

import { IntegrationCreatorUseCase } from '@core/useCases/integration/IntegrationCreator.useCase';

describe('IntegrationCreatorUseCase', () => {
  it('delegates integration creation', async () => {
    const request = { name: 'Webhook' } as never;
    const result = { api_key_id: 'key-1' };
    const service = {
      createIntegration: jest.fn(async () => result),
    };
    const useCase = new IntegrationCreatorUseCase(service as never);

    await expect(useCase.execute('acc-1', request)).resolves.toEqual(result);
    expect(service.createIntegration).toHaveBeenCalledWith('acc-1', request);
  });

  it('returns null when service returns null', async () => {
    const service = {
      createIntegration: jest.fn(async () => null),
    };
    const useCase = new IntegrationCreatorUseCase(service as never);

    await expect(useCase.execute('acc-1', {} as never)).resolves.toBeNull();
  });
});
