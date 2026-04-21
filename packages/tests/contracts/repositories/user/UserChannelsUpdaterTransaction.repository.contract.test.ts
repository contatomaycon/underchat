import 'reflect-metadata';
import { UserChannelsUpdaterTransactionRepository } from '@core/repositories/user/UserChannelsUpdaterTransaction.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'mocked-uuid'),
}));

describe('UserChannelsUpdaterTransactionRepository', () => {
  it('deletes existing channels and returns true when channelIds is empty', async () => {
    const deleteExecute = jest.fn(async () => ({ rowCount: 2 }));
    const tx = {
      delete: jest.fn(() => ({
        where: jest.fn(() => ({
          execute: deleteExecute,
        })),
      })),
    };

    const repository = new UserChannelsUpdaterTransactionRepository(
      {
        transaction: jest.fn(async (callback) => callback(tx)),
      } as never,
      {
        createUserChannelInTransaction: jest.fn(),
      } as never
    );

    await expect(
      repository.updateUserChannels('user-1', 'account-1', [])
    ).resolves.toBe(true);
    expect(deleteExecute).toHaveBeenCalledTimes(1);
  });

  it('creates all new channels when channelIds is provided', async () => {
    const createUserChannelInTransaction = jest.fn(async () => 'uc-1');
    const tx = {
      delete: jest.fn(() => ({
        where: jest.fn(() => ({
          execute: jest.fn(async () => ({ rowCount: 1 })),
        })),
      })),
    };

    const repository = new UserChannelsUpdaterTransactionRepository(
      {
        transaction: jest.fn(async (callback) => callback(tx)),
      } as never,
      {
        createUserChannelInTransaction,
      } as never
    );

    await expect(
      repository.updateUserChannels('user-1', 'account-1', [
        'channel-1',
        'channel-2',
      ])
    ).resolves.toBe(true);

    expect(createUserChannelInTransaction).toHaveBeenCalledTimes(2);
    expect(createUserChannelInTransaction).toHaveBeenNthCalledWith(
      1,
      tx,
      'user-1',
      'channel-1',
      'account-1'
    );
  });
});
