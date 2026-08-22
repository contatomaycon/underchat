import 'reflect-metadata';
import { PlanAccountCancellerRepository } from '@core/repositories/accountSettings/PlanAccountCanceller.repository';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import {
  createSelectDbMock,
  createUpdateDbMock,
} from '@core/tests/helpers/drizzleMock';

function createCurrentPlanUpdateDb(
  currentPlans: Array<{
    plan_account_id: string;
    cancellation_date: string | null;
  }>,
  rowCount: number
) {
  const selectMock = createSelectDbMock(currentPlans);
  const updateMock = createUpdateDbMock({ rowCount });
  const transaction = jest.fn(async (callback) =>
    callback({
      select: selectMock.db.select,
      update: updateMock.db.update,
    })
  );

  return {
    db: { transaction },
    selectMock,
    updateMock,
  };
}

describe('PlanAccountCancellerRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('findPlanAccountWithPayment and findPlanAccountById return query result', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce({
        plan_account_id: 'plan-account-1',
        cancellation_date: null,
      })
      .mockResolvedValueOnce({
        plan_account_id: 'plan-account-2',
      });
    const repository = new PlanAccountCancellerRepository(
      {
        query: {
          planAccount: {
            findFirst,
          },
        },
      } as never,
      {} as never
    );

    await expect(
      repository.findPlanAccountWithPayment('acc-1')
    ).resolves.toEqual({
      plan_account_id: 'plan-account-1',
      cancellation_date: null,
    });
    await expect(
      repository.findPlanAccountById('plan-account-2')
    ).resolves.toEqual({
      plan_account_id: 'plan-account-2',
    });
  });

  it('findPlanAccountWithCancellation returns null when there are no rows', async () => {
    const selectMock = createSelectDbMock([]);
    const repository = new PlanAccountCancellerRepository(
      selectMock.db as never,
      {} as never
    );

    await expect(
      repository.findPlanAccountWithCancellation('acc-1')
    ).resolves.toBeNull();
  });

  it('findPlanAccountWithCancellation returns first row when present', async () => {
    const selectMock = createSelectDbMock([
      {
        plan_account_id: 'plan-account-1',
        cancellation_date: null,
        next_payment_date: '2026-05-01',
        account_status_id: 'active',
      },
    ]);
    const repository = new PlanAccountCancellerRepository(
      selectMock.db as never,
      {} as never
    );

    await expect(
      repository.findPlanAccountWithCancellation('acc-1')
    ).resolves.toEqual({
      plan_account_id: 'plan-account-1',
      cancellation_date: null,
      next_payment_date: '2026-05-01',
      account_status_id: 'active',
    });
  });

  it('updatePlanAccountById returns false when no rows are affected', async () => {
    const dbMock = createCurrentPlanUpdateDb(
      [{ plan_account_id: 'plan-account-1', cancellation_date: null }],
      0
    );
    const repository = new PlanAccountCancellerRepository(
      dbMock.db as never,
      {} as never
    );

    await expect(
      repository.updatePlanAccountById(
        'plan-account-1',
        '2026-04-21T20:20:00.000Z',
        true
      )
    ).resolves.toBe(false);
  });

  it('updates only the same deterministic current plan without promoting it', async () => {
    const dbMock = createCurrentPlanUpdateDb(
      [{ plan_account_id: 'plan-account-1', cancellation_date: null }],
      1
    );
    const repository = new PlanAccountCancellerRepository(
      dbMock.db as never,
      {} as never
    );

    await expect(
      repository.updatePlanAccountById(
        'plan-account-1',
        '2026-04-21T20:20:00.000Z',
        true
      )
    ).resolves.toBe(true);
    expect(dbMock.selectMock.for).toHaveBeenCalledWith('update');
    expect(dbMock.updateMock.set).toHaveBeenCalledWith({
      cancellation_date: '2026-04-21T20:20:00.000Z',
      recurring_payment: false,
      next_payment_date: null,
    });
  });

  it('refuses to cancel a plan id that is no longer current', async () => {
    const dbMock = createCurrentPlanUpdateDb(
      [{ plan_account_id: 'new-current-plan', cancellation_date: null }],
      1
    );
    const repository = new PlanAccountCancellerRepository(
      dbMock.db as never,
      {} as never
    );

    await expect(
      repository.updatePlanAccountById(
        'historical-plan',
        '2026-04-21T20:20:00.000Z',
        true
      )
    ).resolves.toBe(false);
    expect(dbMock.updateMock.db.update).not.toHaveBeenCalled();
  });

  it('findWorkersByAccountId maps worker ids', async () => {
    const selectMock = createSelectDbMock([
      { worker_id: 'worker-1' },
      { worker_id: 'worker-2' },
    ]);
    const repository = new PlanAccountCancellerRepository(
      selectMock.db as never,
      {} as never
    );

    await expect(repository.findWorkersByAccountId('acc-1')).resolves.toEqual([
      'worker-1',
      'worker-2',
    ]);
  });

  it('findInvoiceIdByAccountPaymentId returns reference or null', async () => {
    const repository = new PlanAccountCancellerRepository(
      {} as never,
      {
        query: {
          accountPaymentNfSe: {
            findFirst: jest
              .fn()
              .mockResolvedValueOnce({ reference: 'invoice-1' })
              .mockResolvedValueOnce(null),
          },
        },
      } as never
    );

    await expect(
      repository.findInvoiceIdByAccountPaymentId('payment-1')
    ).resolves.toBe('invoice-1');
    await expect(
      repository.findInvoiceIdByAccountPaymentId('payment-2')
    ).resolves.toBeNull();
  });

  it('findCancelledPlanAccount returns row or null', async () => {
    const withResult = createSelectDbMock([
      {
        plan_account_id: 'plan-account-1',
        account_id: 'acc-1',
        cancellation_date: '2026-04-20',
        next_payment_date: null,
      },
    ]);
    const repositoryWithResult = new PlanAccountCancellerRepository(
      withResult.db as never,
      {} as never
    );
    await expect(
      repositoryWithResult.findCancelledPlanAccount('acc-1')
    ).resolves.toEqual({
      plan_account_id: 'plan-account-1',
      account_id: 'acc-1',
      cancellation_date: '2026-04-20',
      next_payment_date: null,
    });

    const withoutResult = createSelectDbMock([]);
    const repositoryWithoutResult = new PlanAccountCancellerRepository(
      withoutResult.db as never,
      {} as never
    );
    await expect(
      repositoryWithoutResult.findCancelledPlanAccount('acc-1')
    ).resolves.toBeNull();
  });

  it('does not expose a blocked or deleted account for plan reactivation', async () => {
    const blockedResult = createSelectDbMock([
      {
        plan_account_id: 'plan-account-1',
        account_id: 'acc-1',
        cancellation_date: '2026-04-20',
        next_payment_date: null,
        account_status_id: EAccountStatus.blocked,
        account_deleted_at: null,
      },
    ]);
    const blockedRepository = new PlanAccountCancellerRepository(
      blockedResult.db as never,
      {} as never
    );
    await expect(
      blockedRepository.findCancelledPlanAccount('acc-1')
    ).resolves.toBeNull();

    const deletedResult = createSelectDbMock([
      {
        plan_account_id: 'plan-account-1',
        account_id: 'acc-1',
        cancellation_date: '2026-04-20',
        next_payment_date: null,
        account_status_id: EAccountStatus.inactive,
        account_deleted_at: '2026-04-21',
      },
    ]);
    const deletedRepository = new PlanAccountCancellerRepository(
      deletedResult.db as never,
      {} as never
    );
    await expect(
      deletedRepository.findCancelledPlanAccount('acc-1')
    ).resolves.toBeNull();
  });

  it('allows an inactive current account to resume an uncancelled plan', async () => {
    const inactiveResult = createSelectDbMock([
      {
        plan_account_id: 'plan-account-1',
        account_id: 'acc-1',
        cancellation_date: null,
        next_payment_date: '2026-05-20',
        account_status_id: EAccountStatus.inactive,
        account_deleted_at: null,
      },
    ]);
    const repository = new PlanAccountCancellerRepository(
      inactiveResult.db as never,
      {} as never
    );

    await expect(repository.findCancelledPlanAccount('acc-1')).resolves.toEqual(
      {
        plan_account_id: 'plan-account-1',
        account_id: 'acc-1',
        cancellation_date: null,
        next_payment_date: '2026-05-20',
      }
    );
  });
});
