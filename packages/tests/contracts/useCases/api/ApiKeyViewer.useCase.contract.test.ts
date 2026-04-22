import 'reflect-metadata';

jest.mock('@core/services/api.service', () => ({
  ApiService: class {},
}));

import { ApiKeyViewerUseCase } from '@core/useCases/api/ApiKeyViewer.useCase';

describe('ApiKeyViewerUseCase', () => {
  it('delegates api key lookup using request fields', async () => {
    const result = [{ permission_id: 'perm-1' }];
    const service = {
      findApiByKeyApi: jest.fn(async () => result),
    };
    const useCase = new ApiKeyViewerUseCase(service as never);

    await expect(
      useCase.execute({
        key_api: 'key-1',
        route_module: 'chat',
        module: 'list',
      } as never)
    ).resolves.toEqual(result);

    expect(service.findApiByKeyApi).toHaveBeenCalledWith(
      'key-1',
      'chat',
      'list'
    );
  });
});
