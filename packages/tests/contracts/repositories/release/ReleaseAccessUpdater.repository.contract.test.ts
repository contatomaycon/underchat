import 'reflect-metadata';
import { ReleaseAccessUpdaterRepository } from '@core/repositories/release/ReleaseAccessUpdater.repository';
import { createInsertDbMock } from '@core/tests/helpers/drizzleMock';
import { v7 as uuidv7 } from 'uuid';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

describe('ReleaseAccessUpdaterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('release-access-1');
  });

  it('createReleaseAccess returns generated id when insert succeeds', async () => {
    const { db } = createInsertDbMock({ rowCount: 1 });
    const repository = new ReleaseAccessUpdaterRepository(db as never);

    await expect(
      repository.createReleaseAccess('release-1', 'user-1')
    ).resolves.toBe('release-access-1');
  });

  it('createReleaseAccess returns null when insert result is null', async () => {
    const { db } = createInsertDbMock(null);
    const repository = new ReleaseAccessUpdaterRepository(db as never);

    await expect(
      repository.createReleaseAccess('release-1', 'user-1')
    ).resolves.toBe(null);
  });

  it('createReleaseAccessInTransaction follows same behavior', async () => {
    const txOk = createInsertDbMock({ rowCount: 1 }).db;
    const txFail = createInsertDbMock(null).db;
    const repository = new ReleaseAccessUpdaterRepository({} as never);

    await expect(
      repository.createReleaseAccessInTransaction(
        txOk as never,
        'release-1',
        'user-1'
      )
    ).resolves.toBe('release-access-1');

    await expect(
      repository.createReleaseAccessInTransaction(
        txFail as never,
        'release-1',
        'user-1'
      )
    ).resolves.toBeNull();
  });
});
