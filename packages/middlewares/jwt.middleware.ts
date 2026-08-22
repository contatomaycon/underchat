import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ApiJwtViewerUseCase } from '@core/useCases/api/ApiJwtViewer.useCase';
import { container } from 'tsyringe';
import {
  createJwtCacheKey,
  createJwtCacheVersionKey,
  createJwtSessionKey,
  createUserAccessScopeCacheKey,
} from '@core/common/functions/createCacheKey';
import { getRootPath } from '@core/common/functions/getRootPath';
import { hasRequiredPermission } from '@core/common/functions/hasRequiredPermission';
import { generalEnvironment } from '@core/config/environments';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { IJwtMiddleware } from '@core/common/interfaces/IJwtMiddleware';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import { ITokenJwtData } from '@core/common/interfaces/ITokenJwtData';
import { IJwtPermissionsWithPlan } from '@core/common/interfaces/IJwtPermissionsWithPlan';
import { routePathWithoutPrefix } from '@core/common/functions/routePathWithoutPrefix';
import Redis from 'ioredis';
import { UserService } from '@core/services/user.service';
import { USER_ATTENDANCE_HOURS_BLOCK_REASON } from '@core/common/functions/userAttendanceHours';
import { normalizeSessionPlatform } from '@core/common/functions/sessionPlatform';
import type { SessionPlatform } from '@core/common/types/SessionPlatform';
import { safeRedisGet, safeRedisSet } from '@core/plugins/redis';

type AuthFailureReason =
  | 'jwt_verify_failed'
  | 'route_not_found'
  | 'module_mismatch'
  | 'account_id_missing'
  | 'session_id_missing'
  | 'redis_cache_version_error'
  | 'redis_session_lookup_error'
  | 'session_not_found'
  | 'session_mismatch'
  | 'auth_viewer_empty'
  | 'token_access_account_id_missing'
  | 'unexpected_error';

type DecodedJwtPayload = {
  user_id: string;
  module: ERouteModule;
  account_id: string;
  session_id: string;
  session_platform?: string;
};

type CachedUserAccessScope = {
  account_id: string;
  sectors: string[];
  channels: ITokenJwtData['channels'];
};

const USER_ACCESS_SCOPE_CACHE_TTL_SECONDS = 120;
const JWT_ONLY_ROUTE_PATHS = new Set(['/user/me/attendance-hours/status']);

export const shouldBypassJwtAttendanceGuard = (
  routePath: string | null
): boolean => routePath !== null && JWT_ONLY_ROUTE_PATHS.has(routePath);

function logAuthFailure(
  request: FastifyRequest,
  reason: AuthFailureReason,
  details: Record<string, unknown> = {}
): void {
  request.log.warn(
    {
      type: 'auth_failure_reason',
      auth_failure_reason: reason,
      path: request.url,
      method: request.method,
      ...details,
    },
    'JWT authentication denied'
  );
}

function sendUnauthorized(
  request: FastifyRequest,
  reply: FastifyReply,
  reason: AuthFailureReason,
  details: Record<string, unknown> = {}
): ReturnType<typeof sendResponse> {
  logAuthFailure(request, reason, details);
  return sendResponse(reply, {
    message: request.t('not_authorized'),
    httpStatusCode: EHTTPStatusCode.unauthorized,
  });
}

function normalizeCacheVersion(value: string | null): string {
  if (!value) {
    return '0';
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : '0';
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function isTokenChannelArray(
  value: unknown
): value is ITokenJwtData['channels'] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { id?: unknown }).id === 'string' &&
        typeof (item as { name?: unknown }).name === 'string'
    )
  );
}

function parseCachedUserAccessScope(
  value: string | null,
  accountId: string
): CachedUserAccessScope | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<CachedUserAccessScope>;

    if (
      parsed.account_id !== accountId ||
      !isStringArray(parsed.sectors) ||
      !isTokenChannelArray(parsed.channels)
    ) {
      return null;
    }

    return {
      account_id: parsed.account_id,
      sectors: parsed.sectors,
      channels: parsed.channels,
    };
  } catch {
    return null;
  }
}

