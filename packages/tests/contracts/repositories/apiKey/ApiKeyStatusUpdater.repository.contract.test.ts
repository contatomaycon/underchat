import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { EStatusApiKey } from '@core/common/enums/EStatusApiKey';
import { ApiKeyStatusUpdaterRepository } from '@core/repositories/apiKey/ApiKeyStatusUpdater.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('ApiKeyStatusUpdaterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns true when status update affects one row', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new ApiKeyStatusUpdaterRepository(db as never);
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T17:30:00.000Z');

    await expect(
      repository.updateApiKeyStatus('acc-1', EStatusApiKey.inactive)
    ).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith({
      status: EStatusApiKey.inactive,
      updated_at: '2026-04-21T17:30:00.000Z',
    });
  });

  it('returns false when no rows are updated', async () => {
    const { db } = createUpdateDbMock({ rowCount: 0 });
    const repository = new ApiKeyStatusUpdaterRepository(db as never);
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T17:45:00.000Z');

    await expect(
      repository.updateApiKeyStatus('acc-1', EStatusApiKey.active)
    ).resolves.toBe(false);
  });
});
