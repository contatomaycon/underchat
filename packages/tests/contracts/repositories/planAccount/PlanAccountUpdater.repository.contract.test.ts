import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { currentTime } from '@core/common/functions/currentTime';
import { EBillingPeriod } from '@core/common/enums/EBillingPeriod';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { PlanAccountUpdaterRepository } from '@core/repositories/planAccount/PlanAccountUpdater.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

function createTransactionContext(options: {
  existingPlanAccount: {
    plan_account_id: string;
    last_payment_date: string | null;
  } | null;
  planData: {
    plan_id: string;
    price: string | null;
    annual_discount: string | null;
    is_test: boolean;
    days_trial: number | null;
  } | null;
  accountStatus: string | null;
  updateRowCount?: number;
}) {
  const planAccountFindFirst = jest.fn(async () => options.existingPlanAccount);
  const planFindFirst = jest.fn(async () => options.planData);
  const accountFindFirst = jest.fn(async () =>
    options.accountStatus ? { account_status_id: options.accountStatus } : null
  );

  const execute = jest.fn(async () => ({
    rowCount: options.updateRowCount ?? 1,
  }));
  const where = jest.fn(() => ({ execute }));
  const set = jest.fn(() => ({ where }));
  const update = jest.fn(() => ({ set }));

  const insertValues = jest.fn(async () => undefined);
  const insert = jest.fn(() => ({ values: insertValues }));

  const tx = {
    query: {
      planAccount: { findFirst: planAccountFindFirst },
      plan: { findFirst: planFindFirst },
      account: { findFirst: accountFindFirst },
    },
    update,
    insert,
  };

  return {
    tx,
    update,
    set,
    insertValues,
    planAccountFindFirst,
    planFindFirst,
    accountFindFirst,
  };
}

describe('PlanAccountUpdaterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('plan-account-id');
    (currentTime as unknown as jest.Mock).mockReturnValue(
      '2026-04-21T12:00:00.000Z'
    );
  });

  it('findPlanAccountByAccountId delegates to query.findFirst', async () => {
    const dbRo = {
      query: {
        planAccount: {
          findFirst: jest.fn(async () => ({ plan_account_id: 'pa-1' })),
        },
      },
    };

    const repository = new PlanAccountUpdaterRepository(
      {} as never,
      dbRo as never
    );

    await expect(
      repository.findPlanAccountByAccountId('acc-1')
    ).resolves.toEqual({
      plan_account_id: 'pa-1',
    });
  });

  it('updates existing plan account with calculated annual value and activates account', async () => {
    const context = createTransactionContext({
      existingPlanAccount: {
        plan_account_id: 'pa-1',
        last_payment_date: '2026-04-01T00:00:00.000Z',
      },
      planData: {
        plan_id: 'plan-1',
        price: '100',
        annual_discount: '10',
        is_test: false,
        days_trial: null,
      },
      accountStatus: EAccountStatus.inactive,
      updateRowCount: 1,
    });

    const dbRw = {
      transaction: jest.fn(async (callback: (trx: unknown) => unknown) =>
        callback(context.tx)
      ),
    };

    const repository = new PlanAccountUpdaterRepository(
      dbRw as never,
      {} as never
    );

    await expect(
      repository.createOrUpdatePlanAccountByAccountId('acc-1', {
        plan_id: 'plan-1',
        billing_period_id: EBillingPeriod.annual,
        recurring_payment: true,
      } as never)
    ).resolves.toBe(true);

    expect(context.set).toHaveBeenCalledWith(
      expect.objectContaining({
        plan_id: 'plan-1',
        recurring_payment: true,
        billing_period_id: EBillingPeriod.annual,
        value: '1080',
        updated_at: '2026-04-21T12:00:00.000Z',
      })
    );
    expect(context.update).toHaveBeenCalledTimes(2);
  });

  it('creates new plan account for test plan and keeps recurring false', async () => {
    const context = createTransactionContext({
      existingPlanAccount: null,
      planData: {
        plan_id: 'plan-test',
        price: '999',
        annual_discount: null,
        is_test: true,
        days_trial: 15,
      },
      accountStatus: EAccountStatus.active,
    });

    const dbRw = {
      transaction: jest.fn(async (callback: (trx: unknown) => unknown) =>
        callback(context.tx)
      ),
    };

    const repository = new PlanAccountUpdaterRepository(
      dbRw as never,
      {} as never
    );

    await expect(
      repository.createOrUpdatePlanAccountByAccountId('acc-1', {
        plan_id: 'plan-test',
      } as never)
    ).resolves.toBe(true);

    expect(context.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        plan_account_id: 'plan-account-id',
        account_id: 'acc-1',
        recurring_payment: false,
        billing_period_id: EBillingPeriod.monthly,
        value: '0',
        created_at: '2026-04-21T12:00:00.000Z',
        updated_at: '2026-04-21T12:00:00.000Z',
      })
    );
  });

  it('throws when plan data is not found', async () => {
    const context = createTransactionContext({
      existingPlanAccount: null,
      planData: null,
      accountStatus: EAccountStatus.active,
    });

    const dbRw = {
      transaction: jest.fn(async (callback: (trx: unknown) => unknown) =>
        callback(context.tx)
      ),
    };

    const repository = new PlanAccountUpdaterRepository(
      dbRw as never,
      {} as never
    );

    await expect(
      repository.createOrUpdatePlanAccountByAccountId('acc-1', {
        plan_id: 'missing-plan',
      } as never)
    ).rejects.toThrow('Plan not found');
  });

  it('updatePlanAccountByAccountId proxies to createOrUpdate', async () => {
    const repository = new PlanAccountUpdaterRepository(
      {} as never,
      {} as never
    );
    jest
      .spyOn(repository, 'createOrUpdatePlanAccountByAccountId')
      .mockResolvedValueOnce(true);

    await expect(
      repository.updatePlanAccountByAccountId('acc-1', {
        plan_id: 'plan-1',
      } as never)
    ).resolves.toBe(true);
  });
});