async function getCachedUserAccessScope(
  redis: Redis,
  accountId: string,
  userId: string
): Promise<CachedUserAccessScope | null> {
  const cacheKey = createUserAccessScopeCacheKey(userId);

  try {
    const cachedValue = await safeRedisGet(redis, cacheKey);
    const cachedScope = parseCachedUserAccessScope(cachedValue, accountId);

    return cachedScope;
  } catch {
    return null;
  }
}

async function setCachedUserAccessScope(
  redis: Redis,
  accountId: string,
  userId: string,
  sectors: string[],
  channels: ITokenJwtData['channels']
): Promise<void> {
  const cacheKey = createUserAccessScopeCacheKey(userId);

  try {
    await safeRedisSet(
      redis,
      cacheKey,
      JSON.stringify({
        account_id: accountId,
        sectors,
        channels,
      }),
      'EX',
      USER_ACCESS_SCOPE_CACHE_TTL_SECONDS
    );
  } catch {
    return;
  }
}

async function handleApiKeyCacheWithCachedValue(
  redis: Redis,
  cacheKey: string,
  cachedPermissionsString: string | null,
  decoded: { user_id: string; account_id: string; session_id: string },
  routeModule: string,
  module: ERouteModule,
  permissions?: EPermissionsRoles[] | null
): Promise<IJwtPermissionsWithPlan | null> {
  if (cachedPermissionsString) {
    const cachedPermissions = JSON.parse(
      cachedPermissionsString
    ) as IJwtPermissionsWithPlan;
    const hasPermission = hasRequiredPermission(
      cachedPermissions.actions,
      permissions
    );
    const canUseCache = hasPermission && cachedPermissions.plan_is_active;

    if (canUseCache) {
      return cachedPermissions;
    }
  }

  const apiJwtViewerUseCase = container.resolve(ApiJwtViewerUseCase);

  const responseAuth = await apiJwtViewerUseCase.execute({
    userId: decoded.user_id,
    routeModule,
    module,
  } as IJwtMiddleware);

  if (!responseAuth) {
    return null;
  }

  if (responseAuth.plan_is_active) {
    await redis.set(cacheKey, JSON.stringify(responseAuth), 'EX', 600);
  }

  return responseAuth;
}

async function generateTokenJwtAccess(
  userId: string,
  sessionId: string,
  sessionPlatform: SessionPlatform | null,
  responseAuth: IJwtPermissionsWithPlan,
  redis: Redis
): Promise<ITokenJwtData> {
  const accountId = responseAuth.actions.find(
    (item) => item.account_id !== null
  )?.account_id;
  const permissionRoleId = responseAuth.actions.find(
    (item) => item.permission_role_id !== null
  )?.permission_role_id;

  let sectors: string[] = [];
  let channels: ITokenJwtData['channels'] = [];
  if (accountId) {
    const cachedScope = await getCachedUserAccessScope(
      redis,
      accountId,
      userId
    );

    if (cachedScope) {
      sectors = cachedScope.sectors;
      channels = cachedScope.channels;
    } else {
      const userService = container.resolve(UserService);
      [sectors, channels] = await Promise.all([
        userService.listUserSectors(accountId, userId),
        userService.listUserChannelsWithNames(accountId, userId),
      ]);
      await setCachedUserAccessScope(
        redis,
        accountId,
        userId,
        sectors,
        channels
      );
    }
  }

  return {
    account_id: accountId,
    user_id: userId,
    session_id: sessionId,
    permission_role_id: permissionRoleId,
    actions: responseAuth.actions,
    sectors,
    channels,
    plan_is_active: responseAuth.plan_is_active,
    session_platform: sessionPlatform,
  } as ITokenJwtData;
}

