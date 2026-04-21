import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { EStatusApiKey } from '@core/common/enums/EStatusApiKey';
import { IntegrationStatusUpdaterRepository } from '@core/repositories/integration/IntegrationStatusUpdater.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('IntegrationStatusUpdaterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns true when update affects one row', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new IntegrationStatusUpdaterRepository(db as never);
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T21:20:00.000Z');

    await expect(
      repository.updateIntegrationStatus(
        'acc-1',
        'api-key-1',
        EStatusApiKey.inactive
      )
    ).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith({
      status: EStatusApiKey.inactive,
      updated_at: '2026-04-21T21:20:00.000Z',
    });
  });

  it('returns false when update affects no rows', async () => {
    const { db } = createUpdateDbMock({ rowCount: 0 });
    const repository = new IntegrationStatusUpdaterRepository(db as never);
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T21:21:00.000Z');

    await expect(
      repository.updateIntegrationStatus(
        'acc-1',
        'api-key-1',
        EStatusApiKey.active
      )
    ).resolves.toBe(false);
  });
});
