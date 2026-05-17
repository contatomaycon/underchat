import 'reflect-metadata';
import { PlanSalesListerRepository } from '@core/repositories/plan/PlanSalesLister.repository';

function createSelectStep(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const chain: {
    innerJoin: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    execute: jest.Mock;
  } = {
    innerJoin: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    execute: execute as unknown as jest.Mock,
  };

  chain.innerJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  const from = jest.fn(() => chain);
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('PlanSalesListerRepository', () => {
  it('setFilters includes received statuses and optional filters', () => {
    const repository = new PlanSalesListerRepository({} as never);

    const filters = (repository as any).setFilters({
      plan_id: 'plan-1',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      payment_billing_type_id: 'pix',
    });

    expect(filters.length).toBeGreaterThanOrEqual(6);
  });

  it('returns empty list when no payments are found', async () => {
    const paymentsStep = createSelectStep([]);
    const repository = new PlanSalesListerRepository({
      select: paymentsStep.select,
    } as never);

    await expect(repository.listPlanSales({} as never)).resolves.toEqual([]);
  });

  it('builds sales response and subtracts cross-sell totals from plan value', async () => {
    const paymentsStep = createSelectStep([
      {
        account_payment_id: 'pay-1',
        plan_id: 'plan-1',
        plan_name: 'Pro',
        price: '100',
        price_old: '120',
        payment_billing_type_id: 'pix',
        payment_billing_type_name: 'PIX',
        account_id: 'acc-1',
        account_name: 'Account 1',
        payment_value: '130',
        contracted_at: '2026-04-21T10:00:00.000Z',
      },
    ]);

    const crossSellsStep = createSelectStep([
      {
        plan_cross_sell_id: 'cs-1',
        plan_product_name: 'Extra users',
        total_price: '30',
        quantity: 2,
        cross_sell_quantity: 1,
      },
    ]);

    const select = jest
      .fn()
      .mockImplementationOnce(paymentsStep.select)
      .mockImplementationOnce(crossSellsStep.select);

    const repository = new PlanSalesListerRepository({
      select,
    } as never);

    await expect(repository.listPlanSales({} as never)).resolves.toEqual([
      {
        account_payment_id: 'pay-1',
        plan_id: 'plan-1',
        plan_name: 'Pro',
        price: '100',
        price_old: '120',
        total_revenue: '130',
        account_id: 'acc-1',
        account_name: 'Account 1',
        cross_sells: [
          {
            plan_cross_sell_id: 'cs-1',
            plan_product_name: 'Extra users',
            total_price: '30',
            quantity: 2,
            cross_sell_quantity: 1,
          },
        ],
        contracted_at: '2026-04-21T10:00:00.000Z',
        payment_billing_type_name: 'PIX',
      },
    ]);
  });

  it('returns plan sales summary with numeric values', async () => {
    const execute = jest.fn(async () => ({
      rows: [{ total_clients: '3', new_clients: '1' }],
    }));

    const repository = new PlanSalesListerRepository({
      execute,
    } as never);

    await expect(repository.listPlanSalesSummary({} as never)).resolves.toEqual(
      {
        total_clients: 3,
        new_clients: 1,
      }
    );
  });
});
