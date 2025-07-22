import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { createCacheKey } from '@core/common/functions/createCacheKey';
import { getRootPath } from '@core/common/functions/getRootPath';
import { sendResponse } from '@core/common/functions/sendResponse';
import { ApiKeyViewerUseCase } from '@core/useCases/api/ApiKeyViewer.useCase';
import { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { hasRequiredPermission } from '@core/common/functions/hasRequiredPermission';
import { FastifyRedis } from '@fastify/redis';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import { IApiKeyMiddleware } from '@core/common/interfaces/IApiKeyMiddleware';
import { IApiKeyGroupHierarchy } from '@core/common/interfaces/IApiKeyGroupHierarchy';
import { ITokenKeyData } from '@core/common/interfaces/ITokenKeyData';
import { routePathWithoutPrefix } from '@core/common/functions/routePathWithoutPrefix';
import { ERouteModule } from '@core/common/enums/ERouteModule';

async function handleApiKeyCache(
  redis: FastifyRedis,
  cacheKey: string,
  keyapi: string | string[] | undefined,
  routeModule: string,
  module: ERouteModule
): Promise<IApiKeyGroupHierarchy[]> {
  const cacheAuth = await redis.get(cacheKey);
  if (cacheAuth) {
    return JSON.parse(cacheAuth);
  }

  const apiKeyViewerUseCase = container.resolve(ApiKeyViewerUseCase);
  const responseAuth = await apiKeyViewerUseCase.execute({
    key_api: keyapi,
    route_module: routeModule,
    module,
  } as IApiKeyMiddleware);

  if (responseAuth) {
    await redis.set(cacheKey, JSON.stringify(responseAuth), 'EX', 1800);
  }

  return responseAuth;
}

function generateTokenKeyData(
  responseAuth: IApiKeyGroupHierarchy[]
): ITokenKeyData {
  const apiKeyId = responseAuth.find(
    (item) => item.api_key_id !== null
  )?.api_key_id;

  const apiKey = responseAuth.find((item) => item.api_key !== null)?.api_key;
  const name = responseAuth.find((item) => item.name !== null)?.name;
  const accountId = responseAuth.find(
    (item) => item.account_id !== null
  )?.account_id;

  return {
    account_id: accountId,
    api_key_id: apiKeyId,
    api_key: apiKey,
    name: name,
    actions: responseAuth,
  } as ITokenKeyData;
}

async function authenticateKeyApi(
  request: FastifyRequest,
  reply: FastifyReply,
  permissions: EPermissionsRoles[] | null
): Promise<void> {
  const { t } = request;
  const { redis } = request.server;
  const { keyapi } = request.headers;
  const routePath = routePathWithoutPrefix(request);

  if (!keyapi || !routePath || !permissions) {
    return sendResponse(reply, {
      message: t('not_authorized'),
      httpStatusCode: EHTTPStatusCode.unauthorized,
    });
  }

  try {
    const routeModule = getRootPath(routePath, request.module);
    const cacheKey = createCacheKey('keyCache', keyapi, routeModule);
    const responseAuth = await handleApiKeyCache(
      redis,
      cacheKey,
      keyapi,
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

    request.tokenKeyData = generateTokenKeyData(responseAuth);

    return;
  } catch {
    return sendResponse(reply, {
      message: t('not_authorized'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
}

export default fp(async (fastify) => {
  fastify.decorate(
    'authenticateKeyApi',
    async (
      request: FastifyRequest,
      reply: FastifyReply,
      permissions: EPermissionsRoles[] | null = null
    ) => authenticateKeyApi(request, reply, permissions)
  );
});
