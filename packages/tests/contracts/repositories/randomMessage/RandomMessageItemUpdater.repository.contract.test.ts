import 'reflect-metadata';
import { RandomMessageItemUpdaterRepository } from '@core/repositories/randomMessage/RandomMessageItemUpdater.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

describe('RandomMessageItemUpdaterRepository', () => {
  it('returns true and updates provided fields with nullable mappings', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new RandomMessageItemUpdaterRepository(db as never);

    await expect(
      repository.updateRandomMessageItemById({
        random_message_item_id: 'rmi-1',
        random_message_id: 'rm-1',
        account_id: 'acc-1',
        message: 'Atualizada',
        status: 'inactive',
        type: 'audio',
        attachment_url: undefined,
        mimetype: undefined,
        duration: undefined,
        width: undefined,
        height: undefined,
      })
    ).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith({
      message: 'Atualizada',
      status: 'inactive',
      type: 'audio',
    });
  });

  it('maps explicit null values and returns false when rowCount is zero', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 0 });
    const repository = new RandomMessageItemUpdaterRepository(db as never);

    await expect(
      repository.updateRandomMessageItemById({
        random_message_item_id: 'rmi-1',
        random_message_id: 'rm-1',
        account_id: 'acc-1',
        attachment_url: null,
        mimetype: null,
        duration: null,
        width: null,
        height: null,
      })
    ).resolves.toBe(false);

    expect(set).toHaveBeenCalledWith({
      attachment_url: null,
      mimetype: null,
      duration: null,
      width: null,
      height: null,
    });
  });
});
