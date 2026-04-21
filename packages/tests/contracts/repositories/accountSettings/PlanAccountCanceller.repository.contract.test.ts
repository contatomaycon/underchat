import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { PlanAccountCancellerRepository } from '@core/repositories/accountSettings/PlanAccountCanceller.repository';
import {
  createSelectDbMock,
  createUpdateDbMock,
} from '@core/tests/helpers/drizzleMock';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('PlanAccountCancellerRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('findPlanAccountWithPayment and findPlanAccountById return query result', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce({
        plan_account_id: 'plan-account-1',
      })
      .mockResolvedValueOnce({
        plan_account_id: 'plan-account-2',
      });
    const repository = new PlanAccountCancellerRepository(
      {} as never,
      {
        query: {
          planAccount: {
            findFirst,
          },
        },
      } as never
    );

    await expect(
      repository.findPlanAccountWithPayment('acc-1')
    ).resolves.toEqual({
      plan_account_id: 'plan-account-1',
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

  it('cancelPlanAccount handles next payment removal flag', async () => {
    const withCancelNext = createUpdateDbMock({ rowCount: 1 });
    const repositoryWithCancelNext = new PlanAccountCancellerRepository(
      withCancelNext.db as never,
      {} as never
    );
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T20:00:00.000Z');

    await expect(
      repositoryWithCancelNext.cancelPlanAccount(
        'acc-1',
        '2026-04-21T20:00:00.000Z',
        true
      )
    ).resolves.toBe(true);
    expect(withCancelNext.set).toHaveBeenCalledWith({
      cancellation_date: '2026-04-21T20:00:00.000Z',
      recurring_payment: false,
      updated_at: '2026-04-21T20:00:00.000Z',
      next_payment_date: null,
    });

    const withoutCancelNext = createUpdateDbMock({ rowCount: 1 });
    const repositoryWithoutCancelNext = new PlanAccountCancellerRepository(
      withoutCancelNext.db as never,
      {} as never
    );
    currentTimeMock.mockReturnValue('2026-04-21T20:10:00.000Z');

    await expect(
      repositoryWithoutCancelNext.cancelPlanAccount(
        'acc-1',
        '2026-04-21T20:10:00.000Z',
        false
      )
    ).resolves.toBe(true);
    expect(withoutCancelNext.set).toHaveBeenCalledWith({
      cancellation_date: '2026-04-21T20:10:00.000Z',
      recurring_payment: false,
      updated_at: '2026-04-21T20:10:00.000Z',
    });
  });

  it('updatePlanAccountById returns false when no rows are affected', async () => {
    const updateMock = createUpdateDbMock({ rowCount: 0 });
    const repository = new PlanAccountCancellerRepository(
      updateMock.db as never,
      {} as never
    );
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T20:20:00.000Z');

    await expect(
      repository.updatePlanAccountById(
        'plan-account-1',
        '2026-04-21T20:20:00.000Z',
        true
      )
    ).resolves.toBe(false);
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
});
