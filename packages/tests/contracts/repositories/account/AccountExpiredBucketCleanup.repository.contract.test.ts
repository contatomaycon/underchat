import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { AccountExpiredBucketCleanupRepository } from '@core/repositories/account/AccountExpiredBucketCleanup.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('AccountExpiredBucketCleanupRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('listAccountsWithExpiredPlanAndBucketPendingDeletion returns query rows', async () => {
    const repository = new AccountExpiredBucketCleanupRepository(
      {
        execute: jest.fn(async () => ({
          rows: [
            {
              account_id: 'acc-1',
              plan_account_id: 'plan-account-1',
              plan_id: 'plan-1',
              is_test: false,
              next_payment_date: '2026-04-01T00:00:00.000Z',
            },
          ],
        })),
      } as never,
      {} as never
    );

    await expect(
      repository.listAccountsWithExpiredPlanAndBucketPendingDeletion()
    ).resolves.toEqual([
      {
        account_id: 'acc-1',
        plan_account_id: 'plan-account-1',
        plan_id: 'plan-1',
        is_test: false,
        next_payment_date: '2026-04-01T00:00:00.000Z',
      },
    ]);
  });

  it('listAccountsWithExpiredPlanAndBucketPendingDeletion returns empty array when rows are missing', async () => {
    const repository = new AccountExpiredBucketCleanupRepository(
      {
        execute: jest.fn(async () => ({})),
      } as never,
      {} as never
    );

    await expect(
      repository.listAccountsWithExpiredPlanAndBucketPendingDeletion()
    ).resolves.toEqual([]);
  });

  it('markBucketAsDeleted returns true when update affects rows', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T14:00:00.000Z');

    const repository = new AccountExpiredBucketCleanupRepository(
      {} as never,
      db as never
    );

    await expect(repository.markBucketAsDeleted('acc-1')).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith({
      bucket_deleted: true,
      updated_at: '2026-04-21T14:00:00.000Z',
    });
  });

  it('markBucketAsDeleted returns false when update affects no rows', async () => {
    const { db } = createUpdateDbMock({ rowCount: 0 });
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T14:30:00.000Z');

    const repository = new AccountExpiredBucketCleanupRepository(
      {} as never,
      db as never
    );

    await expect(repository.markBucketAsDeleted('acc-1')).resolves.toBe(false);
  });
});
