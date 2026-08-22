import { randomUUID } from 'node:crypto';
import {
  getPlanEntitlementCacheKey,
  getPlanEntitlementCacheLockKey,
  getPlanEntitlementDenyFenceKey,
  getPlanEntitlementEpochKey,
  PLAN_ENTITLEMENT_REDIS_TOKEN,
  PLAN_ENTITLEMENT_CACHE_LOCK_TTL_MS,
  PLAN_ENTITLEMENT_CACHE_TTL_JITTER_SECONDS,
  PLAN_ENTITLEMENT_CACHE_TTL_SECONDS,
  PLAN_ENTITLEMENT_DENY_FENCE_HEARTBEAT_INTERVAL_MS,
  PLAN_ENTITLEMENT_DENY_FENCE_RECOVERY_CLAIM_TTL_SECONDS,
  PLAN_ENTITLEMENT_DENY_FENCE_RECOVERY_GRACE_SECONDS,
  PLAN_ENTITLEMENT_DENY_FENCE_TTL_SECONDS,
} from '@core/common/constants/planEntitlement';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import {
  PlanEntitlementDeniedError,
  PlanEntitlementRevisionMismatchError,
  PlanEntitlementUnavailableError,
} from '@core/common/exceptions/PlanEntitlementError';
import type {
  PlanEntitlementAssertionOptions,
  PlanEntitlementReadOptions,
  PlanEntitlementResult,
  PlanEntitlementSource,
} from '@core/common/interfaces/IPlanEntitlement';
import {
  PlanEntitlementRepository,
  ReconciledPlanEntitlementFenceState,
  ResolvedPlanEntitlementFenceState,
} from '@core/repositories/planEntitlement/PlanEntitlement.repository';
import Redis from 'ioredis';
import { inject, injectable } from 'tsyringe';
import { planEntitlementTelemetryStore } from '@core/services/planEntitlementTelemetryStore';

export type {
  PlanEntitlementAssertionOptions,
  PlanEntitlementReadOptions,
  PlanEntitlementResult,
} from '@core/common/interfaces/IPlanEntitlement';

interface PlanEntitlementCachePayload {
  account_id: string;
  plan_product_id: string;
  allowed: boolean;
  revision: string;
  valid_until: string | null;
  plan_is_active: boolean;
  source: PlanEntitlementSource;
  fence_token?: string;
}

export interface PlanEntitlementFenceTarget {
  readonly accountId: string;
  readonly planProductId: string;
  readonly operationKey?: string;
}

export interface PlanEntitlementDenyFence extends PlanEntitlementFenceTarget {
  readonly ownerToken: string;
}

export interface PlanEntitlementRevocationRetryFence {
  readonly ownerToken: string;
  readonly adopted: boolean;
}

interface ActiveDenyFenceLease {
  readonly fence: PlanEntitlementDenyFence;
  lastError: unknown | null;
}

const MONOTONIC_WRITE_SCRIPT = `
local function normalize_revision(value)
  local normalized = string.gsub(tostring(value or ''), '^0+', '')
  if normalized == '' then return '0' end
  return normalized
end
local function compare_revision(left, right)
  left = normalize_revision(left)
  right = normalize_revision(right)
  if string.len(left) ~= string.len(right) then
    return string.len(left) < string.len(right) and -1 or 1
  end
  if left == right then return 0 end
  return left < right and -1 or 1
end
if redis.call('exists', KEYS[1]) == 1 then return 0 end
local incoming = cjson.decode(ARGV[1])
local current_raw = redis.call('get', KEYS[3])
if current_raw then
  local decoded, current = pcall(cjson.decode, current_raw)
  if decoded then
    local comparison = compare_revision(incoming.revision, current.revision)
    if comparison < 0 then return 0 end
    -- A normal cache fill is not authorized to erase the durable owner proof.
    -- In particular, the short deny key may have been evicted while the epoch
    -- still protects the same revision. Only RELEASE_OWNED_FENCE_SCRIPT may
    -- replace that proof after PostgreSQL confirms the owner.
    if current.fence_token then return 0 end
    if comparison == 0 and current.allowed == false and incoming.allowed == true then
      return 0
    end
  else
    redis.call('del', KEYS[3])
  end
end
redis.call('set', KEYS[2], ARGV[1], 'EX', ARGV[2])
redis.call('set', KEYS[3], ARGV[1])
return 1
`;

const INSTALL_FENCE_SCRIPT = `
local function normalize_revision(value)
  local normalized = string.gsub(tostring(value or ''), '^0+', '')
  if normalized == '' then return '0' end
  return normalized
end
local function compare_revision(left, right)
  left = normalize_revision(left)
  right = normalize_revision(right)
  if string.len(left) ~= string.len(right) then
    return string.len(left) < string.len(right) and -1 or 1
  end
  if left == right then return 0 end
  return left < right and -1 or 1
end
local incoming = cjson.decode(ARGV[1])
local current_raw = redis.call('get', KEYS[2])
if current_raw then
  local decoded, current = pcall(cjson.decode, current_raw)
  if decoded then
    if compare_revision(incoming.revision, current.revision) < 0 then return 0 end
  else
    redis.call('del', KEYS[2])
  end
end
redis.call('set', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('set', KEYS[2], ARGV[1])
return 1
`;

const REINSTALL_OWNED_FENCE_SCRIPT = `
local function normalize_revision(value)
  local normalized = string.gsub(tostring(value or ''), '^0+', '')
  if normalized == '' then return '0' end
  return normalized
end
local function compare_revision(left, right)
  left = normalize_revision(left)
  right = normalize_revision(right)
  if string.len(left) ~= string.len(right) then
    return string.len(left) < string.len(right) and -1 or 1
  end
  if left == right then return 0 end
  return left < right and -1 or 1
end
local incoming = cjson.decode(ARGV[1])
if incoming.fence_token ~= ARGV[2] then return 0 end

local epoch_raw = redis.call('get', KEYS[2])
if epoch_raw then
  local decoded_epoch, epoch = pcall(cjson.decode, epoch_raw)
  if not decoded_epoch then return 0 end
  if epoch.fence_token and epoch.fence_token ~= ARGV[2] then return 0 end
  if not epoch.fence_token then
    local comparison = compare_revision(incoming.revision, epoch.revision)
    -- An equal/newer unfenced epoch is proof that this owner was released.
    if comparison <= 0 then return 0 end
  elseif compare_revision(incoming.revision, epoch.revision) < 0 then
    return 0
  end
end

local fence_raw = redis.call('get', KEYS[1])
if fence_raw then
  local decoded_fence, fence = pcall(cjson.decode, fence_raw)
  if not decoded_fence or fence.fence_token ~= ARGV[2] then return 0 end
  if fence.recovery_token then return 3 end
end

-- PostgreSQL observed this active owner under its advisory lock. Recreate
-- evicted keys, but leave a recovery claim for the real owner heartbeat.
redis.call('set', KEYS[1], ARGV[1], 'EX', ARGV[3])
redis.call('set', KEYS[2], ARGV[1])
return epoch_raw and 1 or 2
`;

