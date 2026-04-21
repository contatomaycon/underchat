import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { SectorDeleterRepository } from '@core/repositories/sector/SectorDeleter.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('SectorDeleterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (currentTime as unknown as jest.Mock).mockReturnValue(
      '2026-04-21T20:00:00.000Z'
    );
  });

  it('returns true when update affects one row', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new SectorDeleterRepository(db as never);

    await expect(repository.deleteSectorById('sec-1', 'acc-1')).resolves.toBe(
      true
    );

    expect(set).toHaveBeenCalledWith({
      deleted_at: '2026-04-21T20:00:00.000Z',
    });
  });

  it('returns false when update affects no rows', async () => {
    const { db } = createUpdateDbMock({ rowCount: 0 });
    const repository = new SectorDeleterRepository(db as never);

    await expect(repository.deleteSectorById('sec-1', 'acc-1')).resolves.toBe(
      false
    );
  });
});
