import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { SectorUserCreatorRepository } from '@core/repositories/sector/SectorUserCreator.repository';
import { createInsertDbMock } from '@core/tests/helpers/drizzleMock';
import { v7 as uuidv7 } from 'uuid';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('SectorUserCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('sector-user-1');
    (currentTime as unknown as jest.Mock).mockReturnValue(
      '2026-04-21T20:20:00.000Z'
    );
  });

  it('returns sector_user_id when insert succeeds', async () => {
    const tx = createInsertDbMock({ rowCount: 1 }).db;
    const repository = new SectorUserCreatorRepository({} as never);

    await expect(
      repository.createSectorUserInTransaction(
        tx as never,
        'user-1',
        'sector-1'
      )
    ).resolves.toBe('sector-user-1');
  });

  it('returns null when insert result is null', async () => {
    const tx = createInsertDbMock(null).db;
    const repository = new SectorUserCreatorRepository({} as never);

    await expect(
      repository.createSectorUserInTransaction(
        tx as never,
        'user-1',
        'sector-1'
      )
    ).resolves.toBeNull();
  });
});
