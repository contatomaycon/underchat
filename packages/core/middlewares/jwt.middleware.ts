import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ApiJwtViewerUseCase } from '@core/useCases/api/ApiJwtViewer.useCase';
import { container } from 'tsyringe';
import { createCacheKey } from '@core/common/functions/createCacheKey';
import { getRootPath } from '@core/common/functions/getRootPath';
import { hasRequiredPermission } from '@core/common/functions/hasRequiredPermission';
import { FastifyRedis } from '@fastify/redis';
import { generalEnvironment } from '@core/config/environments';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { IJwtMiddleware } from '@core/common/interfaces/IJwtMiddleware';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { ITokenJwtData } from '@core/common/interfaces/ITokenJwtData';
import { routePathWithoutPrefix } from '@core/common/functions/routePathWithoutPrefix';

async function handleApiKeyCache(
  redis: FastifyRedis,
  cacheKey: string,
  decoded: { user_id: string },
  routeModule: string,
  module: ERouteModule
): Promise<IJwtGroupHierarchy[]> {
  const cacheAuth = await redis.get(cacheKey);
  if (cacheAuth) {
    return JSON.parse(cacheAuth);
  }

  const apiJwtViewerUseCase = container.resolve(ApiJwtViewerUseCase);

  const responseAuth = await apiJwtViewerUseCase.execute({
    userId: decoded.user_id,
    routeModule,
    module,
  } as IJwtMiddleware);

  if (responseAuth) {
    await redis.set(cacheKey, JSON.stringify(responseAuth), 'EX', 1800);
  }

  return responseAuth;
}

function generateTokenJwtAccess(
  userId: string,
  responseAuth: IJwtGroupHierarchy[]
): ITokenJwtData {
  return {
    user_id: userId,
    actions: responseAuth,
  } as ITokenJwtData;
}

async function authenticateJwt(
  request: FastifyRequest,
  reply: FastifyReply,
  permissions: EPermissionsRoles[] | null
): Promise<void> {
  const { t } = request;
  const { redis } = request.server;
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

    if (!decoded || !routePath || !permissions) {
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
      redis,
      cacheKey,
      decoded,
      routeModule,
      request.module
    );

    if (!responseAuth) {
      return sendResponse(reply, {
        message: t('not_authorized'),
        httpStatusCode: EHTTPStatusCode.unauthorized,
      });
    }

    const hasPermission = hasRequiredPermission(responseAuth, permissions);

    if (!hasPermission) {
      return sendResponse(reply, {
        message: t('not_authorized'),
        httpStatusCode: EHTTPStatusCode.unauthorized,
      });
    }

    await redis.set(cacheKey, JSON.stringify(responseAuth), 'EX', 1800);

    request.tokenJwtData = generateTokenJwtAccess(
      decoded.user_id,
      responseAuth
    );
    request.permissionsRoute = permissions;

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
