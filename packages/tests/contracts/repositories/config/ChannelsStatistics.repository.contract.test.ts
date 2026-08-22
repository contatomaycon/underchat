import 'reflect-metadata';
import { ChannelsStatisticsRepository } from '@core/repositories/config/ChannelsStatistics.repository';

function createStatusChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const groupBy = jest.fn(() => ({ execute }));
  const where = jest.fn(() => ({ groupBy }));
  const queryBuilder = {
    innerJoin: jest.fn(),
    leftJoin: jest.fn(),
    where,
  } as any;
  queryBuilder.innerJoin.mockReturnValue(queryBuilder);
  queryBuilder.leftJoin.mockReturnValue(queryBuilder);
  queryBuilder.where.mockReturnValue({ groupBy });
  const from = jest.fn(() => queryBuilder);
  const select = jest.fn(() => ({ from }));

  return { select };
}

function createTotalChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const queryBuilder = {
    innerJoin: jest.fn(),
    where,
  } as any;
  queryBuilder.innerJoin.mockReturnValue(queryBuilder);
  queryBuilder.where.mockReturnValue({ execute });
  const from = jest.fn(() => queryBuilder);
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('ChannelsStatisticsRepository', () => {
  it('returns grouped status counts and total', async () => {
    const statusChain = createStatusChain([
      { status_id: 'active', count: 3 },
      { status_id: 'inactive', count: 1 },
    ]);
    const totalChain = createTotalChain([{ count: 4 }]);
    const dbRw = {
      select: jest
        .fn()
        .mockImplementationOnce(statusChain.select)
        .mockImplementationOnce(totalChain.select),
    };
    const repository = new ChannelsStatisticsRepository(dbRw as never);

    await expect(repository.getChannelsStatistics()).resolves.toEqual({
      statusCounts: [
        { status_id: 'active', count: 3 },
        { status_id: 'inactive', count: 1 },
      ],
      total: 4,
    });
  });
});
