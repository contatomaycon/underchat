import 'reflect-metadata';
import { PermissionAssignmentViewerRepository } from '@core/repositories/permission/PermissionAssignmentViewer.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('PermissionAssignmentViewerRepository', () => {
  it('returns null when user has no role', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new PermissionAssignmentViewerRepository(db as never);

    await expect(repository.getUserRole('user-1')).resolves.toBeNull();
  });

  it('returns permission role id when found', async () => {
    const { db } = createSelectDbMock([{ permission_role_id: 'role-1' }]);
    const repository = new PermissionAssignmentViewerRepository(db as never);

    await expect(repository.getUserRole('user-1')).resolves.toBe('role-1');
  });
});
