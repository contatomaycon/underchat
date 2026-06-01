import 'reflect-metadata';

jest.mock('@core/services/account.service', () => ({
  AccountService: class AccountService {},
}));
jest.mock('@core/services/user.service', () => ({
  UserService: class UserService {},
}));
jest.mock('@core/services/auth.service', () => ({
  AuthService: class AuthService {},
}));
jest.mock('@core/services/permission.service', () => ({
  PermissionService: class PermissionService {},
}));
jest.mock('uuid', () => ({
  v7: jest.fn(() => 'uuid-v7'),
}));

import { AuthRefreshTokenUseCase } from './AuthRefreshToken.useCase';
import { AuthRefreshTokenError } from '@core/common/exceptions/AuthRefreshTokenError';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { ERouteModule } from '@core/common/enums/ERouteModule';

const t = (key: string) => key;

function buildUseCase(
  overrides: {
    activeSession?: string | null;
    user?: Record<string, unknown> | null;
    permissions?: string[];
    accountBlocked?: boolean;
  } = {}
) {
  const accountService = {
    isAccountBlocked: jest.fn(async () => overrides.accountBlocked ?? false),
    isPlanActive: jest.fn(async () => true),
    viewAccountInfoByAccountId: jest.fn(async () => ({
      account_info_id: 'info-1',
      name: 'Account',
    })),
  };

  const userService = {
    getUserAccountId: jest.fn(async () => 'account-1'),
    listUserSectors: jest.fn(async () => ['sector-1']),
    listUserChannelsWithNames: jest.fn(async () => [
      { id: 'worker-1', name: 'Canal 1' },
    ]),
    getAttendanceGuardStatus: jest.fn(async () => ({
      is_blocked_now: false,
      server_now: '2026-01-01T00:00:00.000Z',
      next_transition_at: null,
      today_windows_label: null,
      today_windows: [],
    })),
  };

  const authService = {
    authenticateByUserId: jest.fn(async () =>
      Object.hasOwn(overrides, 'user')
        ? overrides.user
        : {
            user_id: 'user-1',
            account_id: 'account-1',
            info: { name: 'User' },
          }
    ),
  };

  const permissionService = {
    viewPermissionByUserId: jest.fn(
      async () => overrides.permissions ?? ['chat_access']
    ),
  };

  const redis = {
    get: jest.fn(async () =>
      Object.hasOwn(overrides, 'activeSession')
        ? overrides.activeSession
        : 'session-1'
    ),
    set: jest.fn(async () => 'OK'),
    incr: jest.fn(async () => 1),
  };

  const useCase = new AuthRefreshTokenUseCase(
    accountService as never,
    userService as never,
    authService as never,
    permissionService as never,
    redis as never
  );

  const request = {
    module: ERouteModule.manager,
    jwtVerify: jest.fn(async () => ({
      user_id: 'user-1',
      module: ERouteModule.manager,
      account_id: 'account-1',
      session_id: 'session-1',
      session_platform: 'mobile',
    })),
  };

  const reply = {
    jwtSign: jest.fn(async () => 'refreshed-token'),
  };

  return {
    useCase,
    accountService,
    userService,
    authService,
    permissionService,
    redis,
    request,
    reply,
  };
}

describe('AuthRefreshTokenUseCase', () => {
  it('returns a complete refreshed session snapshot', async () => {
    const deps = buildUseCase();

    const result = await deps.useCase.execute(
      t as never,
      deps.request as never,
      deps.reply as never
    );

    expect(result.token).toBe('refreshed-token');
    expect(result.user.user_id).toBe('user-1');
    expect(result.permissions).toEqual(['chat_access']);
    expect(result.sectors).toEqual(['sector-1']);
    expect(result.channels).toEqual([{ id: 'worker-1', name: 'Canal 1' }]);
    expect(result.plan_is_active).toBe(true);
    expect(result.attendance_guard.is_blocked_now).toBe(false);
    expect(deps.redis.incr).toHaveBeenCalledTimes(1);
    expect(deps.redis.set).toHaveBeenCalledTimes(1);
  });

  it('rejects when the stored session is missing', async () => {
    const deps = buildUseCase({ activeSession: null });

    await expect(
      deps.useCase.execute(
        t as never,
        deps.request as never,
        deps.reply as never
      )
    ).rejects.toMatchObject({
      name: 'AuthRefreshTokenError',
      httpStatusCode: EHTTPStatusCode.unauthorized,
    } satisfies Partial<AuthRefreshTokenError>);
  });

  it('rejects when the active user cannot be loaded', async () => {
    const deps = buildUseCase({ user: null });

    await expect(
      deps.useCase.execute(
        t as never,
        deps.request as never,
        deps.reply as never
      )
    ).rejects.toMatchObject({
      name: 'AuthRefreshTokenError',
      httpStatusCode: EHTTPStatusCode.unauthorized,
    } satisfies Partial<AuthRefreshTokenError>);
  });

  it('rejects when the user has no permissions', async () => {
    const deps = buildUseCase({ permissions: [] });

    await expect(
      deps.useCase.execute(
        t as never,
        deps.request as never,
        deps.reply as never
      )
    ).rejects.toMatchObject({
      name: 'AuthRefreshTokenError',
      httpStatusCode: EHTTPStatusCode.forbidden,
    } satisfies Partial<AuthRefreshTokenError>);
  });
});
