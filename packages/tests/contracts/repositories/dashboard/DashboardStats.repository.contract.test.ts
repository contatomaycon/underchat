import 'reflect-metadata';
import { DashboardStatsRepository } from '@core/repositories/dashboard/DashboardStats.repository';

function createCountChain(total: number) {
  const execute = jest.fn(async () => [{ total }]);
  const where = jest.fn(() => ({ execute }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select };
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
      } as never
    );

    await expect(repository.getUsersTotal('acc-1')).resolves.toBe(5);
    await expect(repository.getUsersAllowed('acc-1')).resolves.toBe(20);
  });
});
