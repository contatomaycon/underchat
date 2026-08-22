import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import {
  PlanEntitlementDeniedError,
  PlanEntitlementUnavailableError,
} from '@core/common/exceptions/PlanEntitlementError';
import { getRootPath } from '@core/common/functions/getRootPath';
import { hasRequiredPermission } from '@core/common/functions/hasRequiredPermission';
import { isUuidLike } from '@core/common/functions/isUuidLike';
import { routePathWithoutPrefix } from '@core/common/functions/routePathWithoutPrefix';
import { sendResponse } from '@core/common/functions/sendResponse';
import type { PublicApiPermissionRequirements } from '@core/common/types/PublicApiPermissionRequirements';
import { generalEnvironment } from '@core/config/environments';
import type { AuthenticatedPublicApiTokenRecord } from '@core/repositories/publicApiToken/PublicApiToken.repository';
import { PublicApiTokenService } from '@core/services/publicApiToken.service';
import {
  PlanEntitlementService,
  type PlanEntitlementResult,
} from '@core/services/planEntitlement.service';
import { UserService } from '@core/services/user.service';
import {
  createPlanEntitlementAuditContext,
  getPlanEntitlementAuditSource,
  planEntitlementTelemetryStore,
} from '@core/services/planEntitlementTelemetryStore';
import { ApiJwtViewerUseCase } from '@core/useCases/api/ApiJwtViewer.useCase';
import { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import Redis from 'ioredis';
import { container } from 'tsyringe';

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_KEY_PREFIX = 'public-api:rate-limit:';

interface PublicApiRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfter: number;
  resetAt: number;
}