async function authenticateJwt(
  request: FastifyRequest,
  reply: FastifyReply,
  permissions?: EPermissionsRoles[] | null
): Promise<void> {
  const { Redis } = request.server;
  const routePath = routePathWithoutPrefix(request);
  const shouldBypassAttendanceGuard = shouldBypassJwtAttendanceGuard(routePath);

  let decoded: DecodedJwtPayload;

  try {
    decoded = (await request.jwtVerify({
      verify: {
        key: generalEnvironment.jwtSecret,
      },
      decode: {
        complete: true,
      },
    })) as DecodedJwtPayload;
  } catch (error) {
    return sendUnauthorized(request, reply, 'jwt_verify_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    if (!decoded || !routePath) {
      return sendUnauthorized(request, reply, 'route_not_found');
    }

    if (decoded.module !== request.module) {
      return sendUnauthorized(request, reply, 'module_mismatch', {
        token_module: decoded.module,
        request_module: request.module,
      });
    }

    if (!decoded.account_id) {
      return sendUnauthorized(request, reply, 'account_id_missing');
    }

    if (!decoded.session_id) {
      return sendUnauthorized(request, reply, 'session_id_missing');
    }

    const decodedSessionPlatform = normalizeSessionPlatform(
      decoded.session_platform
    );
    const sessionKey = decodedSessionPlatform
      ? createJwtSessionKey(
          decoded.account_id,
          decoded.user_id,
          decodedSessionPlatform
        )
      : createJwtSessionKey(decoded.account_id, decoded.user_id);
    const routeModule = getRootPath(routePath, request.module);
    const cacheVersionKey = createJwtCacheVersionKey(
      decoded.account_id,
      decoded.user_id
    );
    let cacheVersion = '0';

    try {
      const cacheVersionRaw = await Redis.get(cacheVersionKey);
      cacheVersion = normalizeCacheVersion(cacheVersionRaw);
    } catch (error) {
      return sendUnauthorized(request, reply, 'redis_cache_version_error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const cacheKey = createJwtCacheKey(
      decoded.account_id,
      decoded.user_id,
      routeModule,
      cacheVersion
    );

    let activeSession: string | null = null;
    let cachedPermissions: string | null = null;

    try {
      [activeSession, cachedPermissions] = await Promise.all([
        Redis.get(sessionKey),
        Redis.get(cacheKey),
      ]);
    } catch (error) {
      return sendUnauthorized(request, reply, 'redis_session_lookup_error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (!activeSession) {
      return sendUnauthorized(request, reply, 'session_not_found', {
        session_platform: decodedSessionPlatform,
      });
    }

    if (activeSession !== decoded.session_id) {
      return sendUnauthorized(request, reply, 'session_mismatch', {
        session_platform: decodedSessionPlatform,
      });
    }

    if (!shouldBypassAttendanceGuard) {
      const userService = container.resolve(UserService);
      const attendanceGuard = await userService.getAttendanceGuardStatus(
        decoded.user_id,
        decoded.account_id
      );

      if (attendanceGuard.is_blocked_now) {
        return sendResponse(reply, {
          message: request.t('user_attendance_hours_blocked_use', {
            windows: attendanceGuard.today_windows_label ?? '--',
          }),
          httpStatusCode: EHTTPStatusCode.forbidden,
          data: {
            reason: USER_ATTENDANCE_HOURS_BLOCK_REASON,
            attendance_guard: attendanceGuard,
          },
        });
      }
    }

    const responseAuth = await handleApiKeyCacheWithCachedValue(
      Redis,
      cacheKey,
      cachedPermissions,
      decoded,
      routeModule,
      request.module,
      permissions
    );

    if (!responseAuth) {
      return sendUnauthorized(request, reply, 'auth_viewer_empty');
    }

    const hasPermission = hasRequiredPermission(
      responseAuth.actions,
      permissions
    );

    if (!hasPermission) {
      return sendResponse(reply, {
        message: request.t('permission_denied'),
        httpStatusCode: EHTTPStatusCode.forbidden,
      });
    }

    const tokenJwtData = await generateTokenJwtAccess(
      decoded.user_id,
      decoded.session_id,
      decodedSessionPlatform,
      responseAuth,
      Redis
    );

    if (!tokenJwtData.account_id) {
      return sendUnauthorized(
        request,
        reply,
        'token_access_account_id_missing'
      );
    }

    request.tokenJwtData = tokenJwtData;
    request.permissionsRoute = permissions ?? null;

    return;
  } catch (error) {
    return sendUnauthorized(request, reply, 'unexpected_error', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export default fp(async (fastify) => {
  fastify.decorate(
    'authenticateJwt',
    async (
      request: FastifyRequest,
      reply: FastifyReply,
      permissions: EPermissionsRoles[] | null = null
    ) => authenticateJwt(request, reply, permissions)
  );
});
