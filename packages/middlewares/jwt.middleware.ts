import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ApiJwtViewerUseCase } from '@core/useCases/api/ApiJwtViewer.useCase';
import { container } from 'tsyringe';
import {
  createJwtCacheKey,
  createJwtSessionKey,
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
  responseAuth: IJwtPermissionsWithPlan
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
    const userService = container.resolve(UserService);
    [sectors, channels] = await Promise.all([
      userService.listUserSectors(accountId, userId),
      userService.listUserChannelsWithNames(accountId, userId),
    ]);
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
  } as ITokenJwtData;
}

async function authenticateJwt(
  request: FastifyRequest,
  reply: FastifyReply,
  permissions?: EPermissionsRoles[] | null
): Promise<void> {
  const { t } = request;
  const { Redis } = request.server;
  const routePath = routePathWithoutPrefix(request);
  const shouldBypassAttendanceGuard =
    routePath === '/user/me/attendance-hours/status';

  try {
    const decoded: {
      user_id: string;
      module: ERouteModule;
      account_id: string;
      session_id: string;
    } = await request.jwtVerify({
      verify: {
        key: generalEnvironment.jwtSecret,
      },
      decode: {
        complete: true,
      },
    });

    if (!decoded || !routePath) {
      return sendResponse(reply, {
        message: t('not_authorized'),
        httpStatusCode: EHTTPStatusCode.unauthorized,
      });
    }

    if (decoded.module !== request.module) {
      return sendResponse(reply, {
        message: t('not_authorized'),
        httpStatusCode: EHTTPStatusCode.unauthorized,
      });
    }

    if (!decoded.account_id) {
      return sendResponse(reply, {
        message: t('not_authorized'),
        httpStatusCode: EHTTPStatusCode.unauthorized,
      });
    }

    if (!decoded.session_id) {
      return sendResponse(reply, {
        message: t('not_authorized'),
        httpStatusCode: EHTTPStatusCode.unauthorized,
      });
    }

    const sessionKey = createJwtSessionKey(decoded.account_id, decoded.user_id);
    const routeModule = getRootPath(routePath, request.module);
    const cacheKey = createJwtCacheKey(
      decoded.account_id,
      decoded.user_id,
      routeModule
    );

    const [activeSession, cachedPermissions] = await Promise.all([
      Redis.get(sessionKey),
      Redis.get(cacheKey),
    ]);

    if (!activeSession) {
      return sendResponse(reply, {
        message: t('not_authorized'),
        httpStatusCode: EHTTPStatusCode.unauthorized,
      });
    }

    if (activeSession !== decoded.session_id) {
      return sendResponse(reply, {
        message: t('not_authorized'),
        httpStatusCode: EHTTPStatusCode.unauthorized,
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
          message: t('user_attendance_hours_blocked_use', {
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
      return sendResponse(reply, {
        message: t('not_authorized'),
        httpStatusCode: EHTTPStatusCode.unauthorized,
      });
    }

    const hasPermission = hasRequiredPermission(
      responseAuth.actions,
      permissions
    );

    if (!hasPermission) {
      return sendResponse(reply, {
        message: t('not_authorized'),
        httpStatusCode: EHTTPStatusCode.unauthorized,
      });
    }

    const tokenJwtData = await generateTokenJwtAccess(
      decoded.user_id,
      decoded.session_id,
      responseAuth
    );

    if (!tokenJwtData.account_id) {
      return sendResponse(reply, {
        message: t('not_authorized'),
        httpStatusCode: EHTTPStatusCode.unauthorized,
      });
    }

    request.tokenJwtData = tokenJwtData;
    request.permissionsRoute = permissions ?? null;

    return;
  } catch {
    return sendResponse(reply, {
      message: t('not_authorized'),
      httpStatusCode: EHTTPStatusCode.unauthorized,
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
