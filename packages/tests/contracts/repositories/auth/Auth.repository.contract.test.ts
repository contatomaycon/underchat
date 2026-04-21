import 'reflect-metadata';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { AuthRepository } from '@core/repositories/auth/Auth.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('AuthRepository', () => {
  it('authenticate returns null when user is not found', async () => {
    const { db } = createSelectDbMock([]);
    const presenceService = {
      getStatus: jest.fn(async () => EChatUserStatus.online),
    };
    const repository = new AuthRepository(
      db as never,
      presenceService as never
    );

    await expect(
      repository.authenticate({
        email: 'mailc',
        password: 'pwd',
      } as never)
    ).resolves.toBeNull();
  });

  it('authenticate normalizes address and applies offline fallback to chat status', async () => {
    const { db } = createSelectDbMock([
      {
        user_id: 'user-1',
        account_id: 'acc-1',
        email_partial: 'mail***',
        status: {
          status_id: 'status-1',
          name: 'Active',
        },
        info: {
          user_info_id: 'info-1',
          name: 'John',
          last_name: 'Doe',
          phone_partial: '***9999',
          photo: null,
          birth_date: null,
        },
        type: {
          user_type_id: 'role-1',
          name: 'Admin',
        },
        document: null,
        address: {
          user_address_id: null,
        },
        chat_user: {
          chat_user_id: 'chat-1',
          notifications: true,
        },
      },
    ]);
    const presenceService = {
      getStatus: jest.fn(async () => null),
    };
    const repository = new AuthRepository(
      db as never,
      presenceService as never
    );

    await expect(
      repository.authenticate({
        email: 'mailc',
        password: 'pwd',
      } as never)
    ).resolves.toEqual(
      expect.objectContaining({
        user_id: 'user-1',
        address: null,
        chat_user: expect.objectContaining({
          chat_user_id: 'chat-1',
          status: EChatUserStatus.offline,
        }),
      })
    );
  });

  it('hasValidCredentials returns boolean based on query result', async () => {
    const withRows = createSelectDbMock([{ user_id: 'user-1' }]);
    const repositoryWithRows = new AuthRepository(
      withRows.db as never,
      {
        getStatus: jest.fn(),
      } as never
    );
    await expect(
      repositoryWithRows.hasValidCredentials({
        email: 'mailc',
        password: 'pwd',
      } as never)
    ).resolves.toBe(true);

    const withoutRows = createSelectDbMock([]);
    const repositoryWithoutRows = new AuthRepository(
      withoutRows.db as never,
      {
        getStatus: jest.fn(),
      } as never
    );
    await expect(
      repositoryWithoutRows.hasValidCredentials({
        email: 'mailc',
        password: 'pwd',
      } as never)
    ).resolves.toBe(false);
  });

  it('findUserById applies presence status when chat user exists', async () => {
    const { db } = createSelectDbMock([
      {
        user_id: 'user-2',
        address: {
          user_address_id: 'address-1',
        },
        chat_user: {
          chat_user_id: 'chat-2',
        },
      },
    ]);
    const presenceService = {
      getStatus: jest.fn(async () => EChatUserStatus.away),
    };
    const repository = new AuthRepository(
      db as never,
      presenceService as never
    );

    await expect(repository.findUserById('user-2')).resolves.toEqual(
      expect.objectContaining({
        user_id: 'user-2',
        address: {
          user_address_id: 'address-1',
        },
        chat_user: expect.objectContaining({
          chat_user_id: 'chat-2',
          status: EChatUserStatus.away,
        }),
      })
    );
  });

  it('authenticateByUserId returns data and does not query presence when chat_user is null', async () => {
    const { db } = createSelectDbMock([
      {
        user_id: 'user-3',
        address: {
          user_address_id: 'address-2',
        },
        chat_user: null,
      },
    ]);
    const presenceService = {
      getStatus: jest.fn(async () => EChatUserStatus.online),
    };
    const repository = new AuthRepository(
      db as never,
      presenceService as never
    );

    await expect(
      repository.authenticateByUserId('user-3', 'acc-3')
    ).resolves.toEqual(
      expect.objectContaining({
        user_id: 'user-3',
        address: {
          user_address_id: 'address-2',
        },
        chat_user: null,
      })
    );
    expect(presenceService.getStatus).not.toHaveBeenCalled();
  });
});
