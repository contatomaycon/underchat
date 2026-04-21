import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { RandomMessageCreatorRepository } from '@core/repositories/randomMessage/RandomMessageCreator.repository';
import { createInsertDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

describe('RandomMessageCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('random-message-id');
  });

  it('creates random message and returns id', async () => {
    const { db, values } = createInsertDbMock({ rowCount: 1 });
    const repository = new RandomMessageCreatorRepository(db as never);

    await expect(
      repository.createRandomMessage({
        account_id: 'acc-1',
        name: 'Mensagem Aleatoria',
        status: 'active',
      })
    ).resolves.toBe('random-message-id');

    expect(values).toHaveBeenCalledWith({
      random_message_id: 'random-message-id',
      account_id: 'acc-1',
      name: 'Mensagem Aleatoria',
      status: 'active',
    });
  });

  it('returns null when insert result is null', async () => {
    const { db } = createInsertDbMock(null);
    const repository = new RandomMessageCreatorRepository(db as never);

    await expect(
      repository.createRandomMessage({
        account_id: 'acc-1',
        name: 'Mensagem Aleatoria',
        status: 'active',
      })
    ).resolves.toBeNull();
  });
});
