import 'reflect-metadata';

jest.mock('@core/services/release.service', () => ({
  ReleaseService: class {},
}));

import { ReleaseUpdaterUseCase } from '@core/useCases/release/ReleaseUpdater.useCase';

describe('ReleaseUpdaterUseCase', () => {
  it('delegates release update', async () => {
    const input = { title: 'Updated' } as never;
    const service = {
      updateRelease: jest.fn(async () => true),
    };
    const useCase = new ReleaseUpdaterUseCase(service as never);

    await expect(useCase.execute('rel-1', 'user-1', input)).resolves.toBe(true);
    expect(service.updateRelease).toHaveBeenCalledWith(
      'rel-1',
      'user-1',
      input
    );
  });

  it('returns status from service', async () => {
    const service = {
      updateRelease: jest.fn(async () => 'invalid_reminder'),
    };
    const useCase = new ReleaseUpdaterUseCase(service as never);

    await expect(useCase.execute('rel-1', 'user-1', {} as never)).resolves.toBe(
      'invalid_reminder'
    );
  });
});
