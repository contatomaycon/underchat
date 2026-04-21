import 'reflect-metadata';
import { RoleUpdaterRepository } from '@core/repositories/role/RoleUpdater.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

describe('RoleUpdaterRepository', () => {
  it('returns accountId when update affects rows', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new RoleUpdaterRepository(db as never);

    await expect(
      repository.updateRoleById('role-1', 'Novo Nome', 'acc-1', 'desc')
    ).resolves.toBe('acc-1');

    expect(set).toHaveBeenCalledWith({
      name: 'Novo Nome',
      description: 'desc',
    });
  });

  it('stores null description when undefined', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new RoleUpdaterRepository(db as never);

    await repository.updateRoleById('role-1', 'Novo Nome', 'acc-1', undefined);

    expect(set).toHaveBeenCalledWith({
      name: 'Novo Nome',
      description: null,
    });
  });

  it('returns null when update rowCount is zero', async () => {
    const { db } = createUpdateDbMock({ rowCount: 0 });
    const repository = new RoleUpdaterRepository(db as never);

    await expect(
      repository.updateRoleById('role-1', 'Novo Nome', 'acc-1', null)
    ).resolves.toBeNull();
  });
});
