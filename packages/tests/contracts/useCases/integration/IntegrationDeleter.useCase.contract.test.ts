import 'reflect-metadata';

jest.mock('@core/services/integration.service', () => ({
  IntegrationService: class {},
}));

import { IntegrationDeleterUseCase } from '@core/useCases/integration/IntegrationDeleter.useCase';

describe('IntegrationDeleterUseCase', () => {
  it('delegates integration deletion', async () => {
    const service = {
      deleteIntegration: jest.fn(async () => true),
    };
    const useCase = new IntegrationDeleterUseCase(service as never);

    await expect(useCase.execute('acc-1', 'key-1')).resolves.toBe(true);
    expect(service.deleteIntegration).toHaveBeenCalledWith('acc-1', 'key-1');
  });

  it('returns false when deletion fails', async () => {
    const service = {
      deleteIntegration: jest.fn(async () => false),
    };
    const useCase = new IntegrationDeleterUseCase(service as never);

    await expect(useCase.execute('acc-1', 'key-1')).resolves.toBe(false);
  });
});
