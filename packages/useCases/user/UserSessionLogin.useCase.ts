import { injectable, inject } from 'tsyringe';
import { SessionLoginResponse } from '@core/schema/user/sessionLogin/response.schema';
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
import { createJwtSessionKey } from '@core/common/functions/createCacheKey';
import { randomUUID } from 'node:crypto';
import { AuthService } from '@core/services/auth.service';
import Redis from 'ioredis';
import { UserAttendanceHoursBlockedError } from '@core/common/exceptions/UserAttendanceHoursBlockedError';
import type { SessionPlatform } from '@core/common/types/SessionPlatform';
import { hasChatUserStatusUpdatePermissionByPermissions } from '@core/common/functions/chatUserStatusPermission';

@injectable()
export class UserSessionLoginUseCase {
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
    const pattern = `jwtCache:${accountId}:${userId}*`;
    const stream = this.redis.scanStream({
      match: pattern,
      count: 100,
    });

    const keysToDelete: string[] = [];

    stream.on('data', (keys: string[]) => {
      keysToDelete.push(...keys);
    });

    await new Promise<void>((resolve) => {
      stream.on('end', () => {
        resolve();
      });
    });

    if (keysToDelete.length > 0) {
      await this.redis.del(...keysToDelete);
    }
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
    targetUserId: string,
    sessionPlatform: SessionPlatform
  ): Promise<SessionLoginResponse | null> {
    const userAccountId = await this.userService.getUserAccountId(targetUserId);

    if (!userAccountId) {
      throw new Error(t('user_not_found'));
    }

    const isAccountBlocked =
      await this.accountService.isAccountBlocked(userAccountId);

    if (isAccountBlocked) {
      throw new Error(t('account_blocked_contact_support'));
    }

    const userRole = await this.userService.getUserRole(targetUserId);

    if (!userRole) {
      throw new Error(t('user_without_access_group'));
    }

    const userAuthData = await this.authService.authenticateByUserId(
      targetUserId,
      userAccountId
    );

    if (!userAuthData) {
      throw new Error(t('user_without_access_group'));
    }

    const attendanceGuard = await this.userService.getAttendanceGuardStatus(
      targetUserId,
      userAccountId
    );

    if (attendanceGuard.is_blocked_now) {
      throw new UserAttendanceHoursBlockedError(
        t('user_attendance_hours_login_blocked', {
          windows: attendanceGuard.today_windows_label ?? '--',
        }),
        attendanceGuard
      );
    }

    const hadDuplicateLogin = await this.handleDuplicateLogin(
      targetUserId,
      userAccountId,
      sessionPlatform
    );
    const sessionId = randomUUID();

    const token = await reply.jwtSign(
      {
        user_id: targetUserId,
        module,
        account_id: userAccountId,
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

    const [permissions, accountInfo, sectors, channels] = await Promise.all([
      this.permissionService.viewPermissionByUserId(targetUserId),
      this.accountService.viewAccountInfoByAccountId(userAccountId),
      this.userService.listUserSectors(userAccountId, targetUserId),
      this.userService.listUserChannelsWithNames(userAccountId, targetUserId),
    ]);

    const planIsActive = await this.accountService.isPlanActive(userAccountId);

    if (hadDuplicateLogin) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const canUpdateOwnChatStatus =
      hasChatUserStatusUpdatePermissionByPermissions(permissions);

    if (canUpdateOwnChatStatus) {
      await this.presenceService.setUserAway(targetUserId);
    } else {
      await this.presenceService.setUserOnline(targetUserId);
    }
    await this.setActiveSession(
      userAccountId,
      targetUserId,
      sessionId,
      sessionPlatform
    );

    return {
      user: userAuthData,
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
