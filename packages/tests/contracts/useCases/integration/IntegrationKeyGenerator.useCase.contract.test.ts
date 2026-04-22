import 'reflect-metadata';

jest.mock('@core/services/integration.service', () => ({
  IntegrationService: class {},
}));

import { IntegrationKeyGeneratorUseCase } from '@core/useCases/integration/IntegrationKeyGenerator.useCase';

describe('IntegrationKeyGeneratorUseCase', () => {
  it('delegates key generation', async () => {
    const service = {
      generateNewKey: jest.fn(async () => 'new-key'),
    };
    const useCase = new IntegrationKeyGeneratorUseCase(service as never);

    await expect(useCase.execute('acc-1', 'key-1')).resolves.toBe('new-key');
    expect(service.generateNewKey).toHaveBeenCalledWith('acc-1', 'key-1');
  });

  it('returns null when service returns null', async () => {
    const service = {
      generateNewKey: jest.fn(async () => null),
    };
    const useCase = new IntegrationKeyGeneratorUseCase(service as never);

    await expect(useCase.execute('acc-1', 'key-1')).resolves.toBeNull();
  });
});
