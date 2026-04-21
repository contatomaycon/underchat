import 'reflect-metadata';
import { UserAttendanceHoursRulesUpdaterTransactionRepository } from '@core/repositories/user/UserAttendanceHoursRulesUpdaterTransaction.repository';

describe('UserAttendanceHoursRulesUpdaterTransactionRepository', () => {
  it('returns false when user does not exist in account', async () => {
    const tx = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => [{ total: 0 }]),
          })),
        })),
      })),
      delete: jest.fn(),
      insert: jest.fn(),
    };

    const repository = new UserAttendanceHoursRulesUpdaterTransactionRepository(
      {
        transaction: jest.fn(async (callback) => callback(tx)),
      } as never
    );

    await expect(
      repository.replaceUserAttendanceHoursRules('user-1', 'account-1', [])
    ).resolves.toBe(false);
    expect(tx.delete).not.toHaveBeenCalled();
  });

  it('replaces rules and returns true when user exists', async () => {
    const deleteExecute = jest.fn(async () => ({ rowCount: 2 }));
    const insertExecute = jest.fn(async () => ({ rowCount: 2 }));
    const tx = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => [{ total: 1 }]),
          })),
        })),
      })),
      delete: jest.fn(() => ({
        where: jest.fn(() => ({
          execute: deleteExecute,
        })),
      })),
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          execute: insertExecute,
        })),
      })),
    };

    const repository = new UserAttendanceHoursRulesUpdaterTransactionRepository(
      {
        transaction: jest.fn(async (callback) => callback(tx)),
      } as never
    );

    await expect(
      repository.replaceUserAttendanceHoursRules('user-1', 'account-1', [
        { weekday: 'monday', start_time: '08:00', end_time: '18:00' },
      ])
    ).resolves.toBe(true);
    expect(deleteExecute).toHaveBeenCalledTimes(1);
    expect(insertExecute).toHaveBeenCalledTimes(1);
  });

  it('skips insert when rules list is empty', async () => {
    const tx = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => [{ total: 1 }]),
          })),
        })),
      })),
      delete: jest.fn(() => ({
        where: jest.fn(() => ({
          execute: jest.fn(async () => ({ rowCount: 1 })),
        })),
      })),
      insert: jest.fn(),
    };

    const repository = new UserAttendanceHoursRulesUpdaterTransactionRepository(
      {
        transaction: jest.fn(async (callback) => callback(tx)),
      } as never
    );

    await expect(
      repository.replaceUserAttendanceHoursRules('user-1', 'account-1', [])
    ).resolves.toBe(true);
    expect(tx.insert).not.toHaveBeenCalled();
  });
});
