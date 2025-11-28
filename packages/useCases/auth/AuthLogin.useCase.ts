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
import { UserAccountViewerRepository } from '@core/repositories/user/UserAccountViewer.repository';
import { chatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import Redis from 'ioredis';

@injectable()
export class AuthLoginUseCase {
  constructor(
    private readonly authService: AuthService,
    private readonly permissionService: PermissionService,
    private readonly accountService: AccountService,
    private readonly userService: UserService,
    @inject('Redis') private readonly redis: Redis,
    private readonly presenceService: PresenceService,
    private readonly centrifugoService: CentrifugoService,
    private readonly userAccountViewerRepository: UserAccountViewerRepository
  ) {}

  private async invalidateUserJwtCache(userId: string): Promise<void> {
    const pattern = `jwtCache:${userId}*`;
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

  private async handleDuplicateLogin(userId: string): Promise<void> {
    const isAlreadyLoggedIn = await this.presenceService.isUserLoggedIn(userId);

    if (!isAlreadyLoggedIn) {
      return;
    }

    const [accountId] = await Promise.all([
      this.userAccountViewerRepository.getUserAccountId(userId),
      this.invalidateUserJwtCache(userId),
    ]);

    if (accountId) {
      await this.notifyPreviousSession(userId, accountId);
    }
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

    await this.handleDuplicateLogin(result.user_id);

    const token = await reply.jwtSign(
      {
        user_id: result.user_id,
        module,
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
      this.presenceService.setUserAway(result.user_id).then(() => undefined),
    ]);

    return {
      user: result,
      token,
      permissions,
      layout: accountInfo,
      sectors,
    };
  }
}
