import 'reflect-metadata';
import { UserUpdaterTransactionRepository } from '@core/repositories/user/UserUpdaterTransaction.repository';

describe('UserUpdaterTransactionRepository', () => {
  it('deletes permission assignment when account changes', async () => {
    const tx = { tx: true };
    const deletePermissionAssignmentByUserIdTx = jest.fn(async () => true);
    const updateUserByIdTx = jest.fn(async () => true);
    const repository = new UserUpdaterTransactionRepository(
      {
        transaction: jest.fn(async (callback) => callback(tx)),
      } as never,
      {
        updateUserByIdTx,
      } as never,
      {
        deletePermissionAssignmentByUserIdTx,
      } as never
    );

    await expect(
      repository.updateUserWithAccountChange(
        ((k: string) => k) as never,
        'user-1',
        { account_id: 'account-2' } as never,
        'account-2',
        'account-1'
      )
    ).resolves.toBe(true);

    expect(deletePermissionAssignmentByUserIdTx).toHaveBeenCalledWith(
      tx,
      'user-1'
    );
    expect(updateUserByIdTx).toHaveBeenCalledWith(
      tx,
      'user-1',
      { account_id: 'account-2' },
      'account-1'
    );
  });

  it('does not delete permission assignment when account is unchanged', async () => {
    const deletePermissionAssignmentByUserIdTx = jest.fn(async () => true);
    const updateUserByIdTx = jest.fn(async () => true);
    const repository = new UserUpdaterTransactionRepository(
      {
        transaction: jest.fn(async (callback) => callback({})),
      } as never,
      {
        updateUserByIdTx,
      } as never,
      {
        deletePermissionAssignmentByUserIdTx,
      } as never
    );

    await expect(
      repository.updateUserWithAccountChange(
        ((k: string) => k) as never,
        'user-1',
        {} as never,
        'account-1',
        'account-1'
      )
    ).resolves.toBe(true);
    expect(deletePermissionAssignmentByUserIdTx).not.toHaveBeenCalled();
  });

  it('throws translated error when update fails', async () => {
    const repository = new UserUpdaterTransactionRepository(
      {
        transaction: jest.fn(async (callback) => callback({})),
      } as never,
      {
        updateUserByIdTx: jest.fn(async () => false),
      } as never,
      {
        deletePermissionAssignmentByUserIdTx: jest.fn(async () => true),
      } as never
    );

    await expect(
      repository.updateUserWithAccountChange(
        ((k: string) => k) as never,
        'user-1',
        {} as never,
        'account-1',
        'account-1'
      )
    ).rejects.toThrow('user_update_failed');
  });
});
