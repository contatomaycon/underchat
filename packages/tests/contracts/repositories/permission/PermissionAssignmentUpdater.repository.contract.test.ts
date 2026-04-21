import 'reflect-metadata';
import { PermissionAssignmentUpdaterRepository } from '@core/repositories/permission/PermissionAssignmentUpdater.repository';

describe('PermissionAssignmentUpdaterRepository', () => {
  it('returns true when one row is updated', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const where = jest.fn(() => ({ execute }));
    const set = jest.fn(() => ({ where }));
    const update = jest.fn(() => ({ set }));

    const repository = new PermissionAssignmentUpdaterRepository({
      update,
    } as never);

    await expect(
      repository.updatePermissionAssignment('user-1', 'role-1')
    ).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith({ permission_role_id: 'role-1' });
  });

  it('returns false when no row is updated', async () => {
    const execute = jest.fn(async () => ({ rowCount: 0 }));
    const where = jest.fn(() => ({ execute }));
    const set = jest.fn(() => ({ where }));
    const update = jest.fn(() => ({ set }));

    const repository = new PermissionAssignmentUpdaterRepository({
      update,
    } as never);

    await expect(
      repository.updatePermissionAssignment('user-1', 'role-1')
    ).resolves.toBe(false);
  });
});
