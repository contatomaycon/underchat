import 'reflect-metadata';
import { RoleTotalViewerRepository } from '@core/repositories/role/RoleTotalViewer.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('RoleTotalViewerRepository', () => {
  it('returns zero when no rows are returned', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new RoleTotalViewerRepository(db as never);

    await expect(repository.totalRoleByAccount('acc-1')).resolves.toBe(0);
  });

  it('returns total when row exists', async () => {
    const { db } = createSelectDbMock([{ total: 5 }]);
    const repository = new RoleTotalViewerRepository(db as never);

    await expect(repository.totalRoleByAccount('acc-1')).resolves.toBe(5);
  });
});
