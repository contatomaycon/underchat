import 'reflect-metadata';
import { PermissionRoleViewerExistsRepository } from '@core/repositories/permission/PermissionRoleViewerExists.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('PermissionRoleViewerExistsRepository', () => {
  it('returns false when no rows are returned', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new PermissionRoleViewerExistsRepository(db as never);

    await expect(
      repository.existsPermissionRoleById('acc-1', 'role-1')
    ).resolves.toBe(false);
  });

  it('returns false when total is zero', async () => {
    const { db } = createSelectDbMock([{ total: 0 }]);
    const repository = new PermissionRoleViewerExistsRepository(db as never);

    await expect(
      repository.existsPermissionRoleById('acc-1', 'role-1')
    ).resolves.toBe(false);
  });

  it('returns true when total is greater than zero', async () => {
    const { db } = createSelectDbMock([{ total: 1 }]);
    const repository = new PermissionRoleViewerExistsRepository(db as never);

    await expect(
      repository.existsPermissionRoleById('acc-1', 'role-1')
    ).resolves.toBe(true);
  });
});
