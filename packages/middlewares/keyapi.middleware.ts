import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { createKeyApiCacheKey } from '@core/common/functions/createCacheKey';
import { getRootPath } from '@core/common/functions/getRootPath';
import { sendResponse } from '@core/common/functions/sendResponse';
import { ApiKeyViewerUseCase } from '@core/useCases/api/ApiKeyViewer.useCase';
import { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { IApiKeyMiddleware } from '@core/common/interfaces/IApiKeyMiddleware';
import { IApiKeyGroupHierarchy } from '@core/common/interfaces/IApiKeyGroupHierarchy';
import { ITokenKeyData } from '@core/common/interfaces/ITokenKeyData';
import { routePathWithoutPrefix } from '@core/common/functions/routePathWithoutPrefix';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import Redis from 'ioredis';

function getKeyApiValue(keyapi: string | string[] | undefined): string | null {
  if (!keyapi) {
    return null;
  }

  if (Array.isArray(keyapi)) {
    return keyapi[0] ?? null;
  }

  return keyapi;
}

function getKeyApiFromUrl(
  routePath: string | null,
  params: Record<string, string | undefined> | null
): string | null {
  if (params?.keyapi) {
    return params.keyapi;
  }

  if (!routePath) {
    return null;
  }

  const webhookMatch = routePath.match(/\/webhook\/([^/]+)/);
  if (webhookMatch && webhookMatch[1]) {
    return webhookMatch[1];
  }

  return null;
}

async function handleApiKeyCache(
  redis: Redis,
  cacheKey: string,
  keyapi: string,
  routeModule: string,
  module: ERouteModule
): Promise<IApiKeyGroupHierarchy[]> {
  const cacheAuth = await redis.get(cacheKey);
  if (cacheAuth) {
    const cachedData = JSON.parse(cacheAuth) as IApiKeyGroupHierarchy[];
    if (cachedData && cachedData.length > 0) {
      return cachedData;
    }
  }

  const apiKeyViewerUseCase = container.resolve(ApiKeyViewerUseCase);
  const responseAuth = await apiKeyViewerUseCase.execute({
    key_api: keyapi,
    route_module: routeModule,
    module,
  } as IApiKeyMiddleware);

  if (responseAuth && responseAuth.length > 0) {
    await redis.set(cacheKey, JSON.stringify(responseAuth), 'EX', 1800);
  }

  return responseAuth;
}

function generateTokenKeyData(
  responseAuth: IApiKeyGroupHierarchy[]
): ITokenKeyData {
  const firstItem = responseAuth[0];

  if (!firstItem) {
    throw new Error('No API key data found');
  }

  return {
    account_id: firstItem.account_id,
    api_key_id: firstItem.api_key_id,
    api_key: firstItem.api_key,
    name: firstItem.name,
    actions: responseAuth,
  };
}

async function authenticateKeyApi(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { t } = request;
  const { Redis } = request.server;
  const { keyapi: headerKeyApi } = request.headers;
  const routePath = routePathWithoutPrefix(request);
  const headerKeyApiValue = getKeyApiValue(headerKeyApi);
  const urlKeyApi = getKeyApiFromUrl(
    routePath,
    request.params as Record<string, string | undefined> | null
  );
  const keyapi = headerKeyApiValue || urlKeyApi;

  if (!keyapi || !routePath) {
    return sendResponse(reply, {
      message: t('not_authorized'),
      httpStatusCode: EHTTPStatusCode.unauthorized,
    });
  }

  try {
    const routeModule = getRootPath(routePath, request.module);
    const cacheKey = createKeyApiCacheKey(keyapi, routeModule);
    const responseAuth = await handleApiKeyCache(
      Redis,
      cacheKey,
      keyapi,
      routeModule,
      request.module
    );

    if (!responseAuth || responseAuth.length === 0) {
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
    async (request: FastifyRequest, reply: FastifyReply) =>
      authenticateKeyApi(request, reply)
  );
});
