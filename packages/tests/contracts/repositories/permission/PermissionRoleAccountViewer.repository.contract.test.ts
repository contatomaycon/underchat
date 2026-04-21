import 'reflect-metadata';
import { PermissionRoleAccountViewerRepository } from '@core/repositories/permission/PermissionRoleAccountViewer.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('PermissionRoleAccountViewerRepository', () => {
  it('returns null when role account is not found', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new PermissionRoleAccountViewerRepository(db as never);

    await expect(
      repository.getPermissionRoleAccountId('role-1')
    ).resolves.toBeNull();
  });

  it('returns account id when role exists', async () => {
    const { db } = createSelectDbMock([{ account_id: 'acc-1' }]);
    const repository = new PermissionRoleAccountViewerRepository(db as never);

    await expect(repository.getPermissionRoleAccountId('role-1')).resolves.toBe(
      'acc-1'
    );
  });
});
