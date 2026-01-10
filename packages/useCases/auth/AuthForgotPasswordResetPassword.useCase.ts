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

@injectable()
export class AuthForgotPasswordResetPasswordUseCase {
  constructor(
    private readonly userService: UserService,
    private readonly authRepository: AuthRepository,
    private readonly permissionService: PermissionService,
    private readonly accountService: AccountService,
    private readonly presenceService: PresenceService,
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
    accountId: string
  ): Promise<void> {
    try {
      const channel = chatAccountCentrifugo(accountId);

      await this.centrifugoService.publishSub(channel, {
        event: 'force_logout',
        user_id: userId,
      });
    } catch (error) {
      console.error('Failed to notify previous session', error);
    }
  }

  private async handleDuplicateLogin(
    userId: string,
    accountId: string
  ): Promise<boolean> {
    const isAlreadyLoggedIn = await this.presenceService.isUserLoggedIn(userId);

    if (!isAlreadyLoggedIn) {
      return false;
    }

    await this.invalidateUserJwtCache(accountId, userId);
    await this.notifyPreviousSession(userId, accountId);

    return true;
  }

  private async setActiveSession(
    accountId: string,
    userId: string,
    sessionId: string
  ): Promise<void> {
    const sessionKey = createJwtSessionKey(accountId, userId);
    await this.redis.set(sessionKey, sessionId);
  }

  async execute(
    t: TFunction<'translation', undefined>,
    reply: FastifyReply,
    module: ERouteModule,
    userId: string,
    accountId: string,
    input: AuthForgotPasswordResetPasswordRequest
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

    const hadDuplicateLogin = await this.handleDuplicateLogin(
      userId,
      accountId
    );
    const sessionId = randomUUID();

    const token = await reply.jwtSign(
      {
        user_id: userId,
        module,
        account_id: accountId,
        session_id: sessionId,
      },
      {
        sign: {
          expiresIn: generalEnvironment.jwtSecretExpiresIn,
          key: generalEnvironment.jwtSecret,
        },
      }
    );

    const [permissions, accountInfo, sectors] = await Promise.all([
      this.permissionService.viewPermissionByUserId(userId),
      this.accountService.viewAccountInfoByAccountId(accountId),
      this.userService.listUserSectors(accountId, userId),
    ]);

    const planIsActive = await this.accountService.isPlanActive(accountId);

    if (hadDuplicateLogin) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    await this.presenceService.setUserAway(userId);
    await this.setActiveSession(accountId, userId, sessionId);

    return {
      user: userResult,
      token,
      permissions,
      layout: accountInfo,
      sectors,
      plan_is_active: planIsActive,
    };
  }
}
