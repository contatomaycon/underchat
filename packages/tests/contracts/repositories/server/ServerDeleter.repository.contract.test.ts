import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { ServerDeleterRepository } from '@core/repositories/server/ServerDeleter.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('ServerDeleterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (currentTime as unknown as jest.Mock).mockReturnValue(
      '2026-04-21T16:00:00.000Z'
    );
  });

  it('returns true when server is soft deleted', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new ServerDeleterRepository(db as never);

    await expect(repository.deleteServerById('srv-1')).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith({
      deleted_at: '2026-04-21T16:00:00.000Z',
    });
  });

  it('returns false when update affects no rows', async () => {
    const { db } = createUpdateDbMock({ rowCount: 0 });
    const repository = new ServerDeleterRepository(db as never);

    await expect(repository.deleteServerById('srv-1')).resolves.toBe(false);
  });
});
