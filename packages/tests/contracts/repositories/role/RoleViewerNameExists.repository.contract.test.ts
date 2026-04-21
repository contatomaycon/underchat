import 'reflect-metadata';
import { RoleViewerNameExistsRepository } from '@core/repositories/role/RoleViewerNameExists.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('RoleViewerNameExistsRepository', () => {
  it('returns false when no rows are found', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new RoleViewerNameExistsRepository(db as never);

    await expect(repository.existsRoleByName('Admin', 'acc-1')).resolves.toBe(
      false
    );
  });

  it('returns false when total is zero', async () => {
    const { db } = createSelectDbMock([{ total: 0 }]);
    const repository = new RoleViewerNameExistsRepository(db as never);

    await expect(repository.existsRoleByName('Admin', 'acc-1')).resolves.toBe(
      false
    );
  });

  it('returns true when total is greater than zero', async () => {
    const { db } = createSelectDbMock([{ total: 1 }]);
    const repository = new RoleViewerNameExistsRepository(db as never);

    await expect(repository.existsRoleByName('Admin', 'acc-1')).resolves.toBe(
      true
    );
  });
});
