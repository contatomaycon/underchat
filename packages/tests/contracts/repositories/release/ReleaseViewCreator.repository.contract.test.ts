import 'reflect-metadata';
import { ReleaseViewCreatorRepository } from '@core/repositories/release/ReleaseViewCreator.repository';
import { createInsertDbMock } from '@core/tests/helpers/drizzleMock';
import { v7 as uuidv7 } from 'uuid';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

describe('ReleaseViewCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('release-view-1');
  });

  it('createReleaseView returns true when insert affects rows', async () => {
    const { db } = createInsertDbMock({ rowCount: 1 });
    const repository = new ReleaseViewCreatorRepository(db as never);

    await expect(
      repository.createReleaseView('release-1', 'user-1')
    ).resolves.toBe(true);
  });

  it('createReleaseViewInTransaction returns false when insert affects no rows', async () => {
    const tx = createInsertDbMock({ rowCount: 0 }).db;
    const repository = new ReleaseViewCreatorRepository({} as never);

    await expect(
      repository.createReleaseViewInTransaction(
        tx as never,
        'release-1',
        'user-1'
      )
    ).resolves.toBe(false);
  });
});
