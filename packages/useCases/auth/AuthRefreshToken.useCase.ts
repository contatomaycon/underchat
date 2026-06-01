import { inject, injectable } from 'tsyringe';
import { generalEnvironment } from '@core/config/environments';
import { FastifyReply, FastifyRequest } from 'fastify';
import { TFunction } from 'i18next';
import { RefreshTokenResponse } from '@core/schema/auth/refrehToken/response.schema';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { AccountService } from '@core/services/account.service';
import { UserService } from '@core/services/user.service';
import { AuthService } from '@core/services/auth.service';
import { PermissionService } from '@core/services/permission.service';
import Redis from 'ioredis';
import {
  createJwtCacheVersionKey,
  createJwtSessionKey,
} from '@core/common/functions/createCacheKey';
import { AuthRefreshTokenError } from '@core/common/exceptions/AuthRefreshTokenError';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import {
  DEFAULT_SESSION_PLATFORM,
  normalizeSessionPlatform,
} from '@core/common/functions/sessionPlatform';
import type { SessionPlatform } from '@core/common/types/SessionPlatform';

@injectable()
export class AuthRefreshTokenUseCase {
  constructor(
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(UserService)
    private readonly userService: UserService,
    @inject(AuthService)
    private readonly authService: AuthService,
    @inject(PermissionService)
    private readonly permissionService: PermissionService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  private async invalidateUserJwtCache(
    accountId: string,
    userId: string
  ): Promise<void> {
    const cacheVersionKey = createJwtCacheVersionKey(accountId, userId);
    await this.redis.incr(cacheVersionKey);
  }

  private async resolveActiveSession(
    accountId: string,
    userId: string,
    sessionPlatform: SessionPlatform | null
  ): Promise<{
    activeSession: string | null;
    isLegacySession: boolean;
  }> {
    if (!sessionPlatform) {
      const legacyKey = createJwtSessionKey(accountId, userId);
      const legacySession = await this.redis.get(legacyKey);

      if (legacySession) {
        return {
          activeSession: legacySession,
          isLegacySession: true,
        };
      }

      const webSessionKey = createJwtSessionKey(
        accountId,
        userId,
        DEFAULT_SESSION_PLATFORM
      );
      const webSession = await this.redis.get(webSessionKey);

      return {
        activeSession: webSession,
        isLegacySession: false,
      };
    }

    const sessionKey = createJwtSessionKey(accountId, userId, sessionPlatform);
    const activeSession = await this.redis.get(sessionKey);

    return {
      activeSession,
      isLegacySession: false,
    };
  }

  private async persistPlatformSession(
    accountId: string,
    userId: string,
    sessionId: string,
    sessionPlatform: SessionPlatform,
    isLegacySession: boolean
  ): Promise<void> {
    const sessionKey = createJwtSessionKey(accountId, userId, sessionPlatform);

    if (isLegacySession && sessionPlatform === DEFAULT_SESSION_PLATFORM) {
      const legacyKey = createJwtSessionKey(accountId, userId);
      await Promise.all([
        this.redis.set(sessionKey, sessionId),
        this.redis.del(legacyKey),
      ]);
      return;
    }

    await this.redis.set(sessionKey, sessionId);
  }

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
      session_platform?: string;
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

    const decodedSessionPlatform = normalizeSessionPlatform(
      decodeToken.session_platform
    );
    const sessionPlatform = decodedSessionPlatform ?? DEFAULT_SESSION_PLATFORM;
    const { activeSession, isLegacySession } = await this.resolveActiveSession(
      accountId,
      decodeToken.user_id,
      decodedSessionPlatform
    );

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

    const userAuthData = await this.authService.authenticateByUserId(
      decodeToken.user_id,
      accountId
    );

    if (!userAuthData) {
      throw new AuthRefreshTokenError(
        t('invalid_token'),
        EHTTPStatusCode.unauthorized
      );
    }

    const permissions = await this.permissionService.viewPermissionByUserId(
      decodeToken.user_id
    );

    if (!permissions.length) {
      throw new AuthRefreshTokenError(
        t('user_without_access_permissions'),
        EHTTPStatusCode.forbidden
      );
    }

    const payload = {
      user_id: decodeToken.user_id,
      module: request.module,
      account_id: accountId,
      session_id: decodeToken.session_id,
      session_platform: sessionPlatform,
    };

    const token = await reply.jwtSign(payload, {
      sign: {
        expiresIn: generalEnvironment.jwtSecretExpiresIn,
        key: generalEnvironment.jwtSecret,
      },
    });

    const planIsActive = await this.accountService.isPlanActive(accountId);

    const [accountInfo, sectors, channels, attendanceGuard] = await Promise.all(
      [
        this.accountService.viewAccountInfoByAccountId(accountId),
        this.userService.listUserSectors(accountId, decodeToken.user_id),
        this.userService.listUserChannelsWithNames(
          accountId,
          decodeToken.user_id
        ),
        this.userService.getAttendanceGuardStatus(
          decodeToken.user_id,
          accountId
        ),
      ]
    );

    await Promise.all([
      this.invalidateUserJwtCache(accountId, decodeToken.user_id),
      this.persistPlatformSession(
        accountId,
        decodeToken.user_id,
        decodeToken.session_id,
        sessionPlatform,
        isLegacySession
      ),
    ]);

    return {
      token,
      user: userAuthData,
      permissions,
      layout: accountInfo,
      sectors,
      channels,
      plan_is_active: planIsActive,
      attendance_guard: attendanceGuard,
    };
  }
}
