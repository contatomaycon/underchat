import { injectable, inject } from 'tsyringe';
import { AuthLoginResponse } from '@core/schema/auth/login/response.schema';
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

@injectable()
export class AuthMasterSessionLoginUseCase {
  constructor(
    private readonly authService: AuthService,
    private readonly permissionService: PermissionService,
    private readonly accountService: AccountService,
    private readonly userService: UserService,
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
    targetAccountId: string
  ): Promise<AuthLoginResponse | null> {
    const masterUser =
      await this.userService.findMasterUserByAccountId(targetAccountId);

    if (!masterUser) {
      throw new Error(t('master_user_not_found'));
    }

    const isAccountBlocked =
      await this.accountService.isAccountBlocked(targetAccountId);

    if (isAccountBlocked) {
      throw new Error(t('account_blocked_contact_support'));
    }

    const userAuthData = await this.authService.authenticateByUserId(
      masterUser.user_id,
      targetAccountId
    );

    if (!userAuthData) {
      throw new Error(t('user_not_found'));
    }

    const hadDuplicateLogin = await this.handleDuplicateLogin(
      masterUser.user_id,
      targetAccountId
    );
    const sessionId = randomUUID();

    const token = await reply.jwtSign(
      {
        user_id: masterUser.user_id,
        module,
        account_id: targetAccountId,
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
      this.permissionService.viewPermissionByUserId(masterUser.user_id),
      this.accountService.viewAccountInfoByAccountId(targetAccountId),
      this.userService.listUserSectors(targetAccountId, masterUser.user_id),
    ]);

    const planIsActive =
      await this.accountService.isPlanActive(targetAccountId);

    if (hadDuplicateLogin) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    await this.presenceService.setUserAway(masterUser.user_id);
    await this.setActiveSession(targetAccountId, masterUser.user_id, sessionId);

    return {
      user: userAuthData,
      token,
      permissions,
      layout: accountInfo,
      sectors,
      plan_is_active: planIsActive,
    };
  }
}
