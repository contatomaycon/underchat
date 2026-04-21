import 'reflect-metadata';
import { RandomMessageItemDeleterRepository } from '@core/repositories/randomMessage/RandomMessageItemDeleter.repository';
import { createDeleteDbMock } from '@core/tests/helpers/drizzleMock';

describe('RandomMessageItemDeleterRepository', () => {
  it('returns true when delete affects rows', async () => {
    const { db } = createDeleteDbMock({ rowCount: 1 });
    const repository = new RandomMessageItemDeleterRepository(db as never);

    await expect(
      repository.deleteRandomMessageItemById('rmi-1', 'rm-1', 'acc-1')
    ).resolves.toBe(true);
  });

  it('returns false when delete affects no rows', async () => {
    const { db } = createDeleteDbMock({ rowCount: 0 });
    const repository = new RandomMessageItemDeleterRepository(db as never);

    await expect(
      repository.deleteRandomMessageItemById('rmi-1', 'rm-1', 'acc-1')
    ).resolves.toBe(false);
  });
});
