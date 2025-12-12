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
import { createJwtSessionKey } from '@core/common/functions/createCacheKey';
import { randomUUID } from 'node:crypto';

@injectable()
export class AuthLoginUseCase {
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
    input: AuthLoginRequest
  ): Promise<AuthLoginResponse | null> {
    const result = await this.authService.authenticate(
      input.login,
      input.password
    );

    if (!result) {
      throw new Error(t('login_invalid'));
    }

    const hadDuplicateLogin = await this.handleDuplicateLogin(
      result.user_id,
      result.account_id
    );
    const sessionId = randomUUID();

    const token = await reply.jwtSign(
      {
        user_id: result.user_id,
        module,
        account_id: result.account_id,
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
      this.permissionService.viewPermissionByUserId(result.user_id),
      this.accountService.viewAccountInfoByAccountId(result.account_id),
      this.userService.listUserSectors(result.account_id, result.user_id),
    ]);

    const planIsActive = await this.accountService.isPlanActive(
      result.account_id
    );

    if (hadDuplicateLogin) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    await this.presenceService.setUserAway(result.user_id);
    await this.setActiveSession(result.account_id, result.user_id, sessionId);

    return {
      user: result,
      token,
      permissions,
      layout: accountInfo,
      sectors,
      plan_is_active: planIsActive,
    };
  }
}
