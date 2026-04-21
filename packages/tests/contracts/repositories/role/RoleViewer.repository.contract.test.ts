import 'reflect-metadata';
import { RoleViewerRepository } from '@core/repositories/role/RoleViewer.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('RoleViewerRepository', () => {
  it('returns null when role is not found', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new RoleViewerRepository(db as never);

    await expect(
      repository.viewRoleById('role-1', 'acc-1')
    ).resolves.toBeNull();
  });

  it('returns mapped role payload', async () => {
    const row = {
      permission_role_id: 'role-1',
      name: 'Admin',
      description: 'desc',
      account: { id: 'acc-1', name: 'Conta' },
      created_at: '2026-04-21T00:00:00.000Z',
    };
    const { db } = createSelectDbMock([row]);
    const repository = new RoleViewerRepository(db as never);

    await expect(repository.viewRoleById('role-1', 'acc-1')).resolves.toEqual(
      row
    );
  });
});
