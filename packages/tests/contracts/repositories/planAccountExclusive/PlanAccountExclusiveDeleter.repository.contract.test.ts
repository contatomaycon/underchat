import 'reflect-metadata';
import { PlanAccountExclusiveDeleterRepository } from '@core/repositories/planAccountExclusive/PlanAccountExclusiveDeleter.repository';
import { createDeleteDbMock } from '@core/tests/helpers/drizzleMock';

describe('PlanAccountExclusiveDeleterRepository', () => {
  it('returns true when one row is deleted', async () => {
    const { db } = createDeleteDbMock({ rowCount: 1 });
    const repository = new PlanAccountExclusiveDeleterRepository(db as never);

    await expect(
      repository.deletePlanAccountExclusiveById('pae-1')
    ).resolves.toBe(true);
  });

  it('returns false when delete rowCount is not one', async () => {
    const { db } = createDeleteDbMock({ rowCount: 0 });
    const repository = new PlanAccountExclusiveDeleterRepository(db as never);

    await expect(
      repository.deletePlanAccountExclusiveById('pae-1')
    ).resolves.toBe(false);
  });
});
