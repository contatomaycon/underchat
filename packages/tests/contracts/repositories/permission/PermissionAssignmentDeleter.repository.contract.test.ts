import 'reflect-metadata';
import { PermissionAssignmentDeleterRepository } from '@core/repositories/permission/PermissionAssignmentDeleter.repository';

describe('PermissionAssignmentDeleterRepository', () => {
  it('returns true when deleting by user id affects rows', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const where = jest.fn(() => ({ execute }));
    const del = jest.fn(() => ({ where }));
    const repository = new PermissionAssignmentDeleterRepository({
      delete: del,
    } as never);

    await expect(
      repository.deletePermissionAssignmentByUserId('user-1')
    ).resolves.toBe(true);
  });

  it('returns false when deleting by user id in tx affects no rows', async () => {
    const execute = jest.fn(async () => ({ rowCount: 0 }));
    const where = jest.fn(() => ({ execute }));
    const del = jest.fn(() => ({ where }));
    const repository = new PermissionAssignmentDeleterRepository({} as never);

    await expect(
      repository.deletePermissionAssignmentByUserIdTx(
        { delete: del } as never,
        'user-1'
      )
    ).resolves.toBe(false);
  });
});