const COMPLETE_RELEASED_FENCE_SCRIPT = `
local function normalize_revision(value)
  local normalized = string.gsub(tostring(value or ''), '^0+', '')
  if normalized == '' then return '0' end
  return normalized
end
local function compare_revision(left, right)
  left = normalize_revision(left)
  right = normalize_revision(right)
  if string.len(left) ~= string.len(right) then
    return string.len(left) < string.len(right) and -1 or 1
  end
  if left == right then return 0 end
  return left < right and -1 or 1
end

local incoming = cjson.decode(ARGV[1])
local fence_raw = redis.call('get', KEYS[1])
if fence_raw then
  local decoded_fence, fence = pcall(cjson.decode, fence_raw)
  if not decoded_fence or fence.fence_token ~= ARGV[3] then return 0 end
end

local epoch_raw = redis.call('get', KEYS[3])
if epoch_raw then
  local decoded_epoch, epoch = pcall(cjson.decode, epoch_raw)
  if not decoded_epoch then return 0 end
  if epoch.fence_token and epoch.fence_token ~= ARGV[3] then return 0 end
  if compare_revision(incoming.revision, epoch.revision) < 0 then return 0 end
end

redis.call('set', KEYS[2], ARGV[1], 'EX', ARGV[2])
redis.call('set', KEYS[3], ARGV[1])
if fence_raw then redis.call('del', KEYS[1]) end
return epoch_raw and 1 or 2
`;

const HEARTBEAT_OWNED_FENCE_SCRIPT = `
local epoch_raw = redis.call('get', KEYS[2])
if not epoch_raw then return 0 end
local decoded_epoch, epoch = pcall(cjson.decode, epoch_raw)
if not decoded_epoch or epoch.fence_token ~= ARGV[1] then return 0 end
local fence_raw = redis.call('get', KEYS[1])
if fence_raw then
  local decoded_fence, fence = pcall(cjson.decode, fence_raw)
  if not decoded_fence or fence.fence_token ~= ARGV[1] then return 0 end
  if fence.recovery_token then
    redis.call('set', KEYS[1], epoch_raw, 'EX', ARGV[2])
    return 3
  end
  redis.call('expire', KEYS[1], ARGV[2])
  return 1
end
redis.call('set', KEYS[1], epoch_raw, 'EX', ARGV[2])
return 2
`;

const CLAIM_STALE_FENCE_RECOVERY_SCRIPT = `
local now = tonumber(redis.call('time')[1])
local fence_raw = redis.call('get', KEYS[1])
if fence_raw then
  local decoded_fence, fence = pcall(cjson.decode, fence_raw)
  if not decoded_fence or fence.fence_token ~= ARGV[1] then return 0 end
  if not fence.recovery_token then
    fence.recovery_token = ARGV[2]
    fence.recovery_claimed_at = now
    redis.call('set', KEYS[1], cjson.encode(fence), 'EX', ARGV[3])
    return 1
  end
  local claimed_at = tonumber(fence.recovery_claimed_at)
  if not claimed_at then return 0 end
  if now - claimed_at >= tonumber(ARGV[4]) then return 2 end
  return 1
end
local epoch_raw = redis.call('get', KEYS[2])
if not epoch_raw then return 0 end
local decoded_epoch, epoch = pcall(cjson.decode, epoch_raw)
if not decoded_epoch or epoch.fence_token ~= ARGV[1] then return 0 end
epoch.recovery_token = ARGV[2]
epoch.recovery_claimed_at = now
redis.call('set', KEYS[1], cjson.encode(epoch), 'EX', ARGV[3])
return 1
`;

const RELEASE_OWNED_FENCE_SCRIPT = `
local function normalize_revision(value)
  local normalized = string.gsub(tostring(value or ''), '^0+', '')
  if normalized == '' then return '0' end
  return normalized
end
local function compare_revision(left, right)
  left = normalize_revision(left)
  right = normalize_revision(right)
  if string.len(left) ~= string.len(right) then
    return string.len(left) < string.len(right) and -1 or 1
  end
  if left == right then return 0 end
  return left < right and -1 or 1
end
local fence_raw = redis.call('get', KEYS[1])
if fence_raw then
  local decoded_fence, fence = pcall(cjson.decode, fence_raw)
  if not decoded_fence then return 0 end
  if fence.fence_token ~= ARGV[3] then return 0 end
end
local incoming = cjson.decode(ARGV[1])
local current_raw = redis.call('get', KEYS[3])
if current_raw then
  local decoded, current = pcall(cjson.decode, current_raw)
  if decoded then
    local comparison = compare_revision(incoming.revision, current.revision)
    if not fence_raw and current.fence_token ~= ARGV[3] then
      if comparison == 0 and current.allowed == incoming.allowed then
        redis.call('set', KEYS[2], ARGV[1], 'EX', ARGV[2])
        redis.call('set', KEYS[3], ARGV[1])
        return 2
      end
      return 0
    end
    if comparison < 0 then return 0 end
  else
    redis.call('del', KEYS[3])
  end
end
redis.call('set', KEYS[2], ARGV[1], 'EX', ARGV[2])
redis.call('set', KEYS[3], ARGV[1])
if fence_raw then redis.call('del', KEYS[1]) end
return 1
`;

