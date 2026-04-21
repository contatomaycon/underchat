import 'reflect-metadata';
import { UserDeleterRepository } from '@core/repositories/user/UserDeleter.repository';
import { currentTime } from '@core/common/functions/currentTime';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('UserDeleterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns true when one row is updated', async () => {
    const now = new Date('2026-04-21T10:00:00.000Z');
    (currentTime as jest.Mock).mockReturnValue(now);

    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const where = jest.fn(() => ({ execute }));
    const set = jest.fn(() => ({ where }));
    const update = jest.fn(() => ({ set }));

    const repository = new UserDeleterRepository({
      update,
    } as never);

    await expect(
      repository.deleteUserById('user-1', 'account-1')
    ).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith({ deleted_at: now });
  });

  it('returns false when update affects no rows', async () => {
    (currentTime as jest.Mock).mockReturnValue(
      new Date('2026-04-21T10:00:00.000Z')
    );

    const repository = new UserDeleterRepository({
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 0 })),
          })),
        })),
      })),
    } as never);

    await expect(
      repository.deleteUserById('user-1', 'account-1')
    ).resolves.toBe(false);
  });
});
