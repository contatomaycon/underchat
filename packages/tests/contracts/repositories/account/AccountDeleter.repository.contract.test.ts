import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { AccountDeleterRepository } from '@core/repositories/account/AccountDeleter.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('AccountDeleterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns true when one row is updated', async () => {
    const { db, set, execute, where } = createUpdateDbMock({ rowCount: 1 });
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T00:00:00.000Z');

    const repository = new AccountDeleterRepository(db as never);

    await expect(repository.deleteAccountById('acc-1')).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith({
      deleted_at: '2026-04-21T00:00:00.000Z',
      account_status_id: EAccountStatus.inactive,
      updated_at: '2026-04-21T00:00:00.000Z',
    });
    expect(where).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('returns false when no rows are updated', async () => {
    const { db } = createUpdateDbMock({ rowCount: 0 });
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T00:00:00.000Z');

    const repository = new AccountDeleterRepository(db as never);

    await expect(repository.deleteAccountById('acc-1')).resolves.toBe(false);
  });
});
