import 'reflect-metadata';
import { PlanCurrentViewerRepository } from '@core/repositories/plan/PlanCurrentViewer.repository';

jest.mock('@core/common/functions/calculateBillingPeriodByDates', () => ({
  calculateBillingPeriodByDates: jest.fn(() => 'monthly'),
}));

describe('PlanCurrentViewerRepository', () => {
  it('returns null payload when account is not found', async () => {
    const repository = new PlanCurrentViewerRepository({
      query: {
        account: {
          findFirst: jest.fn(async () => null),
        },
      },
    } as never);

    await expect(repository.viewCurrentPlan('acc-1')).resolves.toEqual({
      plan_id: null,
      billing_period: null,
      next_payment_date: null,
      last_payment_date: null,
    });
  });

  it('returns null payload when no active plan account exists', async () => {
    const repository = new PlanCurrentViewerRepository({
      query: {
        account: {
          findFirst: jest.fn(async () => ({
            account_id: 'acc-1',
            apc: [
              {
                next_payment_date: '2020-01-01T00:00:00.000Z',
                last_payment_date: '2019-12-01T00:00:00.000Z',
                ppl: { plan_id: 'plan-1' },
                bpl: null,
              },
            ],
          })),
        },
      },
    } as never);

    await expect(repository.viewCurrentPlan('acc-1')).resolves.toEqual({
      plan_id: null,
      billing_period: null,
      next_payment_date: null,
      last_payment_date: null,
    });
  });

  it('returns active plan with billing period from bpl name', async () => {
    const repository = new PlanCurrentViewerRepository({
      query: {
        account: {
          findFirst: jest.fn(async () => ({
            account_id: 'acc-1',
            apc: [
              {
                next_payment_date: '2999-01-01T00:00:00.000Z',
                last_payment_date: '2026-01-01T00:00:00.000Z',
                ppl: { plan_id: 'plan-1' },
                bpl: { name: 'annual' },
              },
            ],
          })),
        },
      },
    } as never);

    await expect(repository.viewCurrentPlan('acc-1')).resolves.toEqual({
      plan_id: 'plan-1',
      billing_period: 'annual',
      next_payment_date: '2999-01-01T00:00:00.000Z',
      last_payment_date: '2026-01-01T00:00:00.000Z',
    });
  });

  it('returns billing_period null when calculated period is unsupported', async () => {
    const repository = new PlanCurrentViewerRepository({
      query: {
        account: {
          findFirst: jest.fn(async () => ({
            account_id: 'acc-1',
            apc: [
              {
                next_payment_date: '2999-01-01T00:00:00.000Z',
                last_payment_date: '2026-01-01T00:00:00.000Z',
                ppl: { plan_id: null },
                bpl: { name: 'weekly' },
              },
            ],
          })),
        },
      },
    } as never);

    await expect(repository.viewCurrentPlan('acc-1')).resolves.toEqual({
      plan_id: null,
      billing_period: null,
      next_payment_date: '2999-01-01T00:00:00.000Z',
      last_payment_date: '2026-01-01T00:00:00.000Z',
    });
  });
});
