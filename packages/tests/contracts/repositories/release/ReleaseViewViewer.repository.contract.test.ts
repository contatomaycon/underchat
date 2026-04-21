import 'reflect-metadata';
import { ReleaseViewViewerRepository } from '@core/repositories/release/ReleaseViewViewer.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('ReleaseViewViewerRepository', () => {
  it('existsReleaseView returns false when record is missing', async () => {
    const repository = new ReleaseViewViewerRepository({
      query: {
        releaseView: {
          findFirst: jest.fn(async () => null),
        },
      },
      select: jest.fn(),
    } as never);

    await expect(
      repository.existsReleaseView('release-1', 'user-1')
    ).resolves.toBe(false);
  });

  it('existsReleaseView returns true when record exists', async () => {
    const repository = new ReleaseViewViewerRepository({
      query: {
        releaseView: {
          findFirst: jest.fn(async () => ({ release_view_id: 'rv-1' })),
        },
      },
      select: jest.fn(),
    } as never);

    await expect(
      repository.existsReleaseView('release-1', 'user-1')
    ).resolves.toBe(true);
  });

  it('findViewedReleaseIds returns empty set when release ids are empty', async () => {
    const repository = new ReleaseViewViewerRepository({
      query: {
        releaseView: {
          findFirst: jest.fn(),
        },
      },
      select: jest.fn(),
    } as never);

    await expect(
      repository.findViewedReleaseIds([], 'user-1')
    ).resolves.toEqual(new Set());
  });

  it('findViewedReleaseIds returns set of viewed ids', async () => {
    const selectMock = createSelectDbMock([
      { release_id: 'release-1' },
      { release_id: 'release-2' },
    ]);

    const repository = new ReleaseViewViewerRepository({
      query: {
        releaseView: {
          findFirst: jest.fn(),
        },
      },
      select: selectMock.db.select,
    } as never);

    await expect(
      repository.findViewedReleaseIds(['release-1', 'release-2'], 'user-1')
    ).resolves.toEqual(new Set(['release-1', 'release-2']));
  });
});
