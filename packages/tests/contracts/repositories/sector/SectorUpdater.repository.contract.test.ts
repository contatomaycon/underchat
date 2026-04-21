import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { SectorUpdaterRepository } from '@core/repositories/sector/SectorUpdater.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('SectorUpdaterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (currentTime as unknown as jest.Mock).mockReturnValue(
      '2026-04-21T20:10:00.000Z'
    );
  });

  it('updates only provided fields and returns true', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new SectorUpdaterRepository(db as never);

    await expect(
      repository.updateSectorById(
        'sec-1',
        {
          name: 'Updated',
          sector_status_id: 'status-2',
        } as never,
        'acc-1'
      )
    ).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith({
      updated_at: '2026-04-21T20:10:00.000Z',
      name: 'Updated',
      sector_status_id: 'status-2',
    });
  });

  it('returns false when update affects no rows', async () => {
    const { db } = createUpdateDbMock({ rowCount: 0 });
    const repository = new SectorUpdaterRepository(db as never);

    await expect(
      repository.updateSectorById('sec-1', { color: '#fff' } as never, 'acc-1')
    ).resolves.toBe(false);
  });
});
