import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { RandomMessageItemCreatorRepository } from '@core/repositories/randomMessage/RandomMessageItemCreator.repository';
import { createInsertDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

describe('RandomMessageItemCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('random-message-item-id');
  });

  it('creates random message item and returns id', async () => {
    const { db, values } = createInsertDbMock({ rowCount: 1 });
    const repository = new RandomMessageItemCreatorRepository(db as never);

    await expect(
      repository.createRandomMessageItem({
        random_message_id: 'rm-1',
        account_id: 'acc-1',
        message: 'Mensagem item',
        status: 'active',
        type: 'text',
      })
    ).resolves.toBe('random-message-item-id');

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        random_message_item_id: 'random-message-item-id',
        random_message_id: 'rm-1',
        account_id: 'acc-1',
      })
    );
  });

  it('returns null when insert result is null', async () => {
    const { db } = createInsertDbMock(null);
    const repository = new RandomMessageItemCreatorRepository(db as never);

    await expect(
      repository.createRandomMessageItem({
        random_message_id: 'rm-1',
        account_id: 'acc-1',
        message: 'Mensagem item',
        status: 'active',
        type: 'text',
      })
    ).resolves.toBeNull();
  });
});
