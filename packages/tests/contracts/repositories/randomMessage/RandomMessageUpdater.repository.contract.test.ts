import 'reflect-metadata';
import { RandomMessageUpdaterRepository } from '@core/repositories/randomMessage/RandomMessageUpdater.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

describe('RandomMessageUpdaterRepository', () => {
  it('returns true and updates only provided fields', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new RandomMessageUpdaterRepository(db as never);

    await expect(
      repository.updateRandomMessageById({
        random_message_id: 'rm-1',
        account_id: 'acc-1',
        name: 'Novo Nome',
        status: null,
      })
    ).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith({
      name: 'Novo Nome',
    });
  });

  it('returns false when update affects no rows', async () => {
    const { db } = createUpdateDbMock({ rowCount: 0 });
    const repository = new RandomMessageUpdaterRepository(db as never);

    await expect(
      repository.updateRandomMessageById({
        random_message_id: 'rm-1',
        account_id: 'acc-1',
        status: 'inactive',
      })
    ).resolves.toBe(false);
  });
});
