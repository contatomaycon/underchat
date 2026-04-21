import 'reflect-metadata';
import { UserChannelCreatorRepository } from '@core/repositories/user/UserChannelCreator.repository';
import { currentTime } from '@core/common/functions/currentTime';
import { v7 as uuidv7 } from 'uuid';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('UserChannelCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as jest.Mock).mockReturnValue('user-channel-id-1');
    (currentTime as jest.Mock).mockReturnValue('2026-04-21T10:00:00.000Z');
  });

  it('returns created user_channel_id when insert returns result', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const values = jest.fn(() => ({ execute }));
    const tx = {
      insert: jest.fn(() => ({ values })),
    } as never;
    const repository = new UserChannelCreatorRepository({} as never);

    await expect(
      repository.createUserChannelInTransaction(
        tx,
        'user-1',
        'channel-1',
        'account-1'
      )
    ).resolves.toBe('user-channel-id-1');

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        user_channel_id: 'user-channel-id-1',
        user_id: 'user-1',
        channel_id: 'channel-1',
        account_id: 'account-1',
        created_at: '2026-04-21T10:00:00.000Z',
      })
    );
  });

  it('returns null when insert result is null', async () => {
    const repository = new UserChannelCreatorRepository({} as never);
    const tx = {
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          execute: jest.fn(async () => null),
        })),
      })),
    } as never;

    await expect(
      repository.createUserChannelInTransaction(
        tx,
        'user-1',
        'channel-1',
        'account-1'
      )
    ).resolves.toBeNull();
  });
});
