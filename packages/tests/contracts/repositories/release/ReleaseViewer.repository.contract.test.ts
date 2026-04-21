import 'reflect-metadata';
import { EReleaseStatus } from '@core/common/enums/EReleaseStatus';
import { EReleaseType } from '@core/common/enums/EReleaseType';
import { ReleaseViewerRepository } from '@core/repositories/release/ReleaseViewer.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('ReleaseViewerRepository', () => {
  it('returns null when release is not found or not accessible', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ReleaseViewerRepository(db as never);

    await expect(
      repository.viewRelease('rel-1', 'acc-1', 'user-1', 'role-1', null)
    ).resolves.toBeNull();
  });

  it('returns mapped release response', async () => {
    const { db } = createSelectDbMock([
      {
        release_id: 'rel-1',
        account_id: 'acc-1',
        created_by_user_id: 'user-1',
        type: EReleaseType.news,
        status: EReleaseStatus.active,
        title: 'News',
        message: 'Message',
        reminder_at: null,
        created_at: null,
        updated_at: null,
        viewed: true,
      },
    ]);

    const repository = new ReleaseViewerRepository(db as never);

    const result = await repository.viewRelease(
      'rel-1',
      'acc-1',
      'user-1',
      'role-1',
      null
    );

    expect(result).toEqual(
      expect.objectContaining({
        release_id: 'rel-1',
        viewed: true,
        type: EReleaseType.news,
        status: EReleaseStatus.active,
      })
    );
    expect(result?.created_at).toEqual(expect.any(String));
    expect(result?.updated_at).toEqual(expect.any(String));
  });
});