const RATE_LIMIT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if current == 1 or ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { current, ttl }
`;

function getHeaderToken(request: FastifyRequest): string | null {
  const value = request.headers.keyapi;
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function getExecutorUserId(request: FastifyRequest): string | null {
  const value = request.headers['x-underchat-user-id'];
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return isUuidLike(normalized) ? normalized : null;
}

export async function consumePublicApiRateLimit(
  redis: Redis,
  tokenHash: string,
  limit: number
): Promise<PublicApiRateLimitResult> {
  const key = `${RATE_LIMIT_KEY_PREFIX}${tokenHash}`;
  const raw = (await redis.eval(
    RATE_LIMIT_SCRIPT,
    1,
    key,
    RATE_LIMIT_WINDOW_SECONDS
  )) as [number, number];
  const current = Number(raw[0]);
  const ttl = Math.max(1, Number(raw[1]));

  return {
    allowed: current <= limit,
    limit,
    remaining: Math.max(0, limit - current),
    retryAfter: ttl,
    resetAt: Math.ceil(Date.now() / 1000) + ttl,
  };
}

function setRateLimitHeaders(
  reply: FastifyReply,
  result: PublicApiRateLimitResult
): void {
  reply.header('X-RateLimit-Limit', result.limit);
  reply.header('X-RateLimit-Remaining', result.remaining);
  reply.header('X-RateLimit-Reset', result.resetAt);
  if (!result.allowed) {
    reply.header('Retry-After', result.retryAfter);
  }
}

function sendUnauthorized(
  request: FastifyRequest,
  reply: FastifyReply,
  reason: string
): ReturnType<typeof sendResponse> {
  request.log.warn(
    {
      type: 'public_api_auth_failure',
      reason,
      path: request.url,
      method: request.method,
    },
    'Public API token authentication denied'
  );

  return sendResponse(reply, {
    message: request.t('not_authorized'),
    httpStatusCode: EHTTPStatusCode.unauthorized,
  });
}

function sendInvalidExecutor(
  request: FastifyRequest,
  reply: FastifyReply
): ReturnType<typeof sendResponse> {
  request.log.warn(
    {
      type: 'public_api_executor_validation_failure',
      reason: 'executor_header_missing_or_invalid',
      path: request.url,
      method: request.method,
    },
    'Public API executor header validation denied'
  );

  return sendResponse(reply, {
    message: request.t('public_api_executor_header_invalid'),
    httpStatusCode: EHTTPStatusCode.bad_request,
  });
}

function sendForbiddenExecutor(
  request: FastifyRequest,
  reply: FastifyReply,
  reason: string
): ReturnType<typeof sendResponse> {
  request.log.warn(
    {
      type: 'public_api_executor_auth_failure',
      reason,
      path: request.url,
      method: request.method,
    },
    'Public API executor authentication denied'
  );

  return sendResponse(reply, {
    message: request.t('permission_denied'),
    httpStatusCode: EHTTPStatusCode.forbidden,
  });
}

async function assertPublicApiIntegrationEntitlement(
  request: FastifyRequest,
  reply: FastifyReply,
  accountId: string
): Promise<PlanEntitlementResult | null> {
  try {
    const planEntitlementService = container.resolve(PlanEntitlementService);
    const entitlement = await planEntitlementService.assertEntitled(
      accountId,
      EPlanProduct.integration
    );
    planEntitlementTelemetryStore.recordDecision('public_api', 'allowed');
    request.log?.info?.(
      createPlanEntitlementAuditContext({
        surface: 'public_api',
        outcome: 'allowed',
        accountId,
        planProductId: EPlanProduct.integration,
        revision: entitlement.revision,
        source: entitlement.source,
        requestId: request.id,
      }),
      'Public API Integration entitlement admitted'
    );
    return entitlement;
  } catch (error) {
    if (error instanceof PlanEntitlementDeniedError) {
      planEntitlementTelemetryStore.recordDecision('public_api', 'denied');
      request.log.warn(
        createPlanEntitlementAuditContext({
          surface: 'public_api',
          outcome: 'denied',
          accountId,
          planProductId: EPlanProduct.integration,
          revision: error.entitlement.revision,
          source: getPlanEntitlementAuditSource(error.entitlement),
          requestId: request.id,
          reason: 'integration_plan_required',
        }),
        'Public API Integration entitlement denied'
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

    planEntitlementTelemetryStore.recordDecision('public_api', 'unavailable');
    request.log.error(
      {
        type: 'public_api_entitlement_error',
        reason: 'plan_entitlement_unavailable',
        account_id: accountId,
        path: request.url,
        method: request.method,
        expected_error: error instanceof PlanEntitlementUnavailableError,
        error: error instanceof Error ? error.message : String(error),
      },
      'Public API Integration entitlement validation unavailable'
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

function hasPublicApiPermissions(
  actions: Parameters<typeof hasRequiredPermission>[0],
  permissions: PublicApiPermissionRequirements | null
): boolean {
  if (!permissions?.length) {
    return true;
  }

  if (Array.isArray(permissions[0])) {
    return (permissions as EPermissionsRoles[][]).every((permissionGroup) =>
      hasRequiredPermission(actions, permissionGroup)
    );
  }

  return hasRequiredPermission(actions, permissions as EPermissionsRoles[]);
}

function setAccountTokenContext(
  request: FastifyRequest,
  token: AuthenticatedPublicApiTokenRecord
): void {
  request.publicApiTokenData = {
    token_id: token.public_api_token_id,
    token_hash: token.token_hash,
    account_id: token.account_id,
    actor_user_id: token.actor_user_id,
    executor_user_id: null,
  };
  request.publicApiAuthenticationCompleted = true;
  request.tokenJwtData = {
    account_id: token.account_id,
    user_id: '',
    session_id: `public-api:${token.public_api_token_id}:account`,
    permission_role_id: '',
    actions: [],
    sectors: [],
    channels: [],
    plan_is_active: token.plan_is_active,
    session_platform: null,
  };
  request.permissionsRoute = null;
}

async function authenticatePublicApiAccount(
  request: FastifyRequest,
  reply: FastifyReply,
  requireExecutor = false
): Promise<AuthenticatedPublicApiTokenRecord | null> {
  const plainToken = getHeaderToken(request);
  if (!plainToken) {
    sendUnauthorized(request, reply, 'keyapi_header_missing');
    return null;
  }

  const publicApiTokenService = container.resolve(PublicApiTokenService);
  const token = await publicApiTokenService.findActiveByValue(plainToken);
  if (!token) {
    sendUnauthorized(request, reply, 'token_not_found_or_revoked');
    return null;
  }

  const integrationEntitlement = await assertPublicApiIntegrationEntitlement(
    request,
    reply,
    token.account_id
  );
  if (!integrationEntitlement) {
    return null;
  }

  // Executor validation belongs after token/account identification and the
  // Integration preflight, but still before rate limiting and last-used
  // writes. Account-discovery routes deliberately skip this requirement.
  if (requireExecutor && !getExecutorUserId(request)) {
    sendInvalidExecutor(request, reply);
    return null;
  }

  // The token lookup carries a compatibility plan flag, but Integration uses
  // the shared primary-database entitlement as its only authority.
  const authoritativeToken: AuthenticatedPublicApiTokenRecord = {
    ...token,
    plan_is_active: integrationEntitlement.planIsActive,
  };

  let rateLimit: PublicApiRateLimitResult;
  try {
    rateLimit = await consumePublicApiRateLimit(
      request.server.Redis,
      token.token_hash,
      generalEnvironment.publicApiRateLimitPerMinute
    );
  } catch (error) {
    request.log.error(
      {
        type: 'public_api_rate_limit_error',
        token_id: token.public_api_token_id,
        error: error instanceof Error ? error.message : String(error),
      },
      'Public API rate limiter unavailable'
    );

    sendResponse(reply, {
      message: request.t('service_unavailable'),
      httpStatusCode: EHTTPStatusCode.service_unavailable,
    });
    return null;
  }

  setRateLimitHeaders(reply, rateLimit);
  if (!rateLimit.allowed) {
    sendResponse(reply, {
      message: request.t('public_api_rate_limit_exceeded'),
      httpStatusCode: EHTTPStatusCode.too_many_requests,
    });
    return null;
  }

  setAccountTokenContext(request, authoritativeToken);

  try {
    await publicApiTokenService.touchLastUsed(token.public_api_token_id);
  } catch (error) {
    request.log.warn(
      {
        type: 'public_api_last_used_update_error',
        token_id: token.public_api_token_id,
        error: error instanceof Error ? error.message : String(error),
      },
      'Could not update public API token last-used timestamp'
    );
  }

  return authoritativeToken;
}

export async function authenticatePublicApiAccountToken(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (request.publicApiAuthenticationCompleted) {
    return;
  }

  await authenticatePublicApiAccount(request, reply);
}

export async function authenticatePublicApiToken(
  request: FastifyRequest,
  reply: FastifyReply,
  permissions: PublicApiPermissionRequirements | null = null
): Promise<void> {
  if (request.publicApiAuthenticationCompleted) {
    const executorUserId = getExecutorUserId(request);
    if (!executorUserId) {
      return sendInvalidExecutor(request, reply);
    }
    if (request.publicApiTokenData.executor_user_id !== executorUserId) {
      return sendForbiddenExecutor(request, reply, 'executor_context_changed');
    }

    if (!hasPublicApiPermissions(request.tokenJwtData.actions, permissions)) {
      return sendResponse(reply, {
        message: request.t('permission_denied'),
        httpStatusCode: EHTTPStatusCode.forbidden,
      });
    }

    request.permissionsRoute = permissions;
    return;
  }

  const token = await authenticatePublicApiAccount(request, reply, true);
  if (!token) return;

  const executorUserId = getExecutorUserId(request);
  if (!executorUserId) return;

  const routePath = routePathWithoutPrefix(request);
  if (!routePath) {
    return sendUnauthorized(request, reply, 'route_not_found');
  }
  const apiJwtViewerUseCase = container.resolve(ApiJwtViewerUseCase);
  const responseAuth = await apiJwtViewerUseCase.execute({
    userId: executorUserId,
    accountId: token.account_id,
    routeModule: getRootPath(routePath, ERouteModule.manager) as ERouteModule,
    module: ERouteModule.manager,
  });

  const accountActions = responseAuth.actions.filter(
    (action) => action.account_id === token.account_id
  );
  if (!accountActions.length) {
    return sendForbiddenExecutor(
      request,
      reply,
      'executor_inactive_or_outside_token_account'
    );
  }

  if (!hasPublicApiPermissions(accountActions, permissions)) {
    return sendResponse(reply, {
      message: request.t('permission_denied'),
      httpStatusCode: EHTTPStatusCode.forbidden,
    });
  }

  const permissionRoleId = accountActions.find(
    (action) => action.permission_role_id !== null
  )?.permission_role_id;
  if (!permissionRoleId) {
    return sendForbiddenExecutor(request, reply, 'permission_role_not_found');
  }

  const userService = container.resolve(UserService);
  const [sectors, channels] = await Promise.all([
    userService.listUserSectors(token.account_id, executorUserId),
    userService.listUserChannelsWithNames(token.account_id, executorUserId),
  ]);

  request.tokenJwtData = {
    account_id: token.account_id,
    user_id: executorUserId,
    session_id: `public-api:${token.public_api_token_id}:${executorUserId}`,
    permission_role_id: permissionRoleId,
    actions: accountActions,
    sectors,
    channels,
    plan_is_active: token.plan_is_active,
    session_platform: null,
  };
  request.publicApiTokenData.executor_user_id = executorUserId;
  request.permissionsRoute = permissions;
}

export default fp(async (fastify) => {
  fastify.decorate(
    'authenticatePublicApiToken',
    async (
      request: FastifyRequest,
      reply: FastifyReply,
      permissions: PublicApiPermissionRequirements | null = null
    ) => authenticatePublicApiToken(request, reply, permissions)
  );
  fastify.decorate(
    'authenticatePublicApiAccountToken',
    async (request: FastifyRequest, reply: FastifyReply) =>
      authenticatePublicApiAccountToken(request, reply)
  );
});
