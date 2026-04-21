import 'reflect-metadata';
import { UserUpdaterRepository } from '@core/repositories/user/UserUpdater.repository';

describe('UserUpdaterRepository', () => {
  it('updateInput maps only truthy fields', () => {
    const repository = new UserUpdaterRepository({} as never);

    const updateInput = (repository as any).updateInput({
      user_status_id: 'active',
      email: 'encrypted-email',
      email_partial: 'email-partial',
      email_c: 'email-c',
      password: 'password',
      account_id: 'account-2',
    });

    expect(updateInput).toEqual({
      user_status_id: 'active',
      email: 'encrypted-email',
      email_partial: 'email-partial',
      email_c: 'email-c',
      password: 'password',
      account_id: 'account-2',
    });
  });

  it('updateUserById returns true when rowCount is one', async () => {
    const repository = new UserUpdaterRepository({
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 1 })),
          })),
        })),
      })),
    } as never);

    await expect(
      repository.updateUserById(
        'user-1',
        { email: 'encrypted-email' } as never,
        'account-1'
      )
    ).resolves.toBe(true);
  });

  it('updateUserById returns false when rowCount is zero', async () => {
    const repository = new UserUpdaterRepository({
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 0 })),
          })),
        })),
      })),
    } as never);

    await expect(
      repository.updateUserById(
        'user-1',
        { email: 'encrypted-email' } as never,
        'account-1'
      )
    ).resolves.toBe(false);
  });

  it('updateUserByIdTx returns false when rowCount is zero', async () => {
    const repository = new UserUpdaterRepository({} as never);
    const tx = {
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 0 })),
          })),
        })),
      })),
    } as never;

    await expect(
      repository.updateUserByIdTx(
        tx,
        'user-1',
        { email: 'encrypted-email' } as never,
        'account-1'
      )
    ).resolves.toBe(false);
  });

  it('updateUserByIdTx returns true when rowCount is one', async () => {
    const repository = new UserUpdaterRepository({} as never);
    const tx = {
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 1 })),
          })),
        })),
      })),
    } as never;

    await expect(
      repository.updateUserByIdTx(
        tx,
        'user-1',
        { email: 'encrypted-email' } as never,
        'account-1'
      )
    ).resolves.toBe(true);
  });
});
