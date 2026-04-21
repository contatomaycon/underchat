import 'reflect-metadata';
import { PlanWithItemsListerRepository } from '@core/repositories/plan/PlanWithItemsLister.repository';

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

  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  const from = jest.fn(() => chain);
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('PlanWithItemsListerRepository', () => {
  it('returns empty list when no plans are found', async () => {
    const plansStep = createSelectStep([]);
    const select = jest.fn().mockImplementationOnce(plansStep.select);

    const repository = new PlanWithItemsListerRepository({ select } as never);

    await expect(repository.listPlanWithItems(null)).resolves.toEqual([]);
  });

  it('returns plans with grouped plan items', async () => {
    const exclusiveIdsStep = createSelectStep([{ plan_id: 'plan-2' }]);
    const plansStep = createSelectStep([
      {
        plan_id: 'plan-1',
        name: 'Starter',
        price: '19.9',
        price_old: '29.9',
        description: null,
        annual_discount: null,
        icon: null,
        is_test: false,
        days_trial: 7,
        is_exclusive: false,
        status: 'active',
        created_at: '2026-04-21T10:00:00.000Z',
      },
    ]);
    const itemsStep = createSelectStep([
      {
        plan_item_id: 'pi-1',
        plan_id: 'plan-1',
        plan_product_id: 'prod-1',
        quantity: 2,
        created_at: '2026-04-21T10:10:00.000Z',
        plan_product: {
          plan_product_id: 'prod-1',
          name: 'Agents',
          description: 'Extra agents',
        },
      },
    ]);

    const select = jest
      .fn()
      .mockImplementationOnce(exclusiveIdsStep.select)
      .mockImplementationOnce(plansStep.select)
      .mockImplementationOnce(itemsStep.select);

    const repository = new PlanWithItemsListerRepository({ select } as never);

    await expect(repository.listPlanWithItems('acc-1')).resolves.toEqual([
      {
        plan_id: 'plan-1',
        name: 'Starter',
        price: 19.9,
        price_old: 29.9,
        description: null,
        annual_discount: null,
        icon: null,
        is_test: false,
        days_trial: 7,
        is_exclusive: false,
        status: 'active',
        created_at: '2026-04-21T10:00:00.000Z',
        plan_items: [
          {
            plan_item_id: 'pi-1',
            plan_id: 'plan-1',
            plan_product_id: 'prod-1',
            quantity: 2,
            created_at: '2026-04-21T10:10:00.000Z',
            plan_product: {
              plan_product_id: 'prod-1',
              name: 'Agents',
              description: 'Extra agents',
            },
          },
        ],
      },
    ]);
  });

  it('buildExclusivePlanFilter falls back to non-exclusive when no ids', () => {
    const repository = new PlanWithItemsListerRepository({} as never);

    const condition = (repository as any).buildExclusivePlanFilter([]);

    expect(condition).toBeDefined();
  });
});
