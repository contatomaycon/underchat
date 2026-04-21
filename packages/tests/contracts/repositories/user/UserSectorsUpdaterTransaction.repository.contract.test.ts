import 'reflect-metadata';
import { UserSectorsUpdaterTransactionRepository } from '@core/repositories/user/UserSectorsUpdaterTransaction.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'mocked-uuid'),
}));

describe('UserSectorsUpdaterTransactionRepository', () => {
  it('removes, restores and adds sectors based on differences', async () => {
    const createSectorUserInTransaction = jest.fn(async () => 'sector-user-id');
    const markSectorUsersAsDeletedInTransaction = jest.fn(async () => true);
    const restoreSectorUsersInTransaction = jest.fn(async () => true);
    const listUserSectorsInTransaction = jest.fn(async () => ['s1', 's2']);

    const tx = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => [
              { sector_id: 's1', deleted_at: null },
              { sector_id: 's2', deleted_at: null },
              { sector_id: 's3', deleted_at: '2026-01-01T00:00:00.000Z' },
            ]),
          })),
        })),
      })),
    };

    const repository = new UserSectorsUpdaterTransactionRepository(
      {
        transaction: jest.fn(async (callback) => callback(tx)),
      } as never,
      {
        createSectorUserInTransaction,
      } as never,
      {
        listUserSectorsInTransaction,
        markSectorUsersAsDeletedInTransaction,
        restoreSectorUsersInTransaction,
      } as never
    );

    await expect(
      repository.updateUserSectors(((k: string) => k) as never, 'user-1', [
        's3',
        's4',
      ])
    ).resolves.toBe(true);

    expect(markSectorUsersAsDeletedInTransaction).toHaveBeenCalledWith(
      tx,
      'user-1',
      ['s1', 's2']
    );
    expect(restoreSectorUsersInTransaction).toHaveBeenCalledWith(tx, 'user-1', [
      's3',
    ]);
    expect(createSectorUserInTransaction).toHaveBeenCalledWith(
      tx,
      'user-1',
      's4'
    );
  });

  it('returns true without writes when sectors already match', async () => {
    const createSectorUserInTransaction = jest.fn(async () => 'sector-user-id');
    const markSectorUsersAsDeletedInTransaction = jest.fn(async () => true);
    const restoreSectorUsersInTransaction = jest.fn(async () => true);
    const listUserSectorsInTransaction = jest.fn(async () => ['s1']);

    const repository = new UserSectorsUpdaterTransactionRepository(
      {
        transaction: jest.fn(async (callback) =>
          callback({
            select: jest.fn(() => ({
              from: jest.fn(() => ({
                where: jest.fn(() => ({
                  execute: jest.fn(async () => [
                    { sector_id: 's1', deleted_at: null },
                  ]),
                })),
              })),
            })),
          })
        ),
      } as never,
      {
        createSectorUserInTransaction,
      } as never,
      {
        listUserSectorsInTransaction,
        markSectorUsersAsDeletedInTransaction,
        restoreSectorUsersInTransaction,
      } as never
    );

    await expect(
      repository.updateUserSectors(((k: string) => k) as never, 'user-1', [
        's1',
      ])
    ).resolves.toBe(true);

    expect(markSectorUsersAsDeletedInTransaction).not.toHaveBeenCalled();
    expect(restoreSectorUsersInTransaction).not.toHaveBeenCalled();
    expect(createSectorUserInTransaction).not.toHaveBeenCalled();
  });
});
