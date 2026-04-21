import 'reflect-metadata';
import { DashboardContactsRepository } from '@core/repositories/dashboard/DashboardContacts.repository';

describe('DashboardContactsRepository', () => {
  it('throws when accountId is invalid', async () => {
    const repository = new DashboardContactsRepository({
      execute: jest.fn(),
    } as never);

    await expect(
      repository.getContactsGrowthMonthly('' as never)
    ).rejects.toThrow('accountId is required and must be a string');
  });

  it('returns 12-month series based on query rows', async () => {
    const dbRo = {
      execute: jest.fn(async () => ({
        rows: [{ total: 20 }, { total: 21 }],
      })),
    };
    const repository = new DashboardContactsRepository(dbRo as never);

    const result = await repository.getContactsGrowthMonthly('acc-1');

    expect(result).toHaveLength(12);
    expect(result[0]?.total).toBe(20);
  });
});
