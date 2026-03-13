import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AuthForgotPasswordResetPasswordRequest } from '@core/schema/auth/forgotPassword/resetPassword/request.schema';
import { AuthForgotPasswordResetPasswordResponse } from '@core/schema/auth/forgotPassword/resetPassword/response.schema';
import { UserService } from '@core/services/user.service';
import { validatePassword } from '@core/common/utils/passwordValidator';
import { FastifyReply } from 'fastify';
import { generalEnvironment } from '@core/config/environments';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { PermissionService } from '@core/services/permission.service';
import { AccountService } from '@core/services/account.service';
import { PresenceService } from '@core/services/presence.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { chatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import Redis from 'ioredis';
import { createJwtSessionKey } from '@core/common/functions/createCacheKey';
import { randomUUID } from 'node:crypto';
import { AuthRepository } from '@core/repositories/auth/Auth.repository';
import { UserAttendanceHoursBlockedError } from '@core/common/exceptions/UserAttendanceHoursBlockedError';
import type { SessionPlatform } from '@core/common/types/SessionPlatform';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';

@injectable()
export class AuthForgotPasswordResetPasswordUseCase {
  constructor(
    @inject(UserService)
    private readonly userService: UserService,
    @inject(AuthRepository)
    private readonly authRepository: AuthRepository,
    @inject(PermissionService)
    private readonly permissionService: PermissionService,
    @inject(AccountService)
    private readonly accountService: AccountService,
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
    userId: string,
    accountId: string,
    input: AuthForgotPasswordResetPasswordRequest,
    sessionPlatform: SessionPlatform
  ): Promise<AuthForgotPasswordResetPasswordResponse> {
    if (input.new_password !== input.confirm_password) {
      throw new Error(t('passwords_do_not_match'));
    }

    const passwordValidation = validatePassword(input.new_password);
    if (!passwordValidation.isValid) {
      const errorMessages = passwordValidation.errors.map((err) => t(err));
      throw new Error(errorMessages.join(', '));
    }

    await this.userService.updateUserPassword(
      t,
      userId,
      accountId,
      input.new_password
    );

    const userResult = await this.authRepository.findUserById(userId);

    if (!userResult) {
      throw new Error(t('forgot_password_user_not_found'));
    }

    const isAccountBlocked =
      await this.accountService.isAccountBlocked(accountId);

    if (isAccountBlocked) {
      throw new Error(t('account_blocked_contact_support'));
    }

    const attendanceGuard = await this.userService.getAttendanceGuardStatus(
      userId,
      accountId
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
      userId,
      accountId,
      sessionPlatform
    );
    const sessionId = randomUUID();

    const token = await reply.jwtSign(
      {
        user_id: userId,
        module,
        account_id: accountId,
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
      this.permissionService.viewPermissionByUserId(userId),
      this.accountService.viewAccountInfoByAccountId(accountId),
      this.userService.listUserSectors(accountId, userId),
      this.userService.listUserChannelsWithNames(accountId, userId),
    ]);

    const planIsActive = await this.accountService.isPlanActive(accountId);

    if (hadDuplicateLogin) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    await this.presenceService.setUserOnline(userId);

    if (userResult.chat_user) {
      userResult.chat_user.status = EChatUserStatus.online;
    }

    await this.setActiveSession(accountId, userId, sessionId, sessionPlatform);

    return {
      user: userResult,
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