const wait = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const compareDecimalRevisions = (left: string, right: string): number => {
  if (left.length !== right.length) {
    return left.length < right.length ? -1 : 1;
  }
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

const isRedisUnavailable = (redis: Redis): boolean => redis.status !== 'ready';

const isObservedPlanProduct = (planProductId: string): boolean =>
  planProductId === EPlanProduct.integration;

@injectable()
export class PlanEntitlementService {
  private readonly inFlight = new Map<string, Promise<PlanEntitlementResult>>();
  private readonly activeDenyFenceLeases = new Map<
    string,
    ActiveDenyFenceLease
  >();
  private readonly failedDenyFenceLeases = new Set<string>();
  private denyFenceHeartbeatTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    @inject(PlanEntitlementRepository)
    private readonly repository: PlanEntitlementRepository,
    @inject(PLAN_ENTITLEMENT_REDIS_TOKEN) private readonly redis: Redis
  ) {}

  /** Resolves a plan product from Redis or the authoritative primary database. */
  async getEntitlement(
    accountId: string,
    planProductId: string,
    options: PlanEntitlementReadOptions = {}
  ): Promise<PlanEntitlementResult> {
    if (options.bypassCache) {
      const resolved = await this.resolveFromPrimary(accountId, planProductId);
      return this.writeResolvedCache(resolved);
    }

    const cached = await this.readCache(accountId, planProductId);
    if (cached) {
      if (isObservedPlanProduct(planProductId)) {
        planEntitlementTelemetryStore.recordCache('hit');
      }
      return cached;
    }
    if (isObservedPlanProduct(planProductId)) {
      planEntitlementTelemetryStore.recordCache('miss');
    }

    const inFlightKey = `${accountId}:${planProductId}`;
    const existing = this.inFlight.get(inFlightKey);
    if (existing) {
      return existing;
    }

    const resolver = this.resolveCacheMiss(accountId, planProductId).finally(
      () => this.inFlight.delete(inFlightKey)
    );
    this.inFlight.set(inFlightKey, resolver);
    return resolver;
  }

  async getIntegrationEntitlement(
    accountId: string,
    options: PlanEntitlementReadOptions = {}
  ): Promise<PlanEntitlementResult> {
    return this.getEntitlement(accountId, EPlanProduct.integration, options);
  }

  /** Reconciles the revision from primary while updating Redis best-effort. */
  async resolveAuthoritatively(
    accountId: string,
    planProductId: string
  ): Promise<PlanEntitlementResult> {
    const resolved = await this.resolveFromPrimary(accountId, planProductId);
    return this.writeResolvedCache(resolved);
  }

  async hasPotentialGrantAfterTestPlanActivation(
    accountId: string,
    planId: string,
    planProductId: string
  ): Promise<boolean> {
    try {
      return await this.repository.hasPotentialGrantAfterTestPlanActivation(
        accountId,
        planId,
        planProductId
      );
    } catch (error) {
      if (isObservedPlanProduct(planProductId)) {
        planEntitlementTelemetryStore.recordCache('database_failure');
      }
      throw new PlanEntitlementUnavailableError(
        'Primary database could not evaluate a test plan entitlement mutation',
        error
      );
    }
  }

  async willGrantAfterPlanAssignment(input: {
    accountId: string;
    planId: string;
    planProductId: string;
    prospectiveLastPaymentDate: string | null;
    includeExistingAddons: boolean;
    prospectiveAccountPaymentId?: string;
  }): Promise<boolean> {
    try {
      return await this.repository.willGrantAfterPlanAssignment(input);
    } catch (error) {
      throw new PlanEntitlementUnavailableError(
        'Primary database could not project a plan entitlement mutation',
        error
      );
    }
  }

  /** Throws a typed error when access is denied or the expected epoch changed. */
  async assertEntitled(
    accountId: string,
    planProductId: string,
    options: PlanEntitlementAssertionOptions = {}
  ): Promise<PlanEntitlementResult> {
    const entitlement = await this.getEntitlement(
      accountId,
      planProductId,
      options
    );

    if (!entitlement.allowed) {
      throw new PlanEntitlementDeniedError(entitlement);
    }

    if (
      options.expectedRevision !== undefined &&
      options.expectedRevision !== entitlement.revision
    ) {
      throw new PlanEntitlementRevisionMismatchError(
        entitlement,
        options.expectedRevision
      );
    }

    return entitlement;
  }

  /** Reconciles the persisted epoch after a mutation and replaces stale cache. */
  async refreshAfterMutation(
    accountId: string,
    planProductId: string,
    denyFenceOwnerToken?: string
  ): Promise<PlanEntitlementResult> {
    if (!denyFenceOwnerToken) {
      const resolved = await this.resolveFromPrimary(accountId, planProductId);
      return this.writeResolvedCache(resolved);
    }

    try {
      this.stopDenyFenceLeaseOrThrow(denyFenceOwnerToken);
      const released = await this.repository.releaseDenyFence(
        accountId,
        planProductId,
        denyFenceOwnerToken
      );

      if (!released.released) {
        // A newer revocation owns the durable fence. This caller is allowed to
        // observe the denial but must never clear or replace the newer owner.
        await this.writeCache(released.entitlement);
        return released.entitlement;
      }

      const cacheUpdated = await this.writeCacheReplacingOwnedFence(
        released.entitlement,
        denyFenceOwnerToken
      );
      if (!cacheUpdated) {
        throw new PlanEntitlementUnavailableError(
          'Could not reconcile the caller-owned plan entitlement deny fence'
        );
      }
      await this.repository.finalizeReleasedDenyFence(
        accountId,
        planProductId,
        denyFenceOwnerToken
      );
      if (isObservedPlanProduct(planProductId)) {
        planEntitlementTelemetryStore.recordFence('release', 'success');
      }
      return released.entitlement;
    } catch (error) {
      if (isObservedPlanProduct(planProductId)) {
        planEntitlementTelemetryStore.recordFence('release', 'error');
      }
      if (error instanceof PlanEntitlementUnavailableError) throw error;
      throw new PlanEntitlementUnavailableError(
        'Primary database could not release the plan entitlement deny fence',
        error
      );
    }
  }

  async refreshAccounts(
    accountIds: readonly string[],
    planProductId: string,
    denyFences: readonly PlanEntitlementDenyFence[] = []
  ): Promise<PlanEntitlementResult[]> {
    const uniqueAccountIds = Array.from(new Set(accountIds));
    const owners = new Map(
      denyFences.map((fence) => [
        `${fence.accountId}:${fence.planProductId}`,
        fence.ownerToken,
      ])
    );
    const results: PlanEntitlementResult[] = [];

    for (let offset = 0; offset < uniqueAccountIds.length; offset += 100) {
      const chunk = uniqueAccountIds.slice(offset, offset + 100);
      const targets = chunk.map((accountId) => ({
        accountId,
        planProductId,
        ownerToken: owners.get(`${accountId}:${planProductId}`),
      }));
      for (const target of targets) {
        if (target.ownerToken) {
          this.stopDenyFenceLeaseOrThrow(target.ownerToken);
        }
      }
      const reconciled = await this.repository.reconcileEntitlements(targets);
      await this.writeReconciledCachesBatch(reconciled);
      results.push(...reconciled.map(({ entitlement }) => entitlement));
    }

    return results;
  }

  private async writeReconciledCachesBatch(
    reconciled: readonly ReconciledPlanEntitlementFenceState[]
  ): Promise<void> {
    if (reconciled.length === 0) return;
    const requiresOwnerConfirmation = reconciled.some(
      ({ releasedFenceOwnerToken }) => releasedFenceOwnerToken !== null
    );
    const requiresRedisRepairConfirmation = reconciled.some(
      ({ releasedFenceOwnerToken, expiredFenceOwnerToken }) =>
        releasedFenceOwnerToken !== null || expiredFenceOwnerToken !== null
    );
    if (isRedisUnavailable(this.redis)) {
      if (requiresOwnerConfirmation) {
        throw new PlanEntitlementUnavailableError(
          'Redis is unavailable while confirming bulk deny fence release'
        );
      }
      return;
    }

    const transaction = this.redis.multi();
    const commands: Array<{
      strict: boolean;
      state: ReconciledPlanEntitlementFenceState;
      ownerToken: string | null;
    }> = [];
    for (const state of reconciled) {
      const ttlSeconds = this.getCacheTtlSeconds(state.entitlement);
      if (ttlSeconds <= 0) continue;
      const ownerToken =
        state.releasedFenceOwnerToken ?? state.expiredFenceOwnerToken;
      const payload = this.serialize(state.entitlement);
      if (ownerToken) {
        transaction.eval(
          RELEASE_OWNED_FENCE_SCRIPT,
          3,
          getPlanEntitlementDenyFenceKey(
            state.entitlement.accountId,
            state.entitlement.planProductId
          ),
          getPlanEntitlementCacheKey(
            state.entitlement.accountId,
            state.entitlement.planProductId
          ),
          getPlanEntitlementEpochKey(
            state.entitlement.accountId,
            state.entitlement.planProductId
          ),
          payload,
          ttlSeconds,
          ownerToken
        );
      } else {
        transaction.eval(
          MONOTONIC_WRITE_SCRIPT,
          3,
          getPlanEntitlementDenyFenceKey(
            state.entitlement.accountId,
            state.entitlement.planProductId
          ),
          getPlanEntitlementCacheKey(
            state.entitlement.accountId,
            state.entitlement.planProductId
          ),
          getPlanEntitlementEpochKey(
            state.entitlement.accountId,
            state.entitlement.planProductId
          ),
          payload,
          ttlSeconds
        );
      }
      commands.push({
        strict: ownerToken !== null,
        state,
        ownerToken,
      });
    }

    if (commands.length === 0) return;
    try {
      const replies = await transaction.exec();
      if (!replies) throw new Error('redis_bulk_reconcile_pipeline_failed');
      const finalized: Array<{
        accountId: string;
        planProductId: string;
        ownerToken: string;
      }> = [];
      let pipelineError: unknown = null;
      for (let index = 0; index < commands.length; index += 1) {
        const reply = replies[index];
        const command = commands[index];
        const successful = !reply?.[0] && Number(reply?.[1]) >= 1;
        if (successful && command?.ownerToken) {
          finalized.push({
            accountId: command.state.entitlement.accountId,
            planProductId: command.state.entitlement.planProductId,
            ownerToken: command.ownerToken,
          });
        }
        if (reply?.[0] || (command?.strict && !successful)) {
          pipelineError ??=
            reply?.[0] ?? new Error('redis_bulk_owner_cas_failed');
        }
      }
      await this.repository.finalizeReleasedDenyFences(finalized);
      if (pipelineError) throw pipelineError;
    } catch (error) {
      if (requiresRedisRepairConfirmation) {
        throw new PlanEntitlementUnavailableError(
          'Could not confirm bulk plan entitlement cache reconciliation',
          error
        );
      }
    }
  }

  async refreshAccountsForPlan(
    planId: string,
    planProductId: string,
    denyFences: readonly PlanEntitlementDenyFence[] = []
  ): Promise<PlanEntitlementResult[]> {
    const accountIds =
      await this.repository.listCurrentAccountIdsByPlan(planId);
    return this.refreshAccounts(accountIds, planProductId, denyFences);
  }

  async refreshAccountsForPlanItem(
    planItemId: string,
    denyFences: readonly PlanEntitlementDenyFence[] = []
  ): Promise<PlanEntitlementResult[]> {
    const context = await this.repository.findPlanItemContext(planItemId);
    if (!context) {
      return [];
    }

    return this.refreshAccountsForPlan(
      context.plan_id,
      context.plan_product_id,
      denyFences
    );
  }

  async refreshAccountsForCrossSell(
    planCrossSellId: string,
    previousPlanProductId?: string,
    denyFences: readonly PlanEntitlementDenyFence[] = []
  ): Promise<PlanEntitlementResult[]> {
    const context = await this.repository.findCrossSellContext(planCrossSellId);
    if (!context) {
      return [];
    }

    const productIds = new Set([context.planProductId]);
    if (previousPlanProductId) {
      productIds.add(previousPlanProductId);
    }

    const results = await Promise.all(
      Array.from(productIds).map((planProductId) =>
        this.refreshAccounts(context.accountIds, planProductId, denyFences)
      )
    );
    return results.flat();
  }

  async refreshCrossSellAccount(
    planCrossSellAccountId: string,
    denyFenceOwnerToken?: string
  ): Promise<PlanEntitlementResult | null> {
    const context = await this.repository.findCrossSellAccountContext(
      planCrossSellAccountId
    );
    if (!context) {
      return null;
    }
    return this.refreshAfterMutation(
      context.accountId,
      context.planProductId,
      denyFenceOwnerToken
    );
  }

  /** Installs a fail-closed fence before a potentially revoking mutation. */
  async installDenyFence(
    accountId: string,
    planProductId: string
  ): Promise<string | null> {
    const fences = await this.installDenyFences([{ accountId, planProductId }]);
    const fence = fences[0];
    return fence?.ownerToken ?? null;
  }

  async installDenyFenceForRevocationOperation(
    accountId: string,
    planProductId: string,
    operationKey: string
  ): Promise<string | null> {
    const fences = await this.installDenyFences([
      { accountId, planProductId, operationKey },
    ]);
    return fences[0]?.ownerToken ?? null;
  }

  /**
   * Resumes an unfinished revocation by explicitly adopting its durable owner.
   * This is deliberately separate from ordinary fence installation: only a
   * retry of the same external revocation may share an existing owner token.
   */
  async installOrAdoptDenyFenceForRevocationRetry(
    accountId: string,
    planProductId: string,
    operationKey: string
  ): Promise<PlanEntitlementRevocationRetryFence | null> {
    const requestedOwnerToken = randomUUID();
    let durableFence: {
      ownerToken: string;
      entitlement: PlanEntitlementResult;
      adopted: boolean;
      releasePending: boolean;
    } | null = null;

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        durableFence =
          await this.repository.installOrAdoptDenyFenceForRevocationRetry(
            accountId,
            planProductId,
            requestedOwnerToken,
            operationKey
          );
        if (!durableFence) {
          if (isObservedPlanProduct(planProductId)) {
            planEntitlementTelemetryStore.recordFence('install', 'success');
          }
          return null;
        }

        if (isRedisUnavailable(this.redis)) {
          throw new PlanEntitlementUnavailableError(
            'Redis is unavailable while confirming a revocation retry deny fence'
          );
        }

        if (durableFence.releasePending) {
          const ttlSeconds = this.getCacheTtlSeconds(durableFence.entitlement);
          if (ttlSeconds <= 0) {
            throw new Error('plan_entitlement_release_cache_ttl_expired');
          }
          const reply = await this.redis.eval(
            COMPLETE_RELEASED_FENCE_SCRIPT,
            3,
            getPlanEntitlementDenyFenceKey(accountId, planProductId),
            getPlanEntitlementCacheKey(accountId, planProductId),
            getPlanEntitlementEpochKey(accountId, planProductId),
            this.serialize(durableFence.entitlement),
            ttlSeconds,
            durableFence.ownerToken
          );
          if (Number(reply) < 1) {
            throw new Error('redis_released_deny_fence_owner_cas_failed');
          }
          const finalized =
            await this.repository.finalizeReleasedDenyFenceForOperation(
              accountId,
              planProductId,
              durableFence.ownerToken,
              operationKey
            );
          if (!finalized) {
            throw new Error(
              'plan_entitlement_released_fence_finalize_cas_failed'
            );
          }
          durableFence = null;
          continue;
        }

        const fence: PlanEntitlementDenyFence = {
          accountId,
          planProductId,
          ownerToken: durableFence.ownerToken,
          operationKey,
        };
        const deniedPayload = JSON.stringify({
          ...JSON.parse(
            this.serialize({
              ...durableFence.entitlement,
              allowed: false,
              source: null,
            })
          ),
          fence_token: durableFence.ownerToken,
        } satisfies PlanEntitlementCachePayload);
        let redisConfirmed: boolean;
        if (durableFence.adopted) {
          const renewed = await this.repository.heartbeatDenyFences([fence]);
          if (
            renewed.length !== 1 ||
            renewed[0]?.ownerToken !== durableFence.ownerToken
          ) {
            throw new Error('plan_entitlement_deny_fence_owner_cas_failed');
          }
          const reply = await this.redis.eval(
            REINSTALL_OWNED_FENCE_SCRIPT,
            2,
            getPlanEntitlementDenyFenceKey(accountId, planProductId),
            getPlanEntitlementEpochKey(accountId, planProductId),
            deniedPayload,
            durableFence.ownerToken,
            PLAN_ENTITLEMENT_DENY_FENCE_TTL_SECONDS
          );
          redisConfirmed = Number(reply) >= 1;
        } else {
          const reply = await this.redis.eval(
            INSTALL_FENCE_SCRIPT,
            2,
            getPlanEntitlementDenyFenceKey(accountId, planProductId),
            getPlanEntitlementEpochKey(accountId, planProductId),
            deniedPayload,
            PLAN_ENTITLEMENT_DENY_FENCE_TTL_SECONDS
          );
          redisConfirmed = Number(reply) === 1;
        }

        if (!redisConfirmed) {
          throw new Error('redis_deny_fence_owner_cas_failed');
        }

        this.trackDenyFenceLeases([fence]);
        if (isObservedPlanProduct(planProductId)) {
          planEntitlementTelemetryStore.recordFence('install', 'success');
        }
        return {
          ownerToken: durableFence.ownerToken,
          adopted: durableFence.adopted,
        };
      }
      throw new Error('plan_entitlement_release_pending_retry_exhausted');
    } catch (error) {
      if (isObservedPlanProduct(planProductId)) {
        planEntitlementTelemetryStore.recordFence('install', 'error');
      }

      // Never release an adopted owner on confirmation failure: it protects
      // external state already changed by another revocation attempt. A newly
      // installed owner is rolled back with the normal owner-CAS protocol.
      if (
        durableFence &&
        !durableFence.adopted &&
        !durableFence.releasePending
      ) {
        const ownerTokenToRollback = durableFence.ownerToken;
        await Promise.allSettled([
          (async () => {
            const released = await this.repository.releaseDenyFence(
              accountId,
              planProductId,
              ownerTokenToRollback
            );
            if (!released.released) return;
            const cacheUpdated = await this.writeCacheReplacingOwnedFence(
              released.entitlement,
              ownerTokenToRollback
            );
            if (cacheUpdated) {
              await this.repository.finalizeReleasedDenyFence(
                accountId,
                planProductId,
                ownerTokenToRollback
              );
            }
          })(),
        ]);
      }

      if (error instanceof PlanEntitlementUnavailableError) throw error;
      throw new PlanEntitlementUnavailableError(
        'Could not install or adopt the revocation retry deny fence',
        error
      );
    }
  }

  async installDenyFences(
    targets: readonly PlanEntitlementFenceTarget[]
  ): Promise<PlanEntitlementDenyFence[]> {
    const uniqueTargets = Array.from(
      new Map(
        targets.map((target) => [
          `${target.accountId}:${target.planProductId}`,
          target,
        ])
      ).values()
    );

    if (uniqueTargets.length === 0) {
      return [];
    }

    const observesIntegration = uniqueTargets.some((target) =>
      isObservedPlanProduct(target.planProductId)
    );

    const fences = uniqueTargets.map((target) => ({
      ...target,
      ownerToken: randomUUID(),
    }));
    const installed: Array<{
      fence: PlanEntitlementDenyFence;
      entitlement: PlanEntitlementResult;
    }> = [];

    try {
      for (
        let batchOffset = 0;
        batchOffset < fences.length;
        batchOffset += 100
      ) {
        const targetBatch = fences.slice(batchOffset, batchOffset + 100);
        const durableFences =
          typeof this.repository.installDenyFences === 'function'
            ? await this.repository.installDenyFences(targetBatch)
            : (
                await Promise.all(
                  targetBatch.map(async (target) => ({
                    ownerToken: target.ownerToken,
                    entitlement: await this.repository.resolveEntitlement(
                      target.accountId,
                      target.planProductId
                    ),
                  }))
                )
              ).filter(({ entitlement }) => entitlement.allowed);
        const targetsByOwner = new Map<string, PlanEntitlementDenyFence>(
          targetBatch.map((target) => [target.ownerToken, target])
        );
        for (const durableFence of durableFences) {
          const fence = targetsByOwner.get(durableFence.ownerToken);
          if (!fence) {
            throw new Error('plan_entitlement_deny_fence_owner_not_requested');
          }
          const value = {
            fence,
            entitlement: durableFence.entitlement,
          };
          installed.push(value);
        }
      }

      // PostgreSQL is authoritative about whether a target is currently
      // allowed. A denied -> denied mutation does not need Redis at all.
      if (installed.length === 0) {
        if (observesIntegration) {
          planEntitlementTelemetryStore.recordFence('install', 'success');
        }
        return [];
      }

      if (isRedisUnavailable(this.redis)) {
        throw new PlanEntitlementUnavailableError(
          'Redis is unavailable while installing a plan entitlement deny fence'
        );
      }

      for (
        let batchOffset = 0;
        batchOffset < installed.length;
        batchOffset += 100
      ) {
        const batchInstalled = installed.slice(batchOffset, batchOffset + 100);
        const transaction = this.redis.multi();
        for (const { entitlement, fence } of batchInstalled) {
          const deniedPayload = JSON.stringify({
            ...JSON.parse(
              this.serialize({
                ...entitlement,
                allowed: false,
                source: null,
              })
            ),
            fence_token: fence.ownerToken,
          } satisfies PlanEntitlementCachePayload);
          transaction.eval(
            INSTALL_FENCE_SCRIPT,
            2,
            getPlanEntitlementDenyFenceKey(
              entitlement.accountId,
              entitlement.planProductId
            ),
            getPlanEntitlementEpochKey(
              entitlement.accountId,
              entitlement.planProductId
            ),
            deniedPayload,
            PLAN_ENTITLEMENT_DENY_FENCE_TTL_SECONDS
          );
        }

        const replies = await transaction.exec();
        if (
          !replies ||
          replies.some(
            ([error, reply]) => error !== null || Number(reply) !== 1
          )
        ) {
          throw new Error('redis_deny_fence_pipeline_failed');
        }
      }
      if (observesIntegration) {
        planEntitlementTelemetryStore.recordFence('install', 'success');
      }
      const installedFences = installed.map(({ fence }) => fence);
      this.trackDenyFenceLeases(installedFences);
      return installedFences;
    } catch (error) {
      if (observesIntegration) {
        planEntitlementTelemetryStore.recordFence('install', 'error');
      }
      // If Redis confirmation fails, restore only fences still owned by this
      // operation. A concurrent newer owner is deliberately left untouched.
      await Promise.allSettled(
        installed.map(async ({ fence }) => {
          const released = await this.repository.releaseDenyFence(
            fence.accountId,
            fence.planProductId,
            fence.ownerToken
          );
          if (released.released) {
            const cacheUpdated = await this.writeCacheReplacingOwnedFence(
              released.entitlement,
              fence.ownerToken
            );
            if (cacheUpdated) {
              await this.repository.finalizeReleasedDenyFence(
                fence.accountId,
                fence.planProductId,
                fence.ownerToken
              );
            }
          }
        })
      );
      if (error instanceof PlanEntitlementUnavailableError) {
        throw error;
      }
      throw new PlanEntitlementUnavailableError(
        'Could not install plan entitlement deny fence',
        error
      );
    }
  }

  private trackDenyFenceLeases(
    fences: readonly PlanEntitlementDenyFence[]
  ): void {
    for (const fence of fences) {
      this.failedDenyFenceLeases.delete(fence.ownerToken);
      this.activeDenyFenceLeases.set(fence.ownerToken, {
        fence,
        lastError: null,
      });
    }
    this.scheduleDenyFenceHeartbeat();
  }

  private stopDenyFenceLeaseOrThrow(ownerToken: string): void {
    const lease = this.activeDenyFenceLeases.get(ownerToken);
    this.activeDenyFenceLeases.delete(ownerToken);
    if (this.activeDenyFenceLeases.size === 0 && this.denyFenceHeartbeatTimer) {
      clearTimeout(this.denyFenceHeartbeatTimer);
      this.denyFenceHeartbeatTimer = null;
    }
    if (lease?.lastError || this.failedDenyFenceLeases.has(ownerToken)) {
      this.failedDenyFenceLeases.add(ownerToken);
      throw new PlanEntitlementUnavailableError(
        'Plan entitlement deny fence heartbeat was not confirmed',
        lease?.lastError
      );
    }
    this.failedDenyFenceLeases.delete(ownerToken);
  }

  private scheduleDenyFenceHeartbeat(): void {
    if (this.denyFenceHeartbeatTimer || this.activeDenyFenceLeases.size === 0) {
      return;
    }
    this.denyFenceHeartbeatTimer = setTimeout(() => {
      this.denyFenceHeartbeatTimer = null;
      void this.heartbeatActiveDenyFences().finally(() =>
        this.scheduleDenyFenceHeartbeat()
      );
    }, PLAN_ENTITLEMENT_DENY_FENCE_HEARTBEAT_INTERVAL_MS);
    this.denyFenceHeartbeatTimer.unref?.();
  }

  private setDenyFenceHeartbeatResult(
    ownerToken: string,
    error: unknown | null
  ): void {
    const lease = this.activeDenyFenceLeases.get(ownerToken);
    if (lease) lease.lastError = error;
  }

  private async heartbeatActiveDenyFences(): Promise<void> {
    const leases = Array.from(this.activeDenyFenceLeases.values());
    for (let offset = 0; offset < leases.length; offset += 100) {
      const batch = leases.slice(offset, offset + 100);
      let renewedOwnerTokens: Set<string>;
      try {
        const renewed = await this.repository.heartbeatDenyFences(
          batch.map(({ fence }) => fence)
        );
        renewedOwnerTokens = new Set(
          renewed.map(({ ownerToken }) => ownerToken)
        );
      } catch (error) {
        for (const { fence } of batch) {
          this.setDenyFenceHeartbeatResult(fence.ownerToken, error);
        }
        continue;
      }

      const renewedLeases = batch.filter(({ fence }) =>
        renewedOwnerTokens.has(fence.ownerToken)
      );
      for (const { fence } of batch) {
        if (!renewedOwnerTokens.has(fence.ownerToken)) {
          // A release/adoption completed elsewhere. Stop this old process from
          // retrying heartbeats forever; retain the failure marker so a later
          // attempt to release with this lost lease remains fail-closed.
          this.activeDenyFenceLeases.delete(fence.ownerToken);
          this.failedDenyFenceLeases.add(fence.ownerToken);
        }
      }
      if (renewedLeases.length === 0) continue;
      if (isRedisUnavailable(this.redis)) {
        for (const { fence } of renewedLeases) {
          this.setDenyFenceHeartbeatResult(
            fence.ownerToken,
            new Error('redis_unavailable_during_deny_fence_heartbeat')
          );
        }
        continue;
      }

      try {
        const transaction = this.redis.multi();
        for (const { fence } of renewedLeases) {
          transaction.eval(
            HEARTBEAT_OWNED_FENCE_SCRIPT,
            2,
            getPlanEntitlementDenyFenceKey(
              fence.accountId,
              fence.planProductId
            ),
            getPlanEntitlementEpochKey(fence.accountId, fence.planProductId),
            fence.ownerToken,
            PLAN_ENTITLEMENT_DENY_FENCE_TTL_SECONDS
          );
        }
        const replies = await transaction.exec();
        if (!replies) throw new Error('redis_deny_fence_heartbeat_failed');
        renewedLeases.forEach(({ fence }, index) => {
          const reply = replies[index];
          const error = reply?.[0];
          const successful = !error && Number(reply?.[1]) >= 1;
          this.setDenyFenceHeartbeatResult(
            fence.ownerToken,
            successful
              ? null
              : (error ??
                  new Error('redis_deny_fence_heartbeat_owner_mismatch'))
          );
        });
      } catch (error) {
        for (const { fence } of renewedLeases) {
          this.setDenyFenceHeartbeatResult(fence.ownerToken, error);
        }
      }
    }
  }

  async installDenyFencesForPlan(
    planId: string,
    planProductId: string
  ): Promise<PlanEntitlementDenyFence[]> {
    const accountIds =
      await this.repository.listCurrentAccountIdsByPlan(planId);
    return this.installDenyFences(
      accountIds.map((accountId) => ({ accountId, planProductId }))
    );
  }

  async installDenyFencesForPlanItem(
    planItemId: string
  ): Promise<PlanEntitlementDenyFence[]> {
    const context = await this.repository.findPlanItemContext(planItemId);
    if (!context) {
      return [];
    }

    const accountIds =
      await this.repository.listAccountIdsRevokedByPlanItemRemoval(planItemId);
    return this.installDenyFences(
      accountIds.map((accountId) => ({
        accountId,
        planProductId: context.plan_product_id,
      }))
    );
  }

  async installDenyFencesForCrossSell(
    planCrossSellId: string,
    previousPlanProductId?: string
  ): Promise<PlanEntitlementDenyFence[]> {
    const context = await this.repository.findCrossSellContext(planCrossSellId);
    if (!context) {
      return [];
    }

    const productIds = new Set([context.planProductId]);
    if (previousPlanProductId) {
      productIds.add(previousPlanProductId);
    }

    const impactedAccountIds =
      await this.repository.listAccountIdsRevokedByCrossSellRemoval(
        planCrossSellId
      );
    return this.installDenyFences(
      impactedAccountIds.flatMap((accountId) =>
        Array.from(productIds).map((planProductId) => ({
          accountId,
          planProductId,
        }))
      )
    );
  }

  async installDenyFenceForCrossSellAccount(
    planCrossSellAccountId: string
  ): Promise<string | null> {
    const context = await this.repository.findCrossSellAccountContext(
      planCrossSellAccountId
    );
    if (!context) {
      return null;
    }
    if (context.planProductId !== EPlanProduct.integration) {
      return null;
    }

    // Install conservatively while access is currently allowed. Projecting
    // whether this assignment is the last grant before the writer runs has a
    // TOCTOU window with renewals and duplicate assignment mutations.
    return this.installDenyFence(context.accountId, context.planProductId);
  }

  async clearDenyFence(
    accountId: string,
    planProductId: string,
    ownerToken: string
  ): Promise<void> {
    await this.refreshAfterMutation(accountId, planProductId, ownerToken);
  }

  /*
   * The methods below intentionally do not expose an unowned DEL operation.
   * Fence release is always a database CAS followed by a Redis owner CAS.
   */

  async invalidate(accountId: string, planProductId: string): Promise<void> {
    if (isRedisUnavailable(this.redis)) {
      throw new PlanEntitlementUnavailableError(
        'Redis is unavailable while invalidating plan entitlement cache'
      );
    }

    try {
      await this.redis.del(
        getPlanEntitlementCacheKey(accountId, planProductId)
      );
    } catch (error) {
      throw new PlanEntitlementUnavailableError(
        'Could not invalidate plan entitlement cache',
        error
      );
    }
  }

  private async resolveCacheMiss(
    accountId: string,
    planProductId: string
  ): Promise<PlanEntitlementResult> {
    const lockToken = await this.tryAcquireCacheLock(accountId, planProductId);
    let ownedLockToken = lockToken;

    if (ownedLockToken === false) {
      const deadline = Date.now() + PLAN_ENTITLEMENT_CACHE_LOCK_TTL_MS;
      let backoffMs = 25;
      while (Date.now() < deadline) {
        const remainingMs = deadline - Date.now();
        const jitterMs = Math.floor(
          Math.random() * Math.max(1, Math.floor(backoffMs / 4))
        );
        await wait(Math.min(backoffMs + jitterMs, remainingMs));
        const cached = await this.readCache(accountId, planProductId);
        if (cached) {
          return cached;
        }
        ownedLockToken = await this.tryAcquireCacheLock(
          accountId,
          planProductId
        );
        if (ownedLockToken !== false) break;
        backoffMs = Math.min(backoffMs * 2, 250);
      }
    }

    try {
      const resolved = await this.resolveFromPrimary(accountId, planProductId);
      return this.writeResolvedCache(resolved);
    } finally {
      if (typeof ownedLockToken === 'string') {
        await this.releaseCacheLock(accountId, planProductId, ownedLockToken);
      }
    }
  }

  private async resolveFromPrimary(
    accountId: string,
    planProductId: string
  ): Promise<ResolvedPlanEntitlementFenceState> {
    try {
      if (
        typeof this.repository.resolveEntitlementWithFenceState === 'function'
      ) {
        return await this.repository.resolveEntitlementWithFenceState(
          accountId,
          planProductId
        );
      }
      return {
        entitlement: await this.repository.resolveEntitlement(
          accountId,
          planProductId
        ),
        activeFenceOwnerToken: null,
        expiredFenceOwnerToken: null,
        staleFenceOwnerToken: null,
      };
    } catch (error) {
      if (isObservedPlanProduct(planProductId)) {
        planEntitlementTelemetryStore.recordCache('database_failure');
      }
      if (error instanceof PlanEntitlementUnavailableError) {
        throw error;
      }
      throw new PlanEntitlementUnavailableError(
        'Primary database could not resolve plan entitlement',
        error
      );
    }
  }

  private async writeResolvedCache(
    resolved: ResolvedPlanEntitlementFenceState
  ): Promise<PlanEntitlementResult> {
    if (resolved.staleFenceOwnerToken) {
      const recovery = await this.recoverStaleDenyFence(
        resolved.entitlement,
        resolved.staleFenceOwnerToken
      );
      if (recovery.entitlement) return recovery.entitlement;
      if (recovery.claimPending) return resolved.entitlement;
    }
    if (resolved.expiredFenceOwnerToken) {
      const redisWasUnavailable = isRedisUnavailable(this.redis);
      const released = await this.writeCacheReplacingOwnedFence(
        resolved.entitlement,
        resolved.expiredFenceOwnerToken
      );
      if (isObservedPlanProduct(resolved.entitlement.planProductId)) {
        planEntitlementTelemetryStore.recordFence(
          'release',
          released ? 'success' : 'error'
        );
      }
      if (released) {
        await this.repository.finalizeReleasedDenyFence(
          resolved.entitlement.accountId,
          resolved.entitlement.planProductId,
          resolved.expiredFenceOwnerToken
        );
      }
      if (!released && !redisWasUnavailable) {
        // Owner mismatch means a newer fence may have been installed after the
        // primary snapshot. Never return that now-stale positive result.
        throw new PlanEntitlementUnavailableError(
          'Could not safely repair the plan entitlement deny fence cache'
        );
      }
      return resolved.entitlement;
    }
    if (resolved.activeFenceOwnerToken) {
      if (isRedisUnavailable(this.redis)) {
        return resolved.entitlement;
      }
      const deniedPayload = JSON.stringify({
        ...JSON.parse(this.serialize(resolved.entitlement)),
        fence_token: resolved.activeFenceOwnerToken,
      } satisfies PlanEntitlementCachePayload);
      let reconstructed = false;
      try {
        const reply = await this.redis.eval(
          REINSTALL_OWNED_FENCE_SCRIPT,
          2,
          getPlanEntitlementDenyFenceKey(
            resolved.entitlement.accountId,
            resolved.entitlement.planProductId
          ),
          getPlanEntitlementEpochKey(
            resolved.entitlement.accountId,
            resolved.entitlement.planProductId
          ),
          deniedPayload,
          resolved.activeFenceOwnerToken,
          PLAN_ENTITLEMENT_DENY_FENCE_TTL_SECONDS
        );
        reconstructed = Number(reply) >= 1;
      } catch {
        reconstructed = false;
      }
      if (!reconstructed) {
        throw new PlanEntitlementUnavailableError(
          'Could not reconstruct the active plan entitlement deny fence cache'
        );
      }
      return resolved.entitlement;
    }
    await this.writeCache(resolved.entitlement);
    return resolved.entitlement;
  }

  private async recoverStaleDenyFence(
    entitlement: PlanEntitlementResult,
    ownerToken: string
  ): Promise<{
    entitlement: PlanEntitlementResult | null;
    claimPending: boolean;
  }> {
    if (isRedisUnavailable(this.redis)) {
      return { entitlement: null, claimPending: false };
    }
    const recoveryToken = randomUUID();
    let recoveryReady = false;
    let claimReply = 0;
    try {
      const reply = await this.redis.eval(
        CLAIM_STALE_FENCE_RECOVERY_SCRIPT,
        2,
        getPlanEntitlementDenyFenceKey(
          entitlement.accountId,
          entitlement.planProductId
        ),
        getPlanEntitlementEpochKey(
          entitlement.accountId,
          entitlement.planProductId
        ),
        ownerToken,
        recoveryToken,
        PLAN_ENTITLEMENT_DENY_FENCE_RECOVERY_CLAIM_TTL_SECONDS,
        PLAN_ENTITLEMENT_DENY_FENCE_RECOVERY_GRACE_SECONDS
      );
      claimReply = Number(reply);
      recoveryReady = claimReply === 2;
    } catch {
      return { entitlement: null, claimPending: false };
    }
    if (!recoveryReady) {
      return {
        entitlement: null,
        claimPending: claimReply === 1,
      };
    }

    let released;
    try {
      released = await this.repository.releaseStaleDenyFence(
        entitlement.accountId,
        entitlement.planProductId,
        ownerToken
      );
    } catch (error) {
      if (isObservedPlanProduct(entitlement.planProductId)) {
        planEntitlementTelemetryStore.recordFence('release', 'error');
      }
      throw new PlanEntitlementUnavailableError(
        'Primary database could not recover an orphaned deny fence',
        error
      );
    }
    if (!released.released) {
      await this.writeCache(released.entitlement);
      return { entitlement: released.entitlement, claimPending: false };
    }
    const cacheUpdated = await this.writeCacheReplacingOwnedFence(
      released.entitlement,
      ownerToken
    );
    if (!cacheUpdated) {
      if (isObservedPlanProduct(entitlement.planProductId)) {
        planEntitlementTelemetryStore.recordFence('release', 'error');
      }
      throw new PlanEntitlementUnavailableError(
        'Could not finalize orphaned deny fence recovery'
      );
    }
    await this.repository.finalizeReleasedDenyFence(
      entitlement.accountId,
      entitlement.planProductId,
      ownerToken
    );
    if (isObservedPlanProduct(entitlement.planProductId)) {
      planEntitlementTelemetryStore.recordFence('release', 'success');
    }
    return { entitlement: released.entitlement, claimPending: false };
  }

  private async readCache(
    accountId: string,
    planProductId: string
  ): Promise<PlanEntitlementResult | null> {
    if (isRedisUnavailable(this.redis)) {
      if (isObservedPlanProduct(planProductId)) {
        planEntitlementTelemetryStore.recordCache('redis_fallback');
      }
      return null;
    }

    try {
      const [fenceRaw, cacheRaw, epochRaw] = await this.redis.mget(
        getPlanEntitlementDenyFenceKey(accountId, planProductId),
        getPlanEntitlementCacheKey(accountId, planProductId),
        getPlanEntitlementEpochKey(accountId, planProductId)
      );
      const fence = this.parsePayload(fenceRaw, accountId, planProductId);
      if (fence) {
        // A Redis fence is a fast fail-closed signal, not the durable release
        // proof. Consult primary so a still-active owner remains denied and a
        // release-pending marker can be repaired immediately.
        return null;
      }
      if (fenceRaw !== null) {
        // A present-but-corrupt fence must never expose an older positive
        // cache entry. Force the authoritative primary path instead.
        if (isObservedPlanProduct(planProductId)) {
          planEntitlementTelemetryStore.recordCache('redis_fallback');
        }
        return null;
      }

      let epoch: PlanEntitlementResult | null = null;
      if (typeof epochRaw === 'string') {
        epoch = this.parsePayload(epochRaw, accountId, planProductId);
        if (!epoch) {
          if (isObservedPlanProduct(planProductId)) {
            planEntitlementTelemetryStore.recordCache('redis_fallback');
          }
          return null;
        }
        const rawEpoch = JSON.parse(epochRaw) as { fence_token?: unknown };
        if (
          epoch.allowed === false &&
          typeof rawEpoch.fence_token === 'string' &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            rawEpoch.fence_token
          )
        ) {
          // The short deny key can expire before a durable fence is released.
          // Force a primary read: an active durable fence remains denied, while
          // a release-pending marker is repaired with the owner-aware CAS.
          return null;
        }
      }

      const cached = this.parsePayload(cacheRaw, accountId, planProductId);
      if (
        cacheRaw !== null &&
        !cached &&
        isObservedPlanProduct(planProductId)
      ) {
        planEntitlementTelemetryStore.recordCache('redis_fallback');
      }
      if (cached && epoch) {
        const epochComparison = compareDecimalRevisions(
          epoch.revision,
          cached.revision
        );
        const sameRevisionSemanticMismatch =
          epochComparison === 0 &&
          (epoch.allowed !== cached.allowed || epoch.source !== cached.source);
        if (epochComparison > 0 || sameRevisionSemanticMismatch) {
          if (isObservedPlanProduct(planProductId)) {
            planEntitlementTelemetryStore.recordCache('redis_fallback');
          }
          return null;
        }
      }
      return cached;
    } catch {
      if (isObservedPlanProduct(planProductId)) {
        planEntitlementTelemetryStore.recordCache('redis_fallback');
      }
      return null;
    }
  }

  private parsePayload(
    raw: string | null,
    accountId: string,
    planProductId: string
  ): PlanEntitlementResult | null {
    if (!raw) {
      return null;
    }

    try {
      const value = JSON.parse(raw) as Partial<PlanEntitlementCachePayload>;
      if (
        value.account_id !== accountId ||
        value.plan_product_id !== planProductId ||
        typeof value.allowed !== 'boolean' ||
        typeof value.revision !== 'string' ||
        !/^[1-9]\d*$/.test(value.revision) ||
        typeof value.plan_is_active !== 'boolean' ||
        (value.valid_until !== null && typeof value.valid_until !== 'string') ||
        (value.source !== 'plan' &&
          value.source !== 'addon' &&
          value.source !== null) ||
        (value.allowed && value.valid_until === null) ||
        (value.allowed && !value.plan_is_active) ||
        (value.allowed &&
          value.source !== 'plan' &&
          value.source !== 'addon') ||
        (!value.allowed && value.source !== null)
      ) {
        return null;
      }

      if (value.valid_until !== null) {
        const validUntilTime = new Date(value.valid_until).getTime();
        if (!Number.isFinite(validUntilTime) || validUntilTime <= Date.now()) {
          return null;
        }
      }

      return {
        accountId: value.account_id,
        planProductId: value.plan_product_id,
        allowed: value.allowed,
        revision: value.revision,
        validUntil: value.valid_until,
        planIsActive: value.plan_is_active,
        source: value.source,
      };
    } catch {
      return null;
    }
  }

  private serialize(entitlement: PlanEntitlementResult): string {
    const payload: PlanEntitlementCachePayload = {
      account_id: entitlement.accountId,
      plan_product_id: entitlement.planProductId,
      allowed: entitlement.allowed,
      revision: entitlement.revision,
      valid_until: entitlement.validUntil,
      plan_is_active: entitlement.planIsActive,
      source: entitlement.source,
    };
    return JSON.stringify(payload);
  }

  private getCacheTtlSeconds(entitlement: PlanEntitlementResult): number {
    const jitter =
      Math.floor(
        Math.random() * (PLAN_ENTITLEMENT_CACHE_TTL_JITTER_SECONDS * 2 + 1)
      ) - PLAN_ENTITLEMENT_CACHE_TTL_JITTER_SECONDS;
    const defaultTtl = Math.max(1, PLAN_ENTITLEMENT_CACHE_TTL_SECONDS + jitter);

    if (!entitlement.validUntil) {
      return defaultTtl;
    }

    const secondsUntilExpiry = Math.floor(
      (new Date(entitlement.validUntil).getTime() - Date.now()) / 1_000
    );
    return Math.min(defaultTtl, Math.max(secondsUntilExpiry, 0));
  }

  private async writeCache(
    entitlement: PlanEntitlementResult
  ): Promise<boolean> {
    if (isRedisUnavailable(this.redis)) {
      return false;
    }

    const ttlSeconds = this.getCacheTtlSeconds(entitlement);
    if (ttlSeconds <= 0) {
      return false;
    }

    try {
      const payload = this.serialize(entitlement);
      const reply = await this.redis.eval(
        MONOTONIC_WRITE_SCRIPT,
        3,
        getPlanEntitlementDenyFenceKey(
          entitlement.accountId,
          entitlement.planProductId
        ),
        getPlanEntitlementCacheKey(
          entitlement.accountId,
          entitlement.planProductId
        ),
        getPlanEntitlementEpochKey(
          entitlement.accountId,
          entitlement.planProductId
        ),
        payload,
        ttlSeconds
      );
      return Number(reply) === 1;
    } catch {
      return false;
    }
  }

  private async writeCacheReplacingOwnedFence(
    entitlement: PlanEntitlementResult,
    ownerToken: string
  ): Promise<boolean> {
    if (isRedisUnavailable(this.redis)) {
      return false;
    }

    const ttlSeconds = this.getCacheTtlSeconds(entitlement);
    if (ttlSeconds <= 0) {
      return false;
    }

    try {
      const payload = this.serialize(entitlement);
      const reply = await this.redis.eval(
        RELEASE_OWNED_FENCE_SCRIPT,
        3,
        getPlanEntitlementDenyFenceKey(
          entitlement.accountId,
          entitlement.planProductId
        ),
        getPlanEntitlementCacheKey(
          entitlement.accountId,
          entitlement.planProductId
        ),
        getPlanEntitlementEpochKey(
          entitlement.accountId,
          entitlement.planProductId
        ),
        payload,
        ttlSeconds,
        ownerToken
      );
      return Number(reply) >= 1;
    } catch {
      return false;
    }
  }

  private async tryAcquireCacheLock(
    accountId: string,
    planProductId: string
  ): Promise<string | false | null> {
    if (isRedisUnavailable(this.redis)) {
      return null;
    }

    const token = randomUUID();
    try {
      const reply = await this.redis.set(
        getPlanEntitlementCacheLockKey(accountId, planProductId),
        token,
        'PX',
        PLAN_ENTITLEMENT_CACHE_LOCK_TTL_MS,
        'NX'
      );
      return reply === 'OK' ? token : false;
    } catch {
      return null;
    }
  }

  private async releaseCacheLock(
    accountId: string,
    planProductId: string,
    token: string
  ): Promise<void> {
    try {
      await this.redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        getPlanEntitlementCacheLockKey(accountId, planProductId),
        token
      );
    } catch {
      // The short TTL safely releases an orphaned cache-fill lock.
    }
  }
}
