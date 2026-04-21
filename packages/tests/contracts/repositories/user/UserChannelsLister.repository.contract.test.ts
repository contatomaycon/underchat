import 'reflect-metadata';
import { UserChannelsListerRepository } from '@core/repositories/user/UserChannelsLister.repository';

function createSelectChain(result: unknown) {
  const execute = jest.fn(async () => result);
  const chain: {
    innerJoin: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    execute: jest.Mock;
  } = {
    innerJoin: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    execute: execute as unknown as jest.Mock,
  };

  chain.innerJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);

  return {
    select: jest.fn(() => ({
      from: jest.fn(() => chain),
    })),
  };
}

describe('UserChannelsListerRepository', () => {
  it('returns empty array when query result is undefined', async () => {
    const dbMock = createSelectChain(undefined);
    const repository = new UserChannelsListerRepository(dbMock as never);

    await expect(
      repository.listChannelsByAccount('account-1')
    ).resolves.toEqual([]);
  });

  it('returns empty array when query result is empty', async () => {
    const dbMock = createSelectChain([]);
    const repository = new UserChannelsListerRepository(dbMock as never);

    await expect(
      repository.listChannelsByAccount('account-1')
    ).resolves.toEqual([]);
  });

  it('maps channel rows to response payload', async () => {
    const dbMock = createSelectChain([
      { channel_id: 'w-1', name: 'Support', number: '5511999999999' },
      { channel_id: 'w-2', name: 'Sales', number: '5511888888888' },
    ]);
    const repository = new UserChannelsListerRepository(dbMock as never);

    await expect(
      repository.listChannelsByAccount('account-1')
    ).resolves.toEqual([
      { channel_id: 'w-1', name: 'Support', number: '5511999999999' },
      { channel_id: 'w-2', name: 'Sales', number: '5511888888888' },
    ]);
  });
});
