import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { ApiKeyDeleterRepository } from '@core/repositories/apiKey/ApiKeyDeleter.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('ApiKeyDeleterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns true when one row is updated', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new ApiKeyDeleterRepository(db as never);
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T16:30:00.000Z');

    await expect(repository.deleteApiKeyById('acc-1')).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith({
      deleted_at: '2026-04-21T16:30:00.000Z',
    });
  });

  it('returns false when update affects no rows', async () => {
    const { db } = createUpdateDbMock({ rowCount: 0 });
    const repository = new ApiKeyDeleterRepository(db as never);
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T16:45:00.000Z');

    await expect(repository.deleteApiKeyById('acc-1')).resolves.toBe(false);
  });
});
