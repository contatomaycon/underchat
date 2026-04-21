import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { SectorCreatorRepository } from '@core/repositories/sector/SectorCreator.repository';
import { createInsertDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('crypto', () => ({
  randomUUID: jest.fn(),
}));

describe('SectorCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (randomUUID as unknown as jest.Mock).mockReturnValue('sec-1');
  });

  it('creates sector and returns sector_id', async () => {
    const { db, values } = createInsertDbMock([{ sector_id: 'sec-1' }]);
    const repository = new SectorCreatorRepository(db as never);

    await expect(
      repository.createSector(
        { name: 'Sales', color: '#fff' } as never,
        'acc-1'
      )
    ).resolves.toEqual({ sector_id: 'sec-1' });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        sector_id: 'sec-1',
        account_id: 'acc-1',
        name: 'Sales',
        color: '#fff',
      })
    );
  });

  it('returns null when insert returning has no rows', async () => {
    const { db } = createInsertDbMock([]);
    const repository = new SectorCreatorRepository(db as never);

    await expect(
      repository.createSector(
        { name: 'Sales', color: '#fff' } as never,
        'acc-1'
      )
    ).resolves.toBeNull();
  });
});
