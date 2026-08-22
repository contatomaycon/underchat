import 'reflect-metadata';
import { AccountQuantityProductViewerRepository } from '@core/repositories/account/AccountQuantityProductViewer.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('AccountQuantityProductViewerRepository', () => {
  const createPlanDbMock = (
    currentPlan:
      | {
          next_payment_date: string | null;
          pac: {
            deleted_at: string | null;
          } | null;
          ppl: {
            deleted_at: string | null;
            ppi: {
              plan_product_id: string;
              quantity: number;
              deleted_at: string | null;
            }[];
          } | null;
        }
      | undefined
  ) => ({
    query: {
      planAccount: {
        findFirst: jest.fn(async (_query: unknown) => currentPlan),
      },
    },
  });

  it('viewPlanQuantity sums valid items from the deterministic current plan', async () => {
    const db = createPlanDbMock({
      next_payment_date: '2999-01-01T00:00:00.000Z',
      pac: {
        deleted_at: null,
      },
      ppl: {
        deleted_at: null,
        ppi: [
          {
            plan_product_id: 'product-1',
            quantity: 2,
            deleted_at: null,
          },
          {
            plan_product_id: 'product-1',
            quantity: 3,
            deleted_at: null,
          },
          {
            plan_product_id: 'product-1',
            quantity: 100,
            deleted_at: '2026-01-01T00:00:00.000Z',
          },
          {
            plan_product_id: 'another-product',
            quantity: 100,
            deleted_at: null,
          },
        ],
      },
    });
    const repository = new AccountQuantityProductViewerRepository(db as never);

    await expect(
      repository.viewPlanQuantity('acc-1', 'product-1')
    ).resolves.toBe(5);

    const query = db.query.planAccount.findFirst.mock.calls[0]?.[0] as {
      orderBy?: unknown;
    };
    expect(query.orderBy).toEqual(expect.any(Function));
  });

  it('viewPlanQuantity returns zero when no current plan exists', async () => {
    const db = createPlanDbMock(undefined);
    const repository = new AccountQuantityProductViewerRepository(db as never);

    await expect(
      repository.viewPlanQuantity('acc-1', 'product-1')
    ).resolves.toBe(0);
  });

  it('viewPlanQuantity returns zero when the latest plan is expired', async () => {
    const db = createPlanDbMock({
      next_payment_date: '2000-01-01T00:00:00.000Z',
      pac: {
        deleted_at: null,
      },
      ppl: {
        deleted_at: null,
        ppi: [
          {
            plan_product_id: 'product-1',
            quantity: 5,
            deleted_at: null,
          },
        ],
      },
    });
    const repository = new AccountQuantityProductViewerRepository(db as never);

    await expect(
      repository.viewPlanQuantity('acc-1', 'product-1')
    ).resolves.toBe(0);
  });

  it('viewPlanCrossSellQuantity sums all quantities', async () => {
    const { db } = createSelectDbMock([{ quantity: 2 }, { quantity: 3 }]);
    const repository = new AccountQuantityProductViewerRepository(db as never);

    await expect(
      repository.viewPlanCrossSellQuantity('acc-1', 'product-1')
    ).resolves.toBe(5);
  });

  it('viewPlanCrossSellQuantity returns zero when no rows exist', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new AccountQuantityProductViewerRepository(db as never);

    await expect(
      repository.viewPlanCrossSellQuantity('acc-1', 'product-1')
    ).resolves.toBe(0);
  });

  it('viewAccountQuantityProduct sums plan and cross sell quantities', async () => {
    const repository = new AccountQuantityProductViewerRepository({} as never);
    const planSpy = jest
      .spyOn(repository, 'viewPlanQuantity')
      .mockResolvedValue(4);
    const crossSellSpy = jest
      .spyOn(repository, 'viewPlanCrossSellQuantity')
      .mockResolvedValue(6);

    await expect(
      repository.viewAccountQuantityProduct('acc-1', 'product-1')
    ).resolves.toBe(10);
    expect(planSpy).toHaveBeenCalledWith('acc-1', 'product-1');
    expect(crossSellSpy).toHaveBeenCalledWith('acc-1', 'product-1');
  });
});
