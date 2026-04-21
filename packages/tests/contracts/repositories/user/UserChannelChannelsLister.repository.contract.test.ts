import 'reflect-metadata';
import { UserChannelChannelsListerRepository } from '@core/repositories/user/UserChannelChannelsLister.repository';

function createSelectChain(result: unknown) {
  const execute = jest.fn(async () => result);
  const chain: {
    innerJoin: jest.Mock;
    where: jest.Mock;
    execute: jest.Mock;
  } = {
    innerJoin: jest.fn(),
    where: jest.fn(),
    execute: execute as unknown as jest.Mock,
  };
  chain.innerJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);

  return {
    from: jest.fn(() => chain),
  };
}

describe('UserChannelChannelsListerRepository', () => {
  it('listChannelIdsByUserAndAccount returns mapped ids or empty array', async () => {
    const dbRo = {
      select: jest
        .fn()
        .mockImplementationOnce(() => createSelectChain([]))
        .mockImplementationOnce(() =>
          createSelectChain([{ channel_id: 'w-1' }, { channel_id: 'w-2' }])
        ),
    };
    const repository = new UserChannelChannelsListerRepository(dbRo as never);

    await expect(
      repository.listChannelIdsByUserAndAccount('user-1', 'account-1')
    ).resolves.toEqual([]);
    await expect(
      repository.listChannelIdsByUserAndAccount('user-1', 'account-1')
    ).resolves.toEqual(['w-1', 'w-2']);
  });

  it('listChannelsWithNamesByUserAndAccount returns mapped channels', async () => {
    const dbRo = {
      select: jest.fn(() =>
        createSelectChain([
          { channel_id: 'w-1', name: 'Support' },
          { channel_id: 'w-2', name: 'Sales' },
        ])
      ),
    };
    const repository = new UserChannelChannelsListerRepository(dbRo as never);

    await expect(
      repository.listChannelsWithNamesByUserAndAccount('user-1', 'account-1')
    ).resolves.toEqual([
      { id: 'w-1', name: 'Support' },
      { id: 'w-2', name: 'Sales' },
    ]);
  });

  it('listUserIdsWithAccessToChannel returns mapped user ids and handles empty', async () => {
    const subqueryBuilder = {
      from: jest.fn(() => ({
        innerJoin: jest.fn(() => ({
          where: jest.fn(() => ({ subquery: true })),
        })),
      })),
    };
    const outerChain = {
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          execute: jest.fn(async () => []),
        })),
      })),
    };
    const outerChain2 = {
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          execute: jest.fn(async () => [{ user_id: 'user-1' }]),
        })),
      })),
    };
    const dbRo = {
      select: jest.fn().mockImplementation(() => subqueryBuilder),
      selectDistinct: jest
        .fn()
        .mockImplementationOnce(() => outerChain)
        .mockImplementationOnce(() => outerChain2),
    };
    const repository = new UserChannelChannelsListerRepository(dbRo as never);

    await expect(
      repository.listUserIdsWithAccessToChannel('account-1', 'channel-1')
    ).resolves.toEqual([]);
    await expect(
      repository.listUserIdsWithAccessToChannel('account-1', 'channel-1')
    ).resolves.toEqual(['user-1']);
  });
});
