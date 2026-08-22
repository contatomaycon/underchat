import 'reflect-metadata';
import { DashboardStatsRepository } from '@core/repositories/dashboard/DashboardStats.repository';

function createCountChain(total: number) {
  const execute = jest.fn(async () => [{ total }]);
  const where = jest.fn(() => ({ execute }));
  const query = {
    leftJoin: jest.fn(),
    where,
  };
  query.leftJoin.mockReturnValue(query);
  const from = jest.fn(() => query);
  const select = jest.fn(() => ({ from }));

  return { select, leftJoin: query.leftJoin };
}

describe('DashboardStatsRepository', () => {
  it('returns users total discounting owner user', async () => {
    const chain = createCountChain(6);
    const repository = new DashboardStatsRepository(
      {
        select: chain.select,
      } as never,
      {
        viewAccountQuantityProduct: jest.fn(async () => 20),
      } as never,
      { select: chain.select } as never
    );

    await expect(repository.getUsersTotal('acc-1')).resolves.toBe(5);
    // The plan quantity excludes the account owner, which is always allowed.
    await expect(repository.getUsersAllowed('acc-1')).resolves.toBe(21);
  });

  it('counts only the shared effective ONLINE projection', async () => {
    const chain = createCountChain(2);
    const repository = new DashboardStatsRepository(
      { select: jest.fn() } as never,
      { viewAccountQuantityProduct: jest.fn() } as never,
      { select: chain.select } as never
    );

    await expect(repository.getChannelsConnected('acc-1')).resolves.toBe(2);
    expect(chain.leftJoin).toHaveBeenCalledTimes(2);
  });
});
