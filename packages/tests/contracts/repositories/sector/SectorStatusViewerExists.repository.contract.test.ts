import 'reflect-metadata';
import { SectorStatusViewerExistsRepository } from '@core/repositories/sector/SectorStatusViewerExists.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('SectorStatusViewerExistsRepository', () => {
  it('returns false when count query has no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new SectorStatusViewerExistsRepository(db as never);

    await expect(repository.existsSectorStatusById('status-1')).resolves.toBe(
      false
    );
  });

  it('returns false when total is zero', async () => {
    const { db } = createSelectDbMock([{ total: 0 }]);
    const repository = new SectorStatusViewerExistsRepository(db as never);

    await expect(repository.existsSectorStatusById('status-1')).resolves.toBe(
      false
    );
  });

  it('returns true when total is greater than zero', async () => {
    const { db } = createSelectDbMock([{ total: 1 }]);
    const repository = new SectorStatusViewerExistsRepository(db as never);

    await expect(repository.existsSectorStatusById('status-1')).resolves.toBe(
      true
    );
  });
});
