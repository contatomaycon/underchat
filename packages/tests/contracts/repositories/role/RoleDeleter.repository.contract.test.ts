import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { RoleDeleterRepository } from '@core/repositories/role/RoleDeleter.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(() => '2026-04-21T12:00:00.000Z'),
}));

describe('RoleDeleterRepository', () => {
  it('returns true when one row is updated', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new RoleDeleterRepository(db as never);

    await expect(repository.deleteRoleById('role-1', 'acc-1')).resolves.toBe(
      true
    );
    expect(currentTime).toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith({
      deleted_at: '2026-04-21T12:00:00.000Z',
    });
  });

  it('returns false when update rowCount is zero', async () => {
    const { db } = createUpdateDbMock({ rowCount: 0 });
    const repository = new RoleDeleterRepository(db as never);

    await expect(repository.deleteRoleById('role-1', 'acc-1')).resolves.toBe(
      false
    );
  });
});
