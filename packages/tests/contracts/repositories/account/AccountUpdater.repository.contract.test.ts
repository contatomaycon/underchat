import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { AccountUpdaterRepository } from '@core/repositories/account/AccountUpdater.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('AccountUpdaterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates account fields with explicit false for generate_invoice', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new AccountUpdaterRepository(db as never);

    await expect(
      repository.updateAccountById(
        {
          name: 'New Name',
          account_status: { account_status_id: 'status-1' },
          generate_invoice: false,
        } as never,
        'acc-1'
      )
    ).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith({
      name: 'New Name',
      account_status_id: 'status-1',
      generate_invoice: false,
    });
  });

  it('sends an empty payload when all optional fields are nullish', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 0 });
    const repository = new AccountUpdaterRepository(db as never);

    await expect(
      repository.updateAccountById(
        {
          name: null,
          account_status: null,
          generate_invoice: null,
        } as never,
        'acc-1'
      )
    ).resolves.toBe(false);

    expect(set).toHaveBeenCalledWith({});
  });

  it('updates account status with updated_at timestamp', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 2 });
    const repository = new AccountUpdaterRepository(db as never);
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T13:30:00.000Z');

    await expect(
      repository.updateAccountStatusById('acc-1', 'active-status')
    ).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith({
      account_status_id: 'active-status',
      updated_at: '2026-04-21T13:30:00.000Z',
    });
  });

  it('returns false when status update affects no rows', async () => {
    const { db } = createUpdateDbMock({ rowCount: 0 });
    const repository = new AccountUpdaterRepository(db as never);
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T14:00:00.000Z');

    await expect(
      repository.updateAccountStatusById('acc-1', 'active-status')
    ).resolves.toBe(false);
  });
});
