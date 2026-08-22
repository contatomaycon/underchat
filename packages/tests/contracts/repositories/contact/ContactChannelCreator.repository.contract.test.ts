import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { ContactChannelCreatorRepository } from '@core/repositories/contact/ContactChannelCreator.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(() => '2026-04-21T12:00:00.000Z'),
}));

describe('ContactChannelCreatorRepository', () => {
  const createWorkerSelect = (found = true) => {
    const chain = {} as Record<string, jest.Mock>;
    for (const method of ['from', 'where', 'for', 'limit']) {
      chain[method] = jest.fn(() => chain);
    }
    chain.execute = jest.fn(async () => (found ? [{ id: 'channel-1' }] : []));
    return jest.fn(() => chain);
  };

  const createInsert = (result: unknown) => {
    const values = jest.fn();
    const chain = {
      onConflictDoNothing: jest.fn(),
      returning: jest.fn(),
      execute: jest.fn(async () => result),
    };
    chain.onConflictDoNothing.mockReturnValue(chain);
    chain.returning.mockReturnValue(chain);
    values.mockReturnValue(chain);
    return { insert: jest.fn(() => ({ values })), values };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('contact-channel-id');
  });

  it('creates contact channel in transaction and returns id', async () => {
    const { insert, values } = createInsert([{ id: 'contact-channel-id' }]);
    const tx = { insert, select: createWorkerSelect() };

    const repository = new ContactChannelCreatorRepository({} as never);

    await expect(
      repository.createContactChannelInTransaction(
        tx as never,
        'contact-1',
        'channel-1',
        'account-1'
      )
    ).resolves.toBe('contact-channel-id');

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        contact_channel_id: 'contact-channel-id',
        contact_id: 'contact-1',
        channel_id: 'channel-1',
        account_id: 'account-1',
        created_at: '2026-04-21T12:00:00.000Z',
        updated_at: '2026-04-21T12:00:00.000Z',
      })
    );
  });

  it('returns null when insert returns null', async () => {
    const { insert } = createInsert([]);
    const tx = { insert, select: createWorkerSelect() };

    const repository = new ContactChannelCreatorRepository({} as never);

    await expect(
      repository.createContactChannelInTransaction(
        tx as never,
        'contact-1',
        'channel-1',
        'account-1'
      )
    ).resolves.toBeNull();
  });

  it('rejects a channel from another account before inserting the relation', async () => {
    const insert = jest.fn();
    const tx = { insert, select: createWorkerSelect(false) };
    const repository = new ContactChannelCreatorRepository({} as never);

    await expect(
      repository.createContactChannelInTransaction(
        tx as never,
        'contact-1',
        'channel-from-another-account',
        'account-1'
      )
    ).rejects.toThrow('contact_channel_not_available');
    expect(insert).not.toHaveBeenCalled();
  });
});
