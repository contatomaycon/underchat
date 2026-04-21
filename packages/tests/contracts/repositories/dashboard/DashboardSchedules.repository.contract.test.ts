import 'reflect-metadata';
import { DashboardSchedulesRepository } from '@core/repositories/dashboard/DashboardSchedules.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'mock-uuid'),
}));

describe('DashboardSchedulesRepository', () => {
  it('delegates getSchedulesSent to getSchedulesSentMonthly', async () => {
    const repository = new DashboardSchedulesRepository(
      {
        select: jest.fn(),
        indices: jest.fn(),
      } as never,
      {
        viewAccountQuantityProduct: jest.fn(),
      } as never,
      {
        findPlanAccountByAccountId: jest.fn(),
      } as never
    );
    jest.spyOn(repository, 'getSchedulesSentMonthly').mockResolvedValue(9);

    await expect(repository.getSchedulesSent('acc-1')).resolves.toBe(9);
  });

  it('returns null renewal date when plan account has no payment date', async () => {
    const repository = new DashboardSchedulesRepository(
      {
        select: jest.fn(),
        indices: jest.fn(),
      } as never,
      {
        viewAccountQuantityProduct: jest.fn(async () => 100),
      } as never,
      {
        findPlanAccountByAccountId: jest.fn(async () => ({
          last_payment_date: null,
        })),
      } as never
    );

    await expect(
      repository.getSchedulesRenewalDate('acc-1')
    ).resolves.toBeNull();
    await expect(repository.getSchedulesAllowed('acc-1')).resolves.toBe(100);
  });
});
