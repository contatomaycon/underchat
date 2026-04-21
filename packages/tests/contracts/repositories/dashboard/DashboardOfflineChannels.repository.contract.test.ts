import 'reflect-metadata';
import { DashboardOfflineChannelsRepository } from '@core/repositories/dashboard/DashboardOfflineChannels.repository';

function createChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const orderBy = jest.fn(() => ({ execute }));
  const where = jest.fn(() => ({ orderBy }));
  const queryBuilder = {
    innerJoin: jest.fn(),
    where,
  } as any;
  queryBuilder.innerJoin.mockReturnValue(queryBuilder);
  queryBuilder.where.mockReturnValue({ orderBy });
  const from = jest.fn(() => queryBuilder);
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('DashboardOfflineChannelsRepository', () => {
  it('returns empty list when no offline channels are found', async () => {
    const chain = createChain([]);
    const repository = new DashboardOfflineChannelsRepository({
      select: chain.select,
    } as never);

    await expect(repository.listOfflineChannels('acc-1')).resolves.toEqual([]);
  });

  it('maps offline channels response', async () => {
    const chain = createChain([
      {
        id: 'w1',
        name: 'Channel',
        status: { id: 'offline', name: 'Offline' },
      },
    ]);
    const repository = new DashboardOfflineChannelsRepository({
      select: chain.select,
    } as never);

    await expect(repository.listOfflineChannels('acc-1')).resolves.toEqual([
      {
        id: 'w1',
        name: 'Channel',
        status: { id: 'offline', name: 'Offline' },
      },
    ]);
  });
});
