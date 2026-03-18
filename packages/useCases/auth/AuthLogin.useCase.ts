import { AuthService } from '@core/services/auth.service';
import { injectable, inject } from 'tsyringe';
import { AuthLoginResponse } from '@core/schema/auth/login/response.schema';
import { AuthLoginRequest } from '@core/schema/auth/login/request.schema';
import { FastifyReply } from 'fastify';
import { TFunction } from 'i18next';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { generalEnvironment } from '@core/config/environments';
import { PermissionService } from '@core/services/permission.service';
import { AccountService } from '@core/services/account.service';
import { UserService } from '@core/services/user.service';
import { PresenceService } from '@core/services/presence.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { chatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import Redis from 'ioredis';
import {
  createJwtCacheVersionKey,
  createJwtSessionKey,
} from '@core/common/functions/createCacheKey';
import { randomUUID } from 'node:crypto';
import { UserAttendanceHoursBlockedError } from '@core/common/exceptions/UserAttendanceHoursBlockedError';
import type { SessionPlatform } from '@core/common/types/SessionPlatform';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';

@injectable()
export class AuthLoginUseCase {
  constructor(
    @inject(AuthService)
    private readonly authService: AuthService,
    @inject(PermissionService)
    private readonly permissionService: PermissionService,
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(UserService)
    private readonly userService: UserService,
    @inject(PresenceService)
    private readonly presenceService: PresenceService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  private async invalidateUserJwtCache(
    accountId: string,
    userId: string
  ): Promise<void> {
    const cacheVersionKey = createJwtCacheVersionKey(accountId, userId);
    await this.redis.incr(cacheVersionKey);
  }

  private async notifyPreviousSession(
    userId: string,
    accountId: string,
    sessionPlatform: SessionPlatform
  ): Promise<void> {
    try {
      const channel = chatAccountCentrifugo(accountId);

      await this.centrifugoService.publishSub(channel, {
        event: 'force_logout',
        user_id: userId,
        session_platform: sessionPlatform,
      });
    } catch (error) {
      console.error('Failed to notify previous session', error);
    }
  }

  private async hasActiveSession(
    accountId: string,
    userId: string,
    sessionPlatform: SessionPlatform
  ): Promise<boolean> {
    const sessionKey = createJwtSessionKey(accountId, userId, sessionPlatform);

    if (sessionPlatform === 'web') {
      const legacySessionKey = createJwtSessionKey(accountId, userId);
      const [activeSession, legacySession] = await Promise.all([
        this.redis.get(sessionKey),
        this.redis.get(legacySessionKey),
      ]);

      return Boolean(activeSession || legacySession);
    }

    const activeSession = await this.redis.get(sessionKey);
    return Boolean(activeSession);
  }

  private async handleDuplicateLogin(
    userId: string,
    accountId: string,
    sessionPlatform: SessionPlatform
  ): Promise<boolean> {
    const isAlreadyLoggedIn = await this.hasActiveSession(
      accountId,
      userId,
      sessionPlatform
    );

    if (!isAlreadyLoggedIn) {
      return false;
    }

    await this.invalidateUserJwtCache(accountId, userId);
    await this.notifyPreviousSession(userId, accountId, sessionPlatform);

    return true;
  }

  private async setActiveSession(
    accountId: string,
    userId: string,
    sessionId: string,
    sessionPlatform: SessionPlatform
  ): Promise<void> {
    const sessionKey = createJwtSessionKey(accountId, userId, sessionPlatform);

    if (sessionPlatform === 'web') {
      const legacySessionKey = createJwtSessionKey(accountId, userId);
      await Promise.all([
        this.redis.set(sessionKey, sessionId),
        this.redis.del(legacySessionKey),
      ]);
      return;
    }

    await this.redis.set(sessionKey, sessionId);
  }

  async execute(
    t: TFunction<'translation', undefined>,
    reply: FastifyReply,
    module: ERouteModule,
    input: AuthLoginRequest,
    sessionPlatform: SessionPlatform
  ): Promise<AuthLoginResponse | null> {
    const result = await this.authService.authenticate(
      input.login,
      input.password
    );

    if (!result) {
      const hasValidCredentials = await this.authService.hasValidCredentials(
        input.login,
        input.password
      );

      if (hasValidCredentials) {
        throw new Error(t('user_without_access_group'));
      }

      throw new Error(t('login_invalid'));
    }

    const isAccountBlocked = await this.accountService.isAccountBlocked(
      result.account_id
    );

    if (isAccountBlocked) {
      throw new Error(t('account_blocked_contact_support'));
    }

    const attendanceGuard = await this.userService.getAttendanceGuardStatus(
      result.user_id,
      result.account_id
    );

    if (attendanceGuard.is_blocked_now) {
      throw new UserAttendanceHoursBlockedError(
        t('user_attendance_hours_login_blocked', {
          windows: attendanceGuard.today_windows_label ?? '--',
        }),
        attendanceGuard
      );
    }

    const permissions = await this.permissionService.viewPermissionByUserId(
      result.user_id
    );

    if (!permissions.length) {
      throw new Error(t('user_without_access_permissions'));
    }

    const hadDuplicateLogin = await this.handleDuplicateLogin(
      result.user_id,
      result.account_id,
      sessionPlatform
    );
    await this.invalidateUserJwtCache(result.account_id, result.user_id);
    const sessionId = randomUUID();

    const token = await reply.jwtSign(
      {
        user_id: result.user_id,
        module,
        account_id: result.account_id,
        session_id: sessionId,
        session_platform: sessionPlatform,
      },
      {
        sign: {
          expiresIn: generalEnvironment.jwtSecretExpiresIn,
          key: generalEnvironment.jwtSecret,
        },
      }
    );

    const [accountInfo, sectors, channels] = await Promise.all([
      this.accountService.viewAccountInfoByAccountId(result.account_id),
      this.userService.listUserSectors(result.account_id, result.user_id),
      this.userService.listUserChannelsWithNames(
        result.account_id,
        result.user_id
      ),
    ]);

    const planIsActive = await this.accountService.isPlanActive(
      result.account_id
    );

    if (hadDuplicateLogin) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    await this.presenceService.setUserOnline(result.user_id);

    if (result.chat_user) {
      result.chat_user.status = EChatUserStatus.online;
    }

    await this.setActiveSession(
      result.account_id,
      result.user_id,
      sessionId,
      sessionPlatform
    );

    return {
      user: result,
      token,
      permissions,
      layout: accountInfo,
      sectors,
      channels,
      plan_is_active: planIsActive,
      attendance_guard: attendanceGuard,
    };
  }
}
