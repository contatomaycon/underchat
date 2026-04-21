import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { IntegrationUpdaterRepository } from '@core/repositories/integration/IntegrationUpdater.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('IntegrationUpdaterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns true when update affects one row', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new IntegrationUpdaterRepository(db as never);
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T21:30:00.000Z');

    await expect(
      repository.updateIntegration(
        'acc-1',
        'api-key-1',
        'Integration A',
        'worker-1'
      )
    ).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith({
      name: 'Integration A',
      worker_id: 'worker-1',
      updated_at: '2026-04-21T21:30:00.000Z',
    });
  });

  it('returns false when update affects no rows', async () => {
    const { db } = createUpdateDbMock({ rowCount: 0 });
    const repository = new IntegrationUpdaterRepository(db as never);
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T21:31:00.000Z');

    await expect(
      repository.updateIntegration(
        'acc-1',
        'api-key-1',
        'Integration B',
        'worker-2'
      )
    ).resolves.toBe(false);
  });
});
