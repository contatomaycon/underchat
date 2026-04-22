import 'reflect-metadata';

jest.mock('@core/services/release.service', () => ({
  ReleaseService: class {},
}));

import { ReleaseDeleterUseCase } from '@core/useCases/release/ReleaseDeleter.useCase';

describe('ReleaseDeleterUseCase', () => {
  it('delegates release deletion', async () => {
    const service = {
      deleteRelease: jest.fn(async () => true),
    };
    const useCase = new ReleaseDeleterUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, 'rel-1', 'user-1')
    ).resolves.toBe(true);

    expect(service.deleteRelease).toHaveBeenCalledWith('rel-1', 'user-1');
  });

  it('returns status from service', async () => {
    const service = {
      deleteRelease: jest.fn(async () => 'forbidden'),
    };
    const useCase = new ReleaseDeleterUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, 'rel-1', 'user-1')
    ).resolves.toBe('forbidden');
  });
});
