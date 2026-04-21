import 'reflect-metadata';
import { SectorViewerExistsRepository } from '@core/repositories/sector/SectorViewerExists.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('SectorViewerExistsRepository', () => {
  it('returns false when count query has no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new SectorViewerExistsRepository(db as never);

    await expect(repository.existsSectorById('sec-1', 'acc-1')).resolves.toBe(
      false
    );
  });

  it('returns false when total is zero', async () => {
    const { db } = createSelectDbMock([{ total: 0 }]);
    const repository = new SectorViewerExistsRepository(db as never);

    await expect(repository.existsSectorById('sec-1', 'acc-1')).resolves.toBe(
      false
    );
  });

  it('returns true when total is greater than zero', async () => {
    const { db } = createSelectDbMock([{ total: 1 }]);
    const repository = new SectorViewerExistsRepository(db as never);

    await expect(repository.existsSectorById('sec-1', 'acc-1')).resolves.toBe(
      true
    );
  });
});
