import 'reflect-metadata';
import { ReleasePermissionRolesListerRepository } from '@core/repositories/release/ReleasePermissionRolesLister.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('ReleasePermissionRolesListerRepository', () => {
  it('returns empty list when no permission roles are found', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ReleasePermissionRolesListerRepository(db as never);

    await expect(
      repository.listReleasePermissionRoles('acc-1')
    ).resolves.toEqual([]);
  });

  it('returns permission roles when rows are found', async () => {
    const rows = [{ id: 'role-1', name: 'Admin' }];
    const { db } = createSelectDbMock(rows);
    const repository = new ReleasePermissionRolesListerRepository(db as never);

    await expect(
      repository.listReleasePermissionRoles('acc-1')
    ).resolves.toEqual(rows);
  });
});
