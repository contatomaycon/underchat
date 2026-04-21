import 'reflect-metadata';
import { ReleaseUsersListerRepository } from '@core/repositories/release/ReleaseUsersLister.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('ReleaseUsersListerRepository', () => {
  it('returns empty list when no users are found', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ReleaseUsersListerRepository(db as never);

    await expect(repository.listReleaseUsers('acc-1')).resolves.toEqual([]);
  });

  it('maps users and falls back to user_id when name is null', async () => {
    const { db } = createSelectDbMock([
      {
        user_id: 'user-1',
        name: 'John',
      },
      {
        user_id: 'user-2',
        name: null,
      },
    ]);
    const repository = new ReleaseUsersListerRepository(db as never);

    await expect(repository.listReleaseUsers('acc-1')).resolves.toEqual([
      {
        user_id: 'user-1',
        name: 'John',
      },
      {
        user_id: 'user-2',
        name: 'user-2',
      },
    ]);
  });
});
