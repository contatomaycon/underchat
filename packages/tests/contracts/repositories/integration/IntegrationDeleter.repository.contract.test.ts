import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { IntegrationDeleterRepository } from '@core/repositories/integration/IntegrationDeleter.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('IntegrationDeleterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns true when delete affects one row', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new IntegrationDeleterRepository(db as never);
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T21:00:00.000Z');

    await expect(
      repository.deleteIntegration('acc-1', 'api-key-1')
    ).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith({
      deleted_at: '2026-04-21T21:00:00.000Z',
    });
  });

  it('returns false when delete affects no rows', async () => {
    const { db } = createUpdateDbMock({ rowCount: 0 });
    const repository = new IntegrationDeleterRepository(db as never);
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T21:05:00.000Z');

    await expect(
      repository.deleteIntegration('acc-1', 'api-key-1')
    ).resolves.toBe(false);
  });
});
