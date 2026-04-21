import 'reflect-metadata';
import type { TFunction } from 'i18next';
import { PlanDeleterTransactionRepository } from '@core/repositories/plan/PlanDeleterTransaction.repository';

function createTranslator(): TFunction<'translation', undefined> {
  return ((key: string) => key) as unknown as TFunction<
    'translation',
    undefined
  >;
}

describe('PlanDeleterTransactionRepository', () => {
  it('deletes plan items when they exist and then deletes plan', async () => {
    const exists = jest.fn(async () => true);
    const deleteItems = jest.fn(async () => true);
    const deletePlan = jest.fn(async () => true);

    const repository = new PlanDeleterTransactionRepository(
      {
        transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
          cb({})
        ),
      } as never,
      {
        deletePlanItemsByPlanId: deleteItems,
      } as never,
      {
        deletePlanById: deletePlan,
      } as never,
      {
        existsPlanItemsByPlanId: exists,
      } as never
    );

    await expect(
      repository.deletePlan(createTranslator(), 'plan-1')
    ).resolves.toBe(true);

    expect(deleteItems).toHaveBeenCalled();
    expect(deletePlan).toHaveBeenCalled();
  });

  it('throws translated error when deleting plan items fails', async () => {
    const repository = new PlanDeleterTransactionRepository(
      {
        transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
          cb({})
        ),
      } as never,
      {
        deletePlanItemsByPlanId: jest.fn(async () => false),
      } as never,
      {
        deletePlanById: jest.fn(async () => true),
      } as never,
      {
        existsPlanItemsByPlanId: jest.fn(async () => true),
      } as never
    );

    await expect(
      repository.deletePlan(createTranslator(), 'plan-1')
    ).rejects.toThrow('plan_items_deleter_error');
  });

  it('skips deleting plan items when none exist', async () => {
    const deleteItems = jest.fn(async () => true);
    const deletePlan = jest.fn(async () => true);

    const repository = new PlanDeleterTransactionRepository(
      {
        transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
          cb({})
        ),
      } as never,
      {
        deletePlanItemsByPlanId: deleteItems,
      } as never,
      {
        deletePlanById: deletePlan,
      } as never,
      {
        existsPlanItemsByPlanId: jest.fn(async () => false),
      } as never
    );

    await expect(
      repository.deletePlan(createTranslator(), 'plan-1')
    ).resolves.toBe(true);

    expect(deleteItems).not.toHaveBeenCalled();
  });

  it('throws translated error when deleting plan fails', async () => {
    const repository = new PlanDeleterTransactionRepository(
      {
        transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
          cb({})
        ),
      } as never,
      {
        deletePlanItemsByPlanId: jest.fn(async () => true),
      } as never,
      {
        deletePlanById: jest.fn(async () => false),
      } as never,
      {
        existsPlanItemsByPlanId: jest.fn(async () => false),
      } as never
    );

    await expect(
      repository.deletePlan(createTranslator(), 'plan-1')
    ).rejects.toThrow('plan_deleter_error');
  });
});
