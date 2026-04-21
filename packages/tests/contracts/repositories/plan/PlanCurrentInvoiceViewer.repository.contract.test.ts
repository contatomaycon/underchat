import 'reflect-metadata';
import { PlanCurrentInvoiceViewerRepository } from '@core/repositories/plan/PlanCurrentInvoiceViewer.repository';

describe('PlanCurrentInvoiceViewerRepository', () => {
  it('returns empty response when account has no plan account', async () => {
    const repository = new PlanCurrentInvoiceViewerRepository({} as never);
    (repository as any).findAccountWithPlanAccounts = jest.fn(async () => ({
      account_status_id: null,
      apc: [],
    }));

    const result = await repository.viewCurrentPlanInvoice('a-1');
    expect(result.plan_id).toBeNull();
    expect(result.current_total_cycle_value).toBeNull();
  });

  it('calculateBasePlanCycleValue handles test plan and annual discount', () => {
    const repository = new PlanCurrentInvoiceViewerRepository({} as never);

    expect(
      (repository as any).calculateBasePlanCycleValue({
        planPrice: '100',
        annualDiscount: '10',
        isTestPlan: false,
        billingPeriodValue: 'annual',
      })
    ).toBe(1080);
    expect(
      (repository as any).calculateBasePlanCycleValue({
        planPrice: '100',
        annualDiscount: '10',
        isTestPlan: true,
        billingPeriodValue: 'annual',
      })
    ).toBe(0);
  });

  it('findCurrentTotalCycleValue sums plan cycle and active addons', async () => {
    const repository = new PlanCurrentInvoiceViewerRepository({
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          innerJoin: jest.fn(() => ({
            where: jest.fn(() => ({
              execute: jest.fn(async () => [{ price: '20' }, { price: '5' }]),
            })),
          })),
        })),
      })),
    } as never);

    await expect(
      (repository as any).findCurrentTotalCycleValue({
        accountId: 'a-1',
        planPrice: '100',
        annualDiscount: null,
        isTestPlan: false,
        billingPeriodValue: 'monthly',
      })
    ).resolves.toBe(125);
  });

  it('viewCurrentPlanInvoice builds invoice payload from plan account data', async () => {
    const repository = new PlanCurrentInvoiceViewerRepository({} as never);
    (repository as any).findAccountWithPlanAccounts = jest.fn(async () => ({
      account_status_id: 'active',
      apc: [
        {
          ppl: {
            plan_id: 'p-1',
            name: 'Pro',
            price: '100',
            price_old: '120',
            description: 'desc',
            annual_discount: '10',
            icon: 'icon',
            is_test: false,
          },
          bpl: { name: 'monthly' },
          value: '100',
          recurring_payment: true,
          cancellation_date: null,
          last_payment_date: '2026-04-20',
          next_payment_date: '2026-05-20',
        },
      ],
    }));
    (repository as any).findLastPaidInvoiceValue = jest.fn(async () => '90');
    (repository as any).findCurrentTotalCycleValue = jest.fn(async () => 110);

    const result = await repository.viewCurrentPlanInvoice('a-1');
    expect(result.plan_id).toBe('p-1');
    expect(result.last_paid_invoice_value).toBe(90);
    expect(result.current_total_cycle_value).toBe(110);
    expect(result.account_status_id).toBe('active');
  });
});
