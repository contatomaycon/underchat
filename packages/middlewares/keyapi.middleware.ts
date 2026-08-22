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
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import {
  PlanEntitlementDeniedError,
  PlanEntitlementUnavailableError,
} from '@core/common/exceptions/PlanEntitlementError';
import { PlanEntitlementService } from '@core/services/planEntitlement.service';
import Redis from 'ioredis';
import {
  createPlanEntitlementAuditContext,
  getPlanEntitlementAuditSource,
  planEntitlementTelemetryStore,
} from '@core/services/planEntitlementTelemetryStore';

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

function isCachedApiKeyHierarchy(
  value: unknown
): value is IApiKeyGroupHierarchy[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).account_id === 'string' &&
        typeof (item as Record<string, unknown>).api_key_id === 'string' &&
        typeof (item as Record<string, unknown>).api_key === 'string' &&
        typeof (item as Record<string, unknown>).name === 'string'
    )
  );
}

async function handleApiKeyCache(
  redis: Redis,
  cacheKey: string,
  keyapi: string,
  routeModule: string,
  module: ERouteModule
): Promise<IApiKeyGroupHierarchy[]> {
  try {
    const cacheAuth = await redis.get(cacheKey);
    if (cacheAuth) {
      const cachedData = JSON.parse(cacheAuth) as unknown;
      if (isCachedApiKeyHierarchy(cachedData)) {
        return cachedData;
      }
    }
  } catch {
    // Authentication cache is an optimization. Account/key resolution falls
    // back to PostgreSQL so Redis outages do not bypass the entitlement check.
  }

  const apiKeyViewerUseCase = container.resolve(ApiKeyViewerUseCase);
  const responseAuth = await apiKeyViewerUseCase.execute({
    key_api: keyapi,
    route_module: routeModule,
    module,
  } as IApiKeyMiddleware);

  if (responseAuth && responseAuth.length > 0) {
    try {
      await redis.set(cacheKey, JSON.stringify(responseAuth), 'EX', 1800);
    } catch {
      // Best effort: the authoritative lookup above already succeeded.
    }
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

async function validateIntegrationEntitlement(
  request: FastifyRequest,
  reply: FastifyReply,
  accountId: string
): Promise<{
  revision: string;
  source: 'plan' | 'addon' | null;
} | null> {
  try {
    const entitlement = await container
      .resolve(PlanEntitlementService)
      .assertEntitled(accountId, EPlanProduct.integration);
    planEntitlementTelemetryStore.recordDecision(
      'inbound_webhook_auth',
      'allowed'
    );
    request.log?.info?.(
      createPlanEntitlementAuditContext({
        surface: 'inbound_webhook_auth',
        outcome: 'allowed',
        accountId,
        planProductId: EPlanProduct.integration,
        revision: entitlement.revision,
        source: entitlement.source,
        requestId: request.id,
      }),
      'Inbound webhook Integration entitlement admitted'
    );
    return {
      revision: entitlement.revision,
      source: entitlement.source,
    };
  } catch (error) {
    if (error instanceof PlanEntitlementDeniedError) {
      planEntitlementTelemetryStore.recordDecision(
        'inbound_webhook_auth',
        'denied'
      );
      request.log?.warn?.(
        createPlanEntitlementAuditContext({
          surface: 'inbound_webhook_auth',
          outcome: 'denied',
          accountId,
          planProductId: EPlanProduct.integration,
          revision: error.entitlement.revision,
          source: getPlanEntitlementAuditSource(error.entitlement),
          requestId: request.id,
          reason: 'integration_plan_required',
        }),
        'Inbound webhook Integration entitlement denied'
      );
      sendResponse(reply, {
        message: request.t('integration_not_available'),
        httpStatusCode: EHTTPStatusCode.payment_required,
        data: {
          reason: 'integration_plan_required',
          plan_product_id: EPlanProduct.integration,
        },
      });
      return null;
    }

    planEntitlementTelemetryStore.recordDecision(
      'inbound_webhook_auth',
      'unavailable'
    );
    request.log.error(
      {
        type: 'webhook_integration_entitlement_error',
        account_id: accountId,
        request_id: request.id,
        expected_error: error instanceof PlanEntitlementUnavailableError,
        error: error instanceof Error ? error.message : String(error),
      },
      'Inbound webhook Integration entitlement validation unavailable'
    );
    sendResponse(reply, {
      message: request.t('plan_entitlement_unavailable'),
      httpStatusCode: EHTTPStatusCode.service_unavailable,
      data: {
        reason: 'plan_entitlement_unavailable',
        plan_product_id: EPlanProduct.integration,
      },
    });
    return null;
  }
}

export async function authenticateKeyApi(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { t } = request;
  const { Redis } = request.server;
  const routePath = routePathWithoutPrefix(request);
  const urlKeyApi = getKeyApiFromUrl(
    routePath,
    request.params as Record<string, string | undefined> | null
  );
  const keyapi = urlKeyApi;

  if (!keyapi || !routePath?.startsWith('/webhook/')) {
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

    const tokenKeyData = generateTokenKeyData(responseAuth);
    const integrationEntitlement = await validateIntegrationEntitlement(
      request,
      reply,
      tokenKeyData.account_id
    );
    if (!integrationEntitlement) {
      return;
    }

    request.tokenKeyData = tokenKeyData;
    request.integrationEntitlementRevision = integrationEntitlement.revision;
    request.integrationEntitlementSource = integrationEntitlement.source;

    return;
  } catch (error) {
    planEntitlementTelemetryStore.recordDecision(
      'inbound_webhook_auth',
      'unavailable'
    );
    request.log.error(
      {
        type: 'webhook_key_resolution_unavailable',
        request_id: request.id,
        error: error instanceof Error ? error.message : String(error),
      },
      'Inbound webhook account or entitlement resolution unavailable'
    );
    return sendResponse(reply, {
      message: t('plan_entitlement_unavailable'),
      httpStatusCode: EHTTPStatusCode.service_unavailable,
      data: {
        reason: 'plan_entitlement_unavailable',
        plan_product_id: EPlanProduct.integration,
      },
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
