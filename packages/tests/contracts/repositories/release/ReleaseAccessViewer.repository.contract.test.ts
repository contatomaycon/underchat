import 'reflect-metadata';
import { ReleaseAccessViewerRepository } from '@core/repositories/release/ReleaseAccessViewer.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('ReleaseAccessViewerRepository', () => {
  it('returns false when no access row exists', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ReleaseAccessViewerRepository(db as never);

    await expect(
      repository.existsReleaseAccessByUserId('release-1', 'user-1')
    ).resolves.toBe(false);
  });

  it('returns true when access row exists', async () => {
    const { db } = createSelectDbMock([{ release_access_id: 'ra-1' }]);
    const repository = new ReleaseAccessViewerRepository(db as never);

    await expect(
      repository.existsReleaseAccessByUserId('release-1', 'user-1')
    ).resolves.toBe(true);
  });
});
