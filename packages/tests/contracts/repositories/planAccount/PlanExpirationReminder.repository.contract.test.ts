import 'reflect-metadata';
import { PlanExpirationReminderRepository } from '@core/repositories/planAccount/PlanExpirationReminder.repository';

function createSelectChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const innerJoin = jest.fn(() => ({ where }));
  const from = jest.fn(() => ({ innerJoin }));
  const select = jest.fn(() => ({ from }));

  return {
    dbRo: { select },
    where,
  };
}

describe('PlanExpirationReminderRepository', () => {
  it('returns plans expiring in given days', async () => {
    const rows = [
      {
        plan_account_id: 'pa-1',
        account_id: 'acc-1',
        plan_id: 'plan-1',
        next_payment_date: '2026-04-30T12:00:00.000Z',
        days_until_expiration: 5,
      },
    ];
    const { dbRo, where } = createSelectChain(rows);
    const repository = new PlanExpirationReminderRepository(dbRo as never);

    await expect(repository.findPlansExpiringInDays(5)).resolves.toEqual(rows);
    expect(where).toHaveBeenCalledTimes(1);
  });
});
