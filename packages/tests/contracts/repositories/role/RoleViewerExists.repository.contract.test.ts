import 'reflect-metadata';
import { RoleViewerExistsRepository } from '@core/repositories/role/RoleViewerExists.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('RoleViewerExistsRepository', () => {
  it('returns false when no rows are found', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new RoleViewerExistsRepository(db as never);

    await expect(repository.existsRoleById('role-1', 'acc-1')).resolves.toBe(
      false
    );
  });

  it('returns false when total is zero', async () => {
    const { db } = createSelectDbMock([{ total: 0 }]);
    const repository = new RoleViewerExistsRepository(db as never);

    await expect(repository.existsRoleById('role-1', 'acc-1')).resolves.toBe(
      false
    );
  });

  it('returns true when total is greater than zero', async () => {
    const { db } = createSelectDbMock([{ total: 1 }]);
    const repository = new RoleViewerExistsRepository(db as never);

    await expect(repository.existsRoleById('role-1', 'acc-1')).resolves.toBe(
      true
    );
  });
});
