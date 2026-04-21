import 'reflect-metadata';
import { EReleaseStatus } from '@core/common/enums/EReleaseStatus';
import { EReleaseType } from '@core/common/enums/EReleaseType';
import { ReleaseListerRepository } from '@core/repositories/release/ReleaseLister.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('ReleaseListerRepository', () => {
  it('setFilters builds mandatory and conditional filters', () => {
    const repository = new ReleaseListerRepository({} as never, {} as never);

    const filters = (repository as any).setFilters(
      {
        search: 'maintenance',
        type: EReleaseType.warning,
      },
      'acc-1',
      'user-1',
      'role-1',
      '2026-01-01T00:00:00.000Z',
      true
    );

    expect(filters.length).toBeGreaterThanOrEqual(5);
  });

  it('listReleases returns empty list when query has no rows', async () => {
    const selectMock = createSelectDbMock([]);
    const releaseViewViewerRepository = {
      findViewedReleaseIds: jest.fn(),
    };

    const repository = new ReleaseListerRepository(
      selectMock.db as never,
      releaseViewViewerRepository as never
    );

    await expect(
      repository.listReleases(10, 1, {}, 'acc-1', 'user-1', 'role-1', null)
    ).resolves.toEqual([]);

    expect(
      releaseViewViewerRepository.findViewedReleaseIds
    ).not.toHaveBeenCalled();
  });

  it('listReleases maps rows and marks viewed releases', async () => {
    const selectMock = createSelectDbMock([
      {
        release_id: 'rel-1',
        created_by_user_id: 'user-1',
        type: EReleaseType.news,
        status: EReleaseStatus.active,
        title: 'News',
        message: 'Message',
        reminder_at: null,
        created_at: null,
        updated_at: null,
      },
    ]);

    const releaseViewViewerRepository = {
      findViewedReleaseIds: jest.fn(async () => new Set(['rel-1'])),
    };

    const repository = new ReleaseListerRepository(
      selectMock.db as never,
      releaseViewViewerRepository as never
    );

    const result = await repository.listReleases(
      10,
      1,
      {},
      'acc-1',
      'user-1',
      'role-1',
      null
    );

    expect(result[0]).toEqual(
      expect.objectContaining({
        release_id: 'rel-1',
        viewed: true,
      })
    );
  });

  it('listReleasesTotal returns count and zero fallback', async () => {
    const withCount = createSelectDbMock([{ count: 3 }]);
    const withoutRows = createSelectDbMock([]);

    const withCountRepository = new ReleaseListerRepository(
      withCount.db as never,
      {} as never
    );
    const withoutRowsRepository = new ReleaseListerRepository(
      withoutRows.db as never,
      {} as never
    );

    await expect(
      withCountRepository.listReleasesTotal(
        {},
        'acc-1',
        'user-1',
        'role-1',
        null
      )
    ).resolves.toBe(3);

    await expect(
      withoutRowsRepository.listReleasesTotal(
        {},
        'acc-1',
        'user-1',
        'role-1',
        null
      )
    ).resolves.toBe(0);
  });

  it('countUnreadReleases delegates to unread count query', async () => {
    const selectMock = createSelectDbMock([{ count: 7 }]);
    const repository = new ReleaseListerRepository(
      selectMock.db as never,
      {} as never
    );

    await expect(
      repository.countUnreadReleases('acc-1', 'user-1', 'role-1', null)
    ).resolves.toBe(7);
  });
});
