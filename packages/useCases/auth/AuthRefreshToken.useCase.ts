import { inject, injectable } from 'tsyringe';
import { generalEnvironment } from '@core/config/environments';
import { FastifyReply, FastifyRequest } from 'fastify';
import { TFunction } from 'i18next';
import { RefreshTokenResponse } from '@core/schema/auth/refrehToken/response.schema';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { AccountService } from '@core/services/account.service';
import { UserService } from '@core/services/user.service';
import Redis from 'ioredis';
import { createJwtSessionKey } from '@core/common/functions/createCacheKey';

@injectable()
export class AuthRefreshTokenUseCase {
  constructor(
    private readonly accountService: AccountService,
    private readonly userService: UserService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<RefreshTokenResponse> {
    const decodeToken: {
      user_id: string;
      module: ERouteModule;
      account_id: string;
      session_id: string;
    } = await request.jwtVerify({
      verify: {
        key: generalEnvironment.jwtSecret,
        ignoreExpiration: true,
      },
      decode: {
        complete: true,
      },
    });

    if (!decodeToken) {
      throw new Error(t('invalid_token'));
    }

    if (decodeToken.module !== request.module) {
      throw new Error(t('invalid_token_module'));
    }

    if (!decodeToken.account_id) {
      throw new Error(t('invalid_token'));
    }

    const accountId = await this.userService.getUserAccountId(
      decodeToken.user_id
    );

    if (!accountId) {
      throw new Error(t('invalid_token'));
    }

    if (accountId !== decodeToken.account_id) {
      throw new Error(t('invalid_token'));
    }

    if (!decodeToken.session_id) {
      throw new Error(t('invalid_token'));
    }

    const sessionKey = createJwtSessionKey(accountId, decodeToken.user_id);
    const activeSession = await this.redis.get(sessionKey);

    if (!activeSession) {
      throw new Error(t('invalid_token'));
    }

    if (activeSession !== decodeToken.session_id) {
      throw new Error(t('invalid_token'));
    }

    const payload = {
      user_id: decodeToken.user_id,
      module: request.module,
      account_id: accountId,
      session_id: decodeToken.session_id,
    };

    const token = await reply.jwtSign(payload, {
      sign: {
        expiresIn: generalEnvironment.jwtSecretExpiresIn,
        key: generalEnvironment.jwtSecret,
      },
    });

    const planIsActive = await this.accountService.isPlanActive(accountId);

    return {
      token,
      plan_is_active: planIsActive,
    };
  }
}
