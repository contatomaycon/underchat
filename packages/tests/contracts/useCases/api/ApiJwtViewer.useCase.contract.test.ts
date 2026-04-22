import 'reflect-metadata';

jest.mock('@core/services/api.service', () => ({
  ApiService: class {},
}));

import { ApiJwtViewerUseCase } from '@core/useCases/api/ApiJwtViewer.useCase';

describe('ApiJwtViewerUseCase', () => {
  it('delegates jwt lookup using destructured fields', async () => {
    const result = { permissions: [], account_id: 'acc-1' };
    const service = {
      findApiByJwt: jest.fn(async () => result),
    };
    const useCase = new ApiJwtViewerUseCase(service as never);

    await expect(
      useCase.execute({
        userId: 'user-1',
        routeModule: 'chat',
        module: 'list',
      } as never)
    ).resolves.toEqual(result);

    expect(service.findApiByJwt).toHaveBeenCalledWith('user-1', 'chat', 'list');
  });
});
