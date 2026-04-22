import 'reflect-metadata';

jest.mock('@core/services/release.service', () => ({
  ReleaseService: class {},
}));

import { ReleaseViewerUseCase } from '@core/useCases/release/ReleaseViewer.useCase';

describe('ReleaseViewerUseCase', () => {
  it('throws when release is not found', async () => {
    const service = {
      viewRelease: jest.fn(async () => null),
    };
    const useCase = new ReleaseViewerUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'rel-1', 'acc-1', 'user-1', 'pr-1')
    ).rejects.toThrow('release_not_found');
  });

  it('returns release when found', async () => {
    const result = { release_id: 'rel-1' };
    const service = {
      viewRelease: jest.fn(async () => result),
    };
    const useCase = new ReleaseViewerUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, 'rel-1', 'acc-1', 'user-1', 'pr-1')
    ).resolves.toEqual(result);
  });
});
