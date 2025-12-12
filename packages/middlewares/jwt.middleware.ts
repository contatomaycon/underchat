import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ApiJwtViewerUseCase } from '@core/useCases/api/ApiJwtViewer.useCase';
import { container } from 'tsyringe';
import { createCacheKey } from '@core/common/functions/createCacheKey';
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

async function handleApiKeyCache(
  redis: Redis,
  cacheKey: string,
  decoded: { user_id: string },
  routeModule: string,
  module: ERouteModule,
  permissions?: EPermissionsRoles[] | null
): Promise<IJwtPermissionsWithPlan | null> {
  const cacheAuth = await redis.get(cacheKey);
  if (cacheAuth) {
    const cachedPermissions = JSON.parse(cacheAuth) as IJwtPermissionsWithPlan;
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
  responseAuth: IJwtPermissionsWithPlan
): Promise<ITokenJwtData> {
  const accountId = responseAuth.actions.find(
    (item) => item.account_id !== null
  )?.account_id;
  const permissionRoleId = responseAuth.actions.find(
    (item) => item.permission_role_id !== null
  )?.permission_role_id;

  let sectors: string[] = [];
  if (accountId) {
    const userService = container.resolve(UserService);
    sectors = await userService.listUserSectors(accountId, userId);
  }

  return {
    account_id: accountId,
    user_id: userId,
    permission_role_id: permissionRoleId,
    actions: responseAuth.actions,
    sectors,
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

  try {
    const decoded: {
      user_id: string;
      module: ERouteModule;
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

    const routeModule = getRootPath(routePath, request.module);
    const cacheKey = createCacheKey('jwtCache', decoded.user_id, routeModule);

    const responseAuth = await handleApiKeyCache(
      Redis,
      cacheKey,
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

    request.tokenJwtData = await generateTokenJwtAccess(
      decoded.user_id,
      responseAuth
    );
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
