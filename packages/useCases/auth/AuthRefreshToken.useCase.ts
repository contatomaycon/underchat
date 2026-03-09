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
import { AuthRefreshTokenError } from '@core/common/exceptions/AuthRefreshTokenError';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';

@injectable()
export class AuthRefreshTokenUseCase {
  constructor(
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(UserService)
    private readonly userService: UserService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<RefreshTokenResponse> {
    let decodeToken: {
      user_id: string;
      module: ERouteModule;
      account_id: string;
      session_id: string;
    };

    try {
      decodeToken = await request.jwtVerify({
        verify: {
          key: generalEnvironment.jwtSecret,
          ignoreExpiration: true,
        },
        decode: {
          complete: true,
        },
      });
    } catch {
      throw new AuthRefreshTokenError(
        t('invalid_token'),
        EHTTPStatusCode.unauthorized
      );
    }

    if (!decodeToken) {
      throw new AuthRefreshTokenError(
        t('invalid_token'),
        EHTTPStatusCode.unauthorized
      );
    }

    if (decodeToken.module !== request.module) {
      throw new AuthRefreshTokenError(
        t('invalid_token_module'),
        EHTTPStatusCode.unauthorized
      );
    }

    if (!decodeToken.account_id) {
      throw new AuthRefreshTokenError(
        t('invalid_token'),
        EHTTPStatusCode.unauthorized
      );
    }

    const accountId = await this.userService.getUserAccountId(
      decodeToken.user_id
    );

    if (!accountId) {
      throw new AuthRefreshTokenError(
        t('invalid_token'),
        EHTTPStatusCode.unauthorized
      );
    }

    if (accountId !== decodeToken.account_id) {
      throw new AuthRefreshTokenError(
        t('invalid_token'),
        EHTTPStatusCode.unauthorized
      );
    }

    if (!decodeToken.session_id) {
      throw new AuthRefreshTokenError(
        t('invalid_token'),
        EHTTPStatusCode.unauthorized
      );
    }

    const sessionKey = createJwtSessionKey(accountId, decodeToken.user_id);
    const activeSession = await this.redis.get(sessionKey);

    if (!activeSession) {
      throw new AuthRefreshTokenError(
        t('invalid_token'),
        EHTTPStatusCode.unauthorized
      );
    }

    if (activeSession !== decodeToken.session_id) {
      throw new AuthRefreshTokenError(
        t('invalid_token'),
        EHTTPStatusCode.unauthorized
      );
    }

    const isAccountBlocked =
      await this.accountService.isAccountBlocked(accountId);

    if (isAccountBlocked) {
      throw new AuthRefreshTokenError(
        t('account_blocked_contact_support'),
        EHTTPStatusCode.forbidden
      );
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
