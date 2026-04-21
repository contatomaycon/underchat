import 'reflect-metadata';
import { UserInfoUpdaterRepository } from '@core/repositories/user/UserInfoUpdater.repository';

describe('UserInfoUpdaterRepository', () => {
  it('updateInput maps only defined/truthy fields', () => {
    const repository = new UserInfoUpdaterRepository({} as never);

    const updateInput = (repository as any).updateInput({
      phone_ddi: '55',
      phone: '11999999999',
      phone_partial: '1199',
      phone_c: 'phone-c',
      name: 'John',
      last_name: 'Doe',
      birth_date: '1990-01-01',
      photo: null,
    });

    expect(updateInput).toEqual({
      phone_ddi: '55',
      phone: '11999999999',
      phone_partial: '1199',
      phone_c: 'phone-c',
      name: 'John',
      last_name: 'Doe',
      birth_date: '1990-01-01',
      photo: null,
    });
  });

  it('updateUserInfoById returns true when one row is updated', async () => {
    const repository = new UserInfoUpdaterRepository({
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 1 })),
          })),
        })),
      })),
    } as never);

    await expect(
      repository.updateUserInfoById('user-1', { name: 'John' } as never)
    ).resolves.toBe(true);
  });

  it('updateUserInfoById returns false when no row is updated', async () => {
    const repository = new UserInfoUpdaterRepository({
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 0 })),
          })),
        })),
      })),
    } as never);

    await expect(
      repository.updateUserInfoById('user-1', { name: 'John' } as never)
    ).resolves.toBe(false);
  });

  it('updatePhoneJidById returns true when rowCount is greater than zero', async () => {
    const repository = new UserInfoUpdaterRepository({
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 1 })),
          })),
        })),
      })),
    } as never);

    await expect(
      repository.updatePhoneJidById('user-1', 'jid-1')
    ).resolves.toBe(true);
  });

  it('updatePhoneJidById returns false when rowCount is zero', async () => {
    const repository = new UserInfoUpdaterRepository({
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 0 })),
          })),
        })),
      })),
    } as never);

    await expect(
      repository.updatePhoneJidById('user-1', 'jid-1')
    ).resolves.toBe(false);
  });
});
