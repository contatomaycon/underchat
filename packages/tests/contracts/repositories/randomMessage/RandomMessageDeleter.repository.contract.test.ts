import 'reflect-metadata';
import { RandomMessageDeleterRepository } from '@core/repositories/randomMessage/RandomMessageDeleter.repository';
import { createDeleteDbMock } from '@core/tests/helpers/drizzleMock';

describe('RandomMessageDeleterRepository', () => {
  it('returns true when delete affects rows', async () => {
    const { db } = createDeleteDbMock({ rowCount: 1 });
    const repository = new RandomMessageDeleterRepository(db as never);

    await expect(
      repository.deleteRandomMessageById('rm-1', 'acc-1')
    ).resolves.toBe(true);
  });

  it('returns false when delete affects no rows', async () => {
    const { db } = createDeleteDbMock({ rowCount: 0 });
    const repository = new RandomMessageDeleterRepository(db as never);

    await expect(
      repository.deleteRandomMessageById('rm-1', 'acc-1')
    ).resolves.toBe(false);
  });
});
