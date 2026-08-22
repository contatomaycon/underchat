import 'reflect-metadata';

jest.mock(
  '@core/repositories/worker/WhatsappRuntimeDatabaseFence.repository',
  () => ({
    assertCurrentWhatsappRuntimeInTransaction: jest.fn(async () => undefined),
  })
);

import { UserInfoUpdaterRepository } from '@core/repositories/user/UserInfoUpdater.repository';
import { assertCurrentWhatsappRuntimeInTransaction } from '@core/repositories/worker/WhatsappRuntimeDatabaseFence.repository';

const runtimeFence = {
  account_id: 'account-1',
  worker_id: 'worker-1',
  source_provider: 'baileys',
  runtime_generation: 7,
  connection_epoch: 'epoch-1',
};

function makePhoneJidDatabase(
  rowCount: number,
  {
    userRows = [{ user_id: 'user-1' }],
    userInfoRows = [{ user_info_id: 'user-info-1' }],
  }: {
    userRows?: { user_id: string }[];
    userInfoRows?: { user_info_id: string }[];
  } = {}
) {
  const executeUpdate = jest.fn(async () => ({ rowCount }));
  const executeUser = jest.fn(async () => userRows);
  const executeUserInfo = jest.fn(async () => userInfoRows);
  const buildSelect = (execute: jest.Mock) => ({
    from: jest.fn(() => ({
      where: jest.fn(() => ({
        for: jest.fn(() => ({
          limit: jest.fn(() => ({ execute })),
        })),
      })),
    })),
  });
  const tx = {
    select: jest
      .fn()
      .mockImplementationOnce(() => buildSelect(executeUser))
      .mockImplementationOnce(() => buildSelect(executeUserInfo)),
    update: jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn(() => ({ execute: executeUpdate })),
      })),
    })),
  };
  return {
    db: {
      transaction: jest.fn(
        async (callback: (transaction: typeof tx) => Promise<boolean>) =>
          callback(tx)
      ),
    },
    tx,
    executeUpdate,
    executeUser,
    executeUserInfo,
  };
}

describe('UserInfoUpdaterRepository', () => {
  beforeEach(() => {
    jest
      .mocked(assertCurrentWhatsappRuntimeInTransaction)
      .mockReset()
      .mockResolvedValue(undefined);
  });

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
    const { db } = makePhoneJidDatabase(1);
    const repository = new UserInfoUpdaterRepository(db as never);

    await expect(
      repository.updatePhoneJidById('user-1', 'jid-1', runtimeFence)
    ).resolves.toBe(true);
    expect(assertCurrentWhatsappRuntimeInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      runtimeFence
    );
  });

  it('updatePhoneJidById returns false when rowCount is zero', async () => {
    const { db } = makePhoneJidDatabase(0);
    const repository = new UserInfoUpdaterRepository(db as never);

    await expect(
      repository.updatePhoneJidById('user-1', 'jid-1', runtimeFence)
    ).resolves.toBe(false);
  });

  it('rolls the phone_jid mutation into the durable runtime-fence transaction', async () => {
    const { db, executeUpdate } = makePhoneJidDatabase(1);
    const repository = new UserInfoUpdaterRepository(db as never);
    const revoked = new Error('runtime fence replaced');
    const assertActive = jest.fn(async () => {
      throw revoked;
    });

    await expect(
      repository.updatePhoneJidById(
        'user-1',
        'jid-1',
        runtimeFence,
        assertActive
      )
    ).rejects.toBe(revoked);

    expect(assertActive).toHaveBeenCalledTimes(1);
    expect(executeUpdate).not.toHaveBeenCalled();
  });

  it('rolls back before UPDATE when the durable runtime fence is stale', async () => {
    const { db, executeUpdate } = makePhoneJidDatabase(1);
    const repository = new UserInfoUpdaterRepository(db as never);
    const stale = new Error('durable runtime fence replaced');
    jest
      .mocked(assertCurrentWhatsappRuntimeInTransaction)
      .mockRejectedValueOnce(stale);

    await expect(
      repository.updatePhoneJidById('user-1', 'jid-1', runtimeFence)
    ).rejects.toBe(stale);

    expect(executeUpdate).not.toHaveBeenCalled();
  });

  it('does not update a user outside the runtime account', async () => {
    const { db, executeUpdate } = makePhoneJidDatabase(1, { userRows: [] });
    const repository = new UserInfoUpdaterRepository(db as never);

    await expect(
      repository.updatePhoneJidById('user-other-account', 'jid-1', runtimeFence)
    ).resolves.toBe(false);

    expect(executeUpdate).not.toHaveBeenCalled();
  });

  it('does not update a soft-deleted or missing user-info row', async () => {
    const { db, executeUpdate } = makePhoneJidDatabase(1, {
      userInfoRows: [],
    });
    const repository = new UserInfoUpdaterRepository(db as never);

    await expect(
      repository.updatePhoneJidById('user-1', 'jid-1', runtimeFence)
    ).resolves.toBe(false);

    expect(executeUpdate).not.toHaveBeenCalled();
  });

  it('fails closed when more than one live user-info row exists', async () => {
    const { db, executeUpdate } = makePhoneJidDatabase(2, {
      userInfoRows: [
        { user_info_id: 'user-info-1' },
        { user_info_id: 'user-info-duplicate' },
      ],
    });
    const repository = new UserInfoUpdaterRepository(db as never);

    await expect(
      repository.updatePhoneJidById('user-1', 'jid-1', runtimeFence)
    ).resolves.toBe(false);

    expect(executeUpdate).not.toHaveBeenCalled();
  });
});
