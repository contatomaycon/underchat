import 'reflect-metadata';
import { PermissionAssignmentExistsRepository } from '@core/repositories/permission/PermissionAssignmentExists.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('PermissionAssignmentExistsRepository', () => {
  it('returns false when there are no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new PermissionAssignmentExistsRepository(db as never);

    await expect(
      repository.existsPermissionAssignment('user-1', 'role-1')
    ).resolves.toBe(false);
  });

  it('returns false when count is zero', async () => {
    const { db } = createSelectDbMock([{ total: 0 }]);
    const repository = new PermissionAssignmentExistsRepository(db as never);

    await expect(
      repository.existsPermissionAssignment('user-1', 'role-1')
    ).resolves.toBe(false);
  });

  it('returns true when count is greater than zero', async () => {
    const { db } = createSelectDbMock([{ total: 1 }]);
    const repository = new PermissionAssignmentExistsRepository(db as never);

    await expect(
      repository.existsPermissionAssignment('user-1', 'role-1')
    ).resolves.toBe(true);
  });
});
