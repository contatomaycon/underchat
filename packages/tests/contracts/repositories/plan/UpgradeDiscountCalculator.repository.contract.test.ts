import 'reflect-metadata';
import { UpgradeDiscountCalculatorRepository } from '@core/repositories/plan/UpgradeDiscountCalculator.repository';

jest.mock('@core/common/functions/calculateBillingPeriodByDates', () => ({
  calculateBillingPeriodByDates: jest.fn(() => 'monthly'),
}));

describe('UpgradeDiscountCalculatorRepository', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-21T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns empty response when account has no active paid plan', async () => {
    const repository = new UpgradeDiscountCalculatorRepository({
      query: {
        account: {
          findFirst: jest.fn(async () => null),
        },
        plan: {
          findFirst: jest.fn(),
        },
      },
    } as never);

    await expect(
      repository.calculateUpgradeDiscount('acc-1', 'plan-2')
    ).resolves.toEqual({
      discount: 0,
      current_plan_price: 0,
      days_used: 0,
      days_remaining: 0,
      total_days: 0,
      is_upgrade: false,
    });
  });

  it('returns no discount when new plan is not found', async () => {
    const repository = new UpgradeDiscountCalculatorRepository({
      query: {
        account: {
          findFirst: jest.fn(async () => ({
            account_id: 'acc-1',
            apc: [
              {
                next_payment_date: '2026-05-01T00:00:00.000Z',
                last_payment_date: '2026-04-01T00:00:00.000Z',
                value: '30',
                ppl: {
                  plan_id: 'plan-1',
                  price: '10',
                },
                bpl: {
                  name: 'monthly',
                },
              },
            ],
          })),
        },
        plan: {
          findFirst: jest.fn(async () => null),
        },
      },
    } as never);

    await expect(
      repository.calculateUpgradeDiscount('acc-1', 'plan-2')
    ).resolves.toEqual({
      discount: 0,
      current_plan_price: 30,
      days_used: 0,
      days_remaining: 0,
      total_days: 0,
      is_upgrade: false,
    });
  });

  it('returns no discount when new plan is not an upgrade', async () => {
    const repository = new UpgradeDiscountCalculatorRepository({
      query: {
        account: {
          findFirst: jest.fn(async () => ({
            account_id: 'acc-1',
            apc: [
              {
                next_payment_date: '2026-05-01T00:00:00.000Z',
                last_payment_date: '2026-04-01T00:00:00.000Z',
                value: '30',
                ppl: {
                  plan_id: 'plan-1',
                  price: '10',
                },
                bpl: {
                  name: 'monthly',
                },
              },
            ],
          })),
        },
        plan: {
          findFirst: jest.fn(async () => ({
            plan_id: 'plan-2',
            price: '9',
            annual_discount: null,
          })),
        },
      },
    } as never);

    await expect(
      repository.calculateUpgradeDiscount('acc-1', 'plan-2')
    ).resolves.toEqual({
      discount: 0,
      current_plan_price: 30,
      days_used: 0,
      days_remaining: 0,
      total_days: 0,
      is_upgrade: false,
    });
  });

  it('calculates prorated discount when upgrade is valid', async () => {
    const repository = new UpgradeDiscountCalculatorRepository({
      query: {
        account: {
          findFirst: jest.fn(async () => ({
            account_id: 'acc-1',
            apc: [
              {
                next_payment_date: '2026-05-01T00:00:00.000Z',
                last_payment_date: '2026-04-01T00:00:00.000Z',
                value: '30',
                ppl: {
                  plan_id: 'plan-1',
                  price: '10',
                },
                bpl: {
                  name: 'monthly',
                },
              },
            ],
          })),
        },
        plan: {
          findFirst: jest.fn(async () => ({
            plan_id: 'plan-2',
            price: '20',
            annual_discount: null,
          })),
        },
      },
    } as never);

    const result = await repository.calculateUpgradeDiscount('acc-1', 'plan-2');

    expect(result.is_upgrade).toBe(true);
    expect(result.current_plan_price).toBe(30);
    expect(result.total_days).toBeGreaterThan(0);
    expect(result.days_remaining).toBeGreaterThan(0);
    expect(result.discount).toBeGreaterThan(0);
  });
});
