import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { UserCardDeleterRepository } from '@core/repositories/accountSettings/UserCardDeleter.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('UserCardDeleterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns true when delete affects rows', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new UserCardDeleterRepository(db as never);
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T18:20:00.000Z');

    await expect(repository.deleteUserCard('card-1', 'user-1')).resolves.toBe(
      true
    );
    expect(set).toHaveBeenCalledWith({
      deleted_at: '2026-04-21T18:20:00.000Z',
      default: false,
      updated_at: '2026-04-21T18:20:00.000Z',
    });
  });

  it('returns false when delete affects no rows', async () => {
    const { db } = createUpdateDbMock({ rowCount: 0 });
    const repository = new UserCardDeleterRepository(db as never);
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T18:30:00.000Z');

    await expect(repository.deleteUserCard('card-1', 'user-1')).resolves.toBe(
      false
    );
  });
});
