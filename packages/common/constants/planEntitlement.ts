export const PLAN_ENTITLEMENT_CACHE_PREFIX = 'plan-entitlement:v1';
export const PLAN_ENTITLEMENT_REDIS_TOKEN = 'PlanEntitlementRedis';
export const PLAN_ENTITLEMENT_REDIS_COMMAND_TIMEOUT_MS = 2_000;
export const PLAN_ENTITLEMENT_REDIS_MAX_RETRIES_PER_REQUEST = 1;
export const PLAN_ENTITLEMENT_CACHE_TTL_SECONDS = 60;
export const PLAN_ENTITLEMENT_CACHE_TTL_JITTER_SECONDS = 5;
export const PLAN_ENTITLEMENT_DENY_FENCE_TTL_SECONDS = 300;
export const PLAN_ENTITLEMENT_DENY_FENCE_HEARTBEAT_INTERVAL_MS = 30_000;
export const PLAN_ENTITLEMENT_DENY_FENCE_RECOVERY_GRACE_SECONDS = 60;
export const PLAN_ENTITLEMENT_DENY_FENCE_RECOVERY_CLAIM_TTL_SECONDS = 180;
export const PLAN_ENTITLEMENT_CACHE_LOCK_TTL_MS = 2_000;

export const getPaymentRefundEntitlementFenceOperationKey = (
  accountPaymentId: string
): string => `payment-refund:${accountPaymentId}`;

export const getPlanEntitlementCacheKey = (
  accountId: string,
  planProductId: string
): string => `${PLAN_ENTITLEMENT_CACHE_PREFIX}:${accountId}:${planProductId}`;

export const getPlanEntitlementDenyFenceKey = (
  accountId: string,
  planProductId: string
): string =>
  `${PLAN_ENTITLEMENT_CACHE_PREFIX}:deny:${accountId}:${planProductId}`;

export const getPlanEntitlementEpochKey = (
  accountId: string,
  planProductId: string
): string =>
  `${PLAN_ENTITLEMENT_CACHE_PREFIX}:epoch:${accountId}:${planProductId}`;

export const getPlanEntitlementCacheLockKey = (
  accountId: string,
  planProductId: string
): string =>
  `${PLAN_ENTITLEMENT_CACHE_PREFIX}:lock:${accountId}:${planProductId}`;
