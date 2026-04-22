import 'reflect-metadata';

jest.mock('@core/services/integration.service', () => ({
  IntegrationService: class {},
}));

import { IntegrationViewerByIdUseCase } from '@core/useCases/integration/IntegrationViewerById.useCase';

describe('IntegrationViewerByIdUseCase', () => {
  it('delegates integration view by id', async () => {
    const result = { api_key_id: 'key-1' };
    const service = {
      viewIntegrationById: jest.fn(async () => result),
    };
    const useCase = new IntegrationViewerByIdUseCase(service as never);

    await expect(useCase.execute('acc-1', 'key-1')).resolves.toEqual(result);
    expect(service.viewIntegrationById).toHaveBeenCalledWith('acc-1', 'key-1');
  });

  it('returns null when service returns null', async () => {
    const service = {
      viewIntegrationById: jest.fn(async () => null),
    };
    const useCase = new IntegrationViewerByIdUseCase(service as never);

    await expect(useCase.execute('acc-1', 'key-1')).resolves.toBeNull();
  });
});
