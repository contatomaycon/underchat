import 'reflect-metadata';
import { SectorByIdExistsRepository } from '@core/repositories/sector/SectorByIdExists.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('SectorByIdExistsRepository', () => {
  it('returns false when count query has no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new SectorByIdExistsRepository(db as never);

    await expect(repository.sectorByIdExists('sec-1', 'acc-1')).resolves.toBe(
      false
    );
  });

  it('returns false when total is zero', async () => {
    const { db } = createSelectDbMock([{ total: 0 }]);
    const repository = new SectorByIdExistsRepository(db as never);

    await expect(repository.sectorByIdExists('sec-1', 'acc-1')).resolves.toBe(
      false
    );
  });

  it('returns true when total is greater than zero', async () => {
    const { db } = createSelectDbMock([{ total: 2 }]);
    const repository = new SectorByIdExistsRepository(db as never);

    await expect(repository.sectorByIdExists('sec-1', 'acc-1')).resolves.toBe(
      true
    );
  });
});
