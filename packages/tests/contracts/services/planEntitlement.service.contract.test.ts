import 'reflect-metadata';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import {
  getPlanEntitlementCacheKey,
  getPlanEntitlementDenyFenceKey,
  getPlanEntitlementEpochKey,
  PLAN_ENTITLEMENT_DENY_FENCE_HEARTBEAT_INTERVAL_MS,
  PLAN_ENTITLEMENT_DENY_FENCE_RECOVERY_GRACE_SECONDS,
} from '@core/common/constants/planEntitlement';
import {
  PlanEntitlementDeniedError,
  PlanEntitlementRevisionMismatchError,
  PlanEntitlementUnavailableError,
} from '@core/common/exceptions/PlanEntitlementError';
import {
  PlanEntitlementResult,
  PlanEntitlementService,
} from '@core/services/planEntitlement.service';
import { planEntitlementTelemetryStore } from '@core/services/planEntitlementTelemetryStore';
import { PlanEntitlementRepository } from '@core/repositories/planEntitlement/PlanEntitlement.repository';
import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const accountId = '11111111-1111-4111-8111-111111111111';
const productId = EPlanProduct.integration;

const entitlement = (
  overrides: Partial<PlanEntitlementResult> = {}
): PlanEntitlementResult => ({
  accountId,
  planProductId: productId,
  allowed: true,
  revision: '3',
  validUntil: '2099-01-01T00:00:00.000Z',
  planIsActive: true,
  source: 'plan',
  ...overrides,
});

const cachePayload = (value: PlanEntitlementResult): string =>
  JSON.stringify({
    account_id: value.accountId,
    plan_product_id: value.planProductId,
    allowed: value.allowed,
    revision: value.revision,
    valid_until: value.validUntil,
    plan_is_active: value.planIsActive,
    source: value.source,
  });

type RedisPipelineReply = [Error | null, string | number | null];
type RedisPipelineMock = {
  set: jest.Mock<void, unknown[]>;
  del: jest.Mock<void, unknown[]>;
  eval: jest.Mock<void, unknown[]>;
  exec: jest.Mock<Promise<RedisPipelineReply[]>, []>;
};

const createRedis = (overrides: Record<string, unknown> = {}) => {
  const pipelineCommands: unknown[][] = [];
  const pipeline = {} as RedisPipelineMock;
  pipeline.set = jest.fn((...args: unknown[]): void => {
    pipelineCommands.push(args);
  });
  pipeline.del = jest.fn((...args: unknown[]): void => {
    pipelineCommands.push(['DEL', ...args]);
  });
  pipeline.eval = jest.fn((...args: unknown[]): void => {
    pipelineCommands.push(['EVAL', ...args]);
  });
  pipeline.exec = jest.fn(async (): Promise<RedisPipelineReply[]> =>
    pipelineCommands.map((command) =>
      command[0] === 'DEL' || command[0] === 'EVAL' ? [null, 1] : [null, 'OK']
    )
  );

  return {
    status: 'ready',
    mget: jest.fn(async () => [null, null, null]),
    get: jest.fn(async () => null),
    set: jest.fn(async () => 'OK'),
    pipeline: jest.fn(() => pipeline),
    multi: jest.fn(() => pipeline),
    eval: jest.fn(async (...args: unknown[]) => {
      const [, keyCount, , cacheKey, epochKey, payload, ttlSeconds] = args;
      if (keyCount === 3) {
        pipelineCommands.push([cacheKey, payload, 'EX', ttlSeconds]);
        pipelineCommands.push([epochKey, payload]);
      }
      return 1;
    }),
    del: jest.fn(async () => 1),
    pipelineCommands,
    pipelineInstance: pipeline,
    ...overrides,
  };
};

describe('PlanEntitlementService', () => {
  beforeEach(() => {
    planEntitlementTelemetryStore.flush();
  });

  afterEach(() => {
    jest.useRealTimers();
    planEntitlementTelemetryStore.flush();
    jest.restoreAllMocks();
  });

  it('returns a valid cache hit without querying the primary database', async () => {
    const cached = entitlement();
    const repository = { resolveEntitlement: jest.fn() };
    const redis = createRedis({
      mget: jest.fn(async () => [null, cachePayload(cached)]),
    });
    const service = new PlanEntitlementService(
      repository as never,
      redis as never
    );

    await expect(service.getIntegrationEntitlement(accountId)).resolves.toEqual(
      cached
    );
    expect(repository.resolveEntitlement).not.toHaveBeenCalled();
    expect(redis.mget).toHaveBeenCalledWith(
      getPlanEntitlementDenyFenceKey(accountId, productId),
      getPlanEntitlementCacheKey(accountId, productId),
      getPlanEntitlementEpochKey(accountId, productId)
    );
  });

  it('gives a deny fence precedence over a positive cache entry', async () => {
    const positive = entitlement();
    const fenced = entitlement({ allowed: false, source: null });
    const repository = { resolveEntitlement: jest.fn(async () => fenced) };
    const redis = createRedis({
      mget: jest.fn(async () => [cachePayload(fenced), cachePayload(positive)]),
    });
    const service = new PlanEntitlementService(
      repository as never,
      redis as never
    );

    await expect(service.getEntitlement(accountId, productId)).resolves.toEqual(
      fenced
    );
    expect(repository.resolveEntitlement).toHaveBeenCalledWith(
      accountId,
      productId
    );
  });

  it('never falls through to a positive cache when a Redis fence is corrupt', async () => {
    const positive = entitlement();
    const denied = entitlement({ allowed: false, source: null });
    const repository = {
      resolveEntitlement: jest.fn(async () => denied),
    };
    const redis = createRedis({
      mget: jest.fn(async () => ['{corrupt', cachePayload(positive)]),
    });
    const service = new PlanEntitlementService(
      repository as never,
      redis as never
    );

    await expect(service.getEntitlement(accountId, productId)).resolves.toEqual(
      denied
    );
    expect(repository.resolveEntitlement).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed revisions and dates in negative cache entries', async () => {
    const primary = entitlement({
      allowed: false,
      revision: '9',
      source: null,
    });
    const repository = {
      resolveEntitlement: jest.fn(async () => primary),
    };
    const corrupt = JSON.stringify({
      ...JSON.parse(cachePayload(primary)),
      revision: '0',
      valid_until: 'not-a-date',
    });
    const redis = createRedis({
      mget: jest.fn(async () => [null, corrupt]),
    });
    const service = new PlanEntitlementService(
      repository as never,
      redis as never
    );

    await expect(service.getEntitlement(accountId, productId)).resolves.toEqual(
      primary
    );
    expect(repository.resolveEntitlement).toHaveBeenCalledTimes(1);
  });

  it('rejects cache payloads whose source contradicts the allowed flag', async () => {
    const primary = entitlement();
    const repository = {
      resolveEntitlement: jest.fn(async () => primary),
    };
    const inconsistent = cachePayload(
      entitlement({ allowed: true, source: null })
    );
    const service = new PlanEntitlementService(
      repository as never,
      createRedis({
        mget: jest.fn(async () => [null, inconsistent, null]),
      }) as never
    );

    await expect(service.getEntitlement(accountId, productId)).resolves.toEqual(
      primary
    );
    expect(repository.resolveEntitlement).toHaveBeenCalledTimes(1);
  });

  it('rejects an allowed cache payload without a validUntil boundary', async () => {
    const primary = entitlement();
    const repository = {
      resolveEntitlement: jest.fn(async () => primary),
    };
    const service = new PlanEntitlementService(
      repository as never,
      createRedis({
        mget: jest.fn(async () => [
          null,
          cachePayload(entitlement({ validUntil: null })),
          null,
        ]),
      }) as never
    );

    await expect(service.getEntitlement(accountId, productId)).resolves.toEqual(
      primary
    );
    expect(repository.resolveEntitlement).toHaveBeenCalledTimes(1);
  });

  it('rejects an allowed cache payload whose plan is marked inactive', async () => {
    const primary = entitlement();
    const repository = {
      resolveEntitlement: jest.fn(async () => primary),
    };
    const service = new PlanEntitlementService(
      repository as never,
      createRedis({
        mget: jest.fn(async () => [
          null,
          cachePayload(entitlement({ planIsActive: false })),
          null,
        ]),
      }) as never
    );

    await expect(service.getEntitlement(accountId, productId)).resolves.toEqual(
      primary
    );
    expect(repository.resolveEntitlement).toHaveBeenCalledTimes(1);
  });

  it('never serves a short positive cache older than the persistent epoch', async () => {
    const stalePositive = entitlement({ revision: '3' });
    const currentDenied = entitlement({
      allowed: false,
      revision: '4',
      source: null,
    });
    const repository = {
      resolveEntitlement: jest.fn(async () => currentDenied),
    };
    const service = new PlanEntitlementService(
      repository as never,
      createRedis({
        mget: jest.fn(async () => [
          null,
          cachePayload(stalePositive),
          cachePayload(currentDenied),
        ]),
      }) as never
    );

    await expect(service.getEntitlement(accountId, productId)).resolves.toEqual(
      currentDenied
    );
    expect(repository.resolveEntitlement).toHaveBeenCalledTimes(1);
  });

  it('forces primary when short cache and epoch disagree at the same revision', async () => {
    const stalePlanSource = entitlement({ revision: '8', source: 'plan' });
    const currentAddonSource = entitlement({ revision: '8', source: 'addon' });
    const repository = {
      resolveEntitlement: jest.fn(async () => currentAddonSource),
    };
    const service = new PlanEntitlementService(
      repository as never,
      createRedis({
        mget: jest.fn(async () => [
          null,
          cachePayload(stalePlanSource),
          cachePayload(currentAddonSource),
        ]),
      }) as never
    );

    await expect(service.getEntitlement(accountId, productId)).resolves.toEqual(
      currentAddonSource
    );
    expect(repository.resolveEntitlement).toHaveBeenCalledTimes(1);
  });

  it('falls back to primary for malformed or expired positive cache values', async () => {
    const primary = entitlement({ revision: '4' });
    const repository = {
      resolveEntitlement: jest.fn(async () => primary),
    };
    const malformed = cachePayload(entitlement({ validUntil: 'not-a-date' }));
    const redis = createRedis({
      mget: jest.fn(async () => [null, malformed]),
    });
    const service = new PlanEntitlementService(
      repository as never,
      redis as never
    );

    await expect(service.getEntitlement(accountId, productId)).resolves.toEqual(
      primary
    );
    expect(repository.resolveEntitlement).toHaveBeenCalledWith(
      accountId,
      productId
    );
  });

  it('atomically writes the short cache and durable epoch when no fence exists', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const primary = entitlement();
    const repository = {
      resolveEntitlement: jest.fn(async () => primary),
    };
    const redis = createRedis();
    const service = new PlanEntitlementService(
      repository as never,
      redis as never
    );

    await expect(service.getEntitlement(accountId, productId)).resolves.toEqual(
      primary
    );

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('exists', KEYS[1])"),
      3,
      getPlanEntitlementDenyFenceKey(accountId, productId),
      getPlanEntitlementCacheKey(accountId, productId),
      getPlanEntitlementEpochKey(accountId, productId),
      cachePayload(primary),
      60
    );
  });

  it('applies 55/65 second jitter bounds to the short cache TTL', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-11T12:00:00.000Z'));
    const random = jest.spyOn(Math, 'random');

    const lowRedis = createRedis();
    random.mockReturnValue(0);
    await new PlanEntitlementService(
      { resolveEntitlement: jest.fn(async () => entitlement()) } as never,
      lowRedis as never
    ).getEntitlement(accountId, productId);
    const lowWrite = lowRedis.eval.mock.calls.find(([script]) =>
      String(script).includes("redis.call('exists', KEYS[1])")
    );
    expect(lowWrite?.[6]).toBe(55);

    const highRedis = createRedis();
    random.mockReturnValue(0.999999);
    await new PlanEntitlementService(
      { resolveEntitlement: jest.fn(async () => entitlement()) } as never,
      highRedis as never
    ).getEntitlement(accountId, productId);
    const highWrite = highRedis.eval.mock.calls.find(([script]) =>
      String(script).includes("redis.call('exists', KEYS[1])")
    );
    expect(highWrite?.[6]).toBe(65);
  });

  it('caps the cache TTL at validUntil without crossing expiration', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-11T12:00:00.000Z'));
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const redis = createRedis();
    const nearExpiry = entitlement({
      validUntil: '2026-07-11T12:00:10.500Z',
    });

    await new PlanEntitlementService(
      { resolveEntitlement: jest.fn(async () => nearExpiry) } as never,
      redis as never
    ).getEntitlement(accountId, productId);

    const cacheWrite = redis.eval.mock.calls.find(([script]) =>
      String(script).includes("redis.call('exists', KEYS[1])")
    );
    expect(cacheWrite?.[6]).toBe(10);
  });

  it('treats a cache value expiring exactly now as a miss', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-11T12:00:00.000Z'));
    const denied = entitlement({
      allowed: false,
      source: null,
      validUntil: null,
      planIsActive: false,
    });
    const repository = { resolveEntitlement: jest.fn(async () => denied) };
    const redis = createRedis({
      mget: jest.fn(async () => [
        null,
        cachePayload(entitlement({ validUntil: '2026-07-11T12:00:00.000Z' })),
        null,
      ]),
    });

    await expect(
      new PlanEntitlementService(
        repository as never,
        redis as never
      ).getEntitlement(accountId, productId)
    ).resolves.toEqual(denied);
    expect(repository.resolveEntitlement).toHaveBeenCalledTimes(1);
  });

  it('single-flights concurrent local cache misses', async () => {
    let finishPrimary!: (value: PlanEntitlementResult) => void;
    const pendingPrimary = new Promise<PlanEntitlementResult>((resolve) => {
      finishPrimary = resolve;
    });
    const repository = {
      resolveEntitlement: jest.fn(() => pendingPrimary),
    };
    const service = new PlanEntitlementService(
      repository as never,
      createRedis() as never
    );

    const first = service.getEntitlement(accountId, productId);
    const second = service.getEntitlement(accountId, productId);
    finishPrimary(entitlement());

    await expect(Promise.all([first, second])).resolves.toEqual([
      entitlement(),
      entitlement(),
    ]);
    expect(repository.resolveEntitlement).toHaveBeenCalledTimes(1);
  });

  it('waits beyond 75ms for a distributed cache filler before querying primary', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-11T12:00:00.000Z'));
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const cached = entitlement();
    let reads = 0;
    const redis = createRedis({
      mget: jest.fn(async () => {
        reads += 1;
        return reads >= 5
          ? [null, cachePayload(cached), null]
          : [null, null, null];
      }),
      set: jest.fn(async () => null),
    });
    const repository = { resolveEntitlement: jest.fn() };
    const service = new PlanEntitlementService(
      repository as never,
      redis as never
    );

    const result = service.getEntitlement(accountId, productId);
    await jest.advanceTimersByTimeAsync(500);

    await expect(result).resolves.toEqual(cached);
    expect(reads).toBeGreaterThanOrEqual(5);
    expect(repository.resolveEntitlement).not.toHaveBeenCalled();
  });

  it('uses DatabaseRw when Redis is closed and wraps a database failure', async () => {
    const primary = entitlement();
    const availableService = new PlanEntitlementService(
      { resolveEntitlement: jest.fn(async () => primary) } as never,
      createRedis({ status: 'end' }) as never
    );

    await expect(
      availableService.getEntitlement(accountId, productId)
    ).resolves.toEqual(primary);

    const unavailableService = new PlanEntitlementService(
      {
        resolveEntitlement: jest.fn(async () => {
          throw new Error('database offline');
        }),
      } as never,
      createRedis({ status: 'end' }) as never
    );

    await expect(
      unavailableService.getEntitlement(accountId, productId)
    ).rejects.toBeInstanceOf(PlanEntitlementUnavailableError);
  });

  it('throws typed denial and epoch mismatch errors', async () => {
    const denied = entitlement({
      allowed: false,
      revision: '7',
      validUntil: null,
      planIsActive: false,
      source: null,
    });
    const deniedService = new PlanEntitlementService(
      { resolveEntitlement: jest.fn(async () => denied) } as never,
      createRedis({ status: 'end' }) as never
    );

    await expect(
      deniedService.assertEntitled(accountId, productId)
    ).rejects.toBeInstanceOf(PlanEntitlementDeniedError);

    const allowedService = new PlanEntitlementService(
      { resolveEntitlement: jest.fn(async () => entitlement()) } as never,
      createRedis({ status: 'end' }) as never
    );
    await expect(
      allowedService.assertEntitled(accountId, productId, {
        expectedRevision: '2',
      })
    ).rejects.toBeInstanceOf(PlanEntitlementRevisionMismatchError);
  });

  it('enforces A -> B -> A while preserving configuration and accepting only the new epoch', async () => {
    const storedIntegrationConfiguration = {
      publicApiToken: 'uc_live_preserved',
      inboundWebhookMapping: { phone: 'phone' },
      outboundEndpoint: 'https://example.com/webhook',
    };
    let authoritative = entitlement({ revision: '11' });
    const repository = {
      resolveEntitlement: jest.fn(async () => authoritative),
    };
    const service = new PlanEntitlementService(
      repository as never,
      createRedis({ status: 'end' }) as never
    );

    await expect(
      service.assertEntitled(accountId, productId, {
        expectedRevision: '11',
      })
    ).resolves.toEqual(authoritative);

    authoritative = entitlement({
      allowed: false,
      revision: '12',
      source: null,
    });
    await expect(
      service.assertEntitled(accountId, productId)
    ).rejects.toBeInstanceOf(PlanEntitlementDeniedError);
    expect(storedIntegrationConfiguration).toEqual({
      publicApiToken: 'uc_live_preserved',
      inboundWebhookMapping: { phone: 'phone' },
      outboundEndpoint: 'https://example.com/webhook',
    });

    authoritative = entitlement({ revision: '13' });
    await expect(
      service.assertEntitled(accountId, productId, {
        expectedRevision: '11',
      })
    ).rejects.toBeInstanceOf(PlanEntitlementRevisionMismatchError);
    await expect(
      service.assertEntitled(accountId, productId, {
        expectedRevision: '13',
      })
    ).resolves.toEqual(authoritative);
    expect(storedIntegrationConfiguration.publicApiToken).toBe(
      'uc_live_preserved'
    );
  });

  it('clears only the caller-owned fence after authoritative reconciliation', async () => {
    const primary = entitlement({ allowed: false, source: null });
    const ownerToken = '22222222-2222-4222-8222-222222222222';
    const failingRedis = createRedis({
      eval: jest.fn(async () => 0),
    });
    const failingService = new PlanEntitlementService(
      {
        releaseDenyFence: jest.fn(async () => ({
          released: true,
          entitlement: primary,
        })),
        finalizeReleasedDenyFence: jest.fn(async () => undefined),
      } as never,
      failingRedis as never
    );

    await expect(
      failingService.refreshAfterMutation(accountId, productId, ownerToken)
    ).rejects.toBeInstanceOf(PlanEntitlementUnavailableError);
    expect(failingRedis.del).not.toHaveBeenCalled();

    const healthyRedis = createRedis();
    const healthyService = new PlanEntitlementService(
      {
        releaseDenyFence: jest.fn(async () => ({
          released: true,
          entitlement: primary,
        })),
        finalizeReleasedDenyFence: jest.fn(async () => undefined),
      } as never,
      healthyRedis as never
    );
    await healthyService.refreshAfterMutation(accountId, productId, ownerToken);
    expect(healthyRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining('fence.fence_token ~= ARGV[3]'),
      3,
      getPlanEntitlementDenyFenceKey(accountId, productId),
      getPlanEntitlementCacheKey(accountId, productId),
      getPlanEntitlementEpochKey(accountId, productId),
      cachePayload(primary),
      expect.any(Number),
      ownerToken
    );
  });

  it('never clears a newer fence when the database owner CAS does not match', async () => {
    const denied = entitlement({ allowed: false, source: null });
    const repository = {
      releaseDenyFence: jest.fn(async () => ({
        released: false,
        entitlement: denied,
      })),
    };
    const redis = createRedis();
    const service = new PlanEntitlementService(
      repository as never,
      redis as never
    );

    await expect(
      service.refreshAfterMutation(
        accountId,
        productId,
        '33333333-3333-4333-8333-333333333333'
      )
    ).resolves.toEqual(denied);
    expect(repository.releaseDenyFence).toHaveBeenCalledWith(
      accountId,
      productId,
      '33333333-3333-4333-8333-333333333333'
    );
    expect(redis.eval).toHaveBeenCalled();
    expect(String(redis.eval.mock.calls[0]?.[0])).toContain(
      "redis.call('exists', KEYS[1])"
    );
    expect(String(redis.eval.mock.calls[0]?.[0])).not.toContain(
      'fence.fence_token'
    );
  });

  it('verifies a deny fence on primary even when bypassing the normal cache', async () => {
    const fenced = entitlement({ allowed: false, source: null });
    const repository = { resolveEntitlement: jest.fn(async () => fenced) };
    const redis = createRedis({
      get: jest.fn(async () => cachePayload(fenced)),
    });
    const service = new PlanEntitlementService(
      repository as never,
      redis as never
    );

    await expect(
      service.getEntitlement(accountId, productId, { bypassCache: true })
    ).resolves.toEqual(fenced);
    expect(repository.resolveEntitlement).toHaveBeenCalledWith(
      accountId,
      productId
    );
  });

  it('rebuilds Redis deny and epoch from a fresh active PostgreSQL owner after restart', async () => {
    const ownerToken = '66666666-6666-4666-8666-666666666666';
    const denied = entitlement({ allowed: false, source: null });
    const repository = {
      resolveEntitlementWithFenceState: jest.fn(async () => ({
        entitlement: denied,
        activeFenceOwnerToken: ownerToken,
        expiredFenceOwnerToken: null,
        staleFenceOwnerToken: null,
      })),
    };
    const redisEval = jest.fn(async (..._args: unknown[]) => 2);
    const service = new PlanEntitlementService(
      repository as never,
      createRedis({ eval: redisEval }) as never
    );

    await expect(
      service.getEntitlement(accountId, productId, { bypassCache: true })
    ).resolves.toEqual(denied);
    expect(String(redisEval.mock.calls[0]?.[0])).toContain(
      'return epoch_raw and 1 or 2'
    );
    expect(redisEval.mock.calls[0]?.slice(-2)).toEqual([ownerToken, 300]);
  });

  it('does not resurrect an active PostgreSQL snapshot over an equal unfenced Redis epoch', async () => {
    const repository = {
      resolveEntitlementWithFenceState: jest.fn(async () => ({
        entitlement: entitlement({ allowed: false, source: null }),
        activeFenceOwnerToken: '66666666-6666-4666-8666-666666666666',
        expiredFenceOwnerToken: null,
        staleFenceOwnerToken: null,
      })),
    };
    const service = new PlanEntitlementService(
      repository as never,
      createRedis({ eval: jest.fn(async () => 0) }) as never
    );

    await expect(
      service.getEntitlement(accountId, productId, { bypassCache: true })
    ).rejects.toBeInstanceOf(PlanEntitlementUnavailableError);
  });

  it('reconciles from primary before a mutation even when a previous fence exists', async () => {
    const fenced = entitlement({ allowed: false, revision: '3', source: null });
    const primary = entitlement({
      allowed: false,
      revision: '4',
      source: null,
    });
    const repository = {
      resolveEntitlement: jest.fn(async () => primary),
    };
    const redis = createRedis({
      get: jest.fn(async () => cachePayload(fenced)),
    });
    const service = new PlanEntitlementService(
      repository as never,
      redis as never
    );

    await expect(
      service.resolveAuthoritatively(accountId, productId)
    ).resolves.toEqual(primary);
    expect(repository.resolveEntitlement).toHaveBeenCalledWith(
      accountId,
      productId
    );
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('installs a full fail-closed fence through a Redis pipeline', async () => {
    const current = entitlement();
    const redis = createRedis();
    const service = new PlanEntitlementService(
      { resolveEntitlement: jest.fn(async () => current) } as never,
      redis as never
    );

    await service.installDenyFence(accountId, productId);

    const command = redis.pipelineCommands[0];
    expect(command?.slice(0, 5)).toEqual([
      'EVAL',
      expect.stringContaining("redis.call('set', KEYS[1]"),
      2,
      getPlanEntitlementDenyFenceKey(accountId, productId),
      getPlanEntitlementEpochKey(accountId, productId),
    ]);
    const payload = JSON.parse(String(command?.[5]));
    expect(payload).toMatchObject({
      ...JSON.parse(cachePayload({ ...current, allowed: false, source: null })),
      fence_token: expect.any(String),
    });
    expect(command?.[6]).toBe(300);
  });

  it('adopts an unfinished owner and rebuilds an empty Redis epoch after restart', async () => {
    const activeOwnerToken = '66666666-6666-4666-8666-666666666666';
    const denied = entitlement({ allowed: false, source: null });
    const repository = {
      installOrAdoptDenyFenceForRevocationRetry: jest.fn(async () => ({
        ownerToken: activeOwnerToken,
        entitlement: denied,
        adopted: true,
        releasePending: false,
      })),
      heartbeatDenyFences: jest.fn(async (targets) => targets),
      releaseDenyFence: jest.fn(async () => ({
        released: true,
        entitlement: entitlement(),
      })),
      finalizeReleasedDenyFence: jest.fn(async () => undefined),
    };
    const redis = createRedis({ eval: jest.fn(async () => 2) });
    const service = new PlanEntitlementService(
      repository as never,
      redis as never
    );

    await expect(
      service.installOrAdoptDenyFenceForRevocationRetry(
        accountId,
        productId,
        'payment-refund:payment-1'
      )
    ).resolves.toEqual({ ownerToken: activeOwnerToken, adopted: true });

    expect(
      repository.installOrAdoptDenyFenceForRevocationRetry
    ).toHaveBeenCalledWith(
      accountId,
      productId,
      expect.any(String),
      'payment-refund:payment-1'
    );
    expect(repository.heartbeatDenyFences).toHaveBeenCalledWith([
      {
        accountId,
        planProductId: productId,
        ownerToken: activeOwnerToken,
        operationKey: 'payment-refund:payment-1',
      },
    ]);
    expect(String(redis.eval.mock.calls[0]?.[0])).toContain(
      'epoch.fence_token ~= ARGV[2]'
    );
    expect(String(redis.eval.mock.calls[0]?.[0])).toContain(
      'return epoch_raw and 1 or 2'
    );
    expect(redis.eval.mock.calls[0]?.slice(1)).toEqual([
      2,
      getPlanEntitlementDenyFenceKey(accountId, productId),
      getPlanEntitlementEpochKey(accountId, productId),
      expect.stringContaining(`"fence_token":"${activeOwnerToken}"`),
      activeOwnerToken,
      300,
    ]);

    await expect(
      service.refreshAfterMutation(accountId, productId, activeOwnerToken)
    ).resolves.toEqual(entitlement());
    expect(repository.releaseDenyFence).toHaveBeenCalledWith(
      accountId,
      productId,
      activeOwnerToken
    );
  });

  it('keeps an adopted revocation fence when Redis owner confirmation fails', async () => {
    const activeOwnerToken = '66666666-6666-4666-8666-666666666666';
    const repository = {
      installOrAdoptDenyFenceForRevocationRetry: jest.fn(async () => ({
        ownerToken: activeOwnerToken,
        entitlement: entitlement({ allowed: false, source: null }),
        adopted: true,
        releasePending: false,
      })),
      heartbeatDenyFences: jest.fn(async (targets) => targets),
      releaseDenyFence: jest.fn(),
    };
    const service = new PlanEntitlementService(
      repository as never,
      createRedis({ eval: jest.fn(async () => 0) }) as never
    );

    await expect(
      service.installOrAdoptDenyFenceForRevocationRetry(
        accountId,
        productId,
        'payment-refund:payment-1'
      )
    ).rejects.toBeInstanceOf(PlanEntitlementUnavailableError);
    expect(repository.releaseDenyFence).not.toHaveBeenCalled();
  });

  it.each([1, 2])(
    'completes a release-pending owner (Redis completion=%s) before installing a fresh retry fence',
    async (completionReply) => {
      const releasedOwner = '66666666-6666-4666-8666-666666666666';
      const operationKey = 'payment-refund:payment-1';
      const denied = entitlement({
        allowed: false,
        revision: '4',
        source: null,
      });
      let installAttempt = 0;
      const repository = {
        installOrAdoptDenyFenceForRevocationRetry: jest.fn(
          async (
            _accountId: string,
            _productId: string,
            requestedOwnerToken: string
          ) => {
            installAttempt += 1;
            return installAttempt === 1
              ? {
                  ownerToken: releasedOwner,
                  entitlement: denied,
                  adopted: true,
                  releasePending: true,
                }
              : {
                  ownerToken: requestedOwnerToken,
                  entitlement: denied,
                  adopted: false,
                  releasePending: false,
                };
          }
        ),
        finalizeReleasedDenyFenceForOperation: jest.fn(async () => true),
        releaseDenyFence: jest.fn(),
      };
      const redisEval = jest
        .fn()
        .mockResolvedValueOnce(completionReply)
        .mockResolvedValueOnce(1);
      const service = new PlanEntitlementService(
        repository as never,
        createRedis({ eval: redisEval }) as never
      );

      await expect(
        service.installOrAdoptDenyFenceForRevocationRetry(
          accountId,
          productId,
          operationKey
        )
      ).resolves.toEqual({
        ownerToken: expect.any(String),
        adopted: false,
      });

      expect(
        repository.finalizeReleasedDenyFenceForOperation
      ).toHaveBeenCalledWith(accountId, productId, releasedOwner, operationKey);
      expect(
        repository.installOrAdoptDenyFenceForRevocationRetry
      ).toHaveBeenCalledTimes(2);
      expect(String(redisEval.mock.calls[0]?.[0])).toContain(
        'epoch.fence_token ~= ARGV[3]'
      );
      expect(String(redisEval.mock.calls[0]?.[0])).toContain(
        'compare_revision(incoming.revision, epoch.revision) < 0'
      );
      expect(String(redisEval.mock.calls[1]?.[0])).toContain(
        "redis.call('set', KEYS[1]"
      );
      expect(repository.releaseDenyFence).not.toHaveBeenCalled();
    }
  );

  it('keeps release-pending durable state when Redis completion rejects a newer or foreign epoch', async () => {
    const repository = {
      installOrAdoptDenyFenceForRevocationRetry: jest.fn(async () => ({
        ownerToken: '66666666-6666-4666-8666-666666666666',
        entitlement: entitlement({
          allowed: false,
          revision: '4',
          source: null,
        }),
        adopted: true,
        releasePending: true,
      })),
      finalizeReleasedDenyFenceForOperation: jest.fn(),
      releaseDenyFence: jest.fn(),
    };
    const service = new PlanEntitlementService(
      repository as never,
      createRedis({ eval: jest.fn(async () => 0) }) as never
    );

    await expect(
      service.installOrAdoptDenyFenceForRevocationRetry(
        accountId,
        productId,
        'payment-refund:payment-1'
      )
    ).rejects.toBeInstanceOf(PlanEntitlementUnavailableError);
    expect(
      repository.finalizeReleasedDenyFenceForOperation
    ).not.toHaveBeenCalled();
    expect(repository.releaseDenyFence).not.toHaveBeenCalled();
  });

  it('records cache hits, primary fallbacks and database failures without account labels', async () => {
    const cached = entitlement();
    const cacheHitService = new PlanEntitlementService(
      { resolveEntitlement: jest.fn() } as never,
      createRedis({
        mget: jest.fn(async () => [null, cachePayload(cached)]),
      }) as never
    );
    await cacheHitService.getIntegrationEntitlement(accountId);

    const fallbackService = new PlanEntitlementService(
      { resolveEntitlement: jest.fn(async () => cached) } as never,
      createRedis({
        mget: jest.fn(async () => [null, '{corrupt']),
      }) as never
    );
    await fallbackService.getIntegrationEntitlement(accountId);

    const unavailableService = new PlanEntitlementService(
      {
        resolveEntitlement: jest.fn(async () => {
          throw new Error('primary unavailable');
        }),
      } as never,
      createRedis({ status: 'end' }) as never
    );
    await expect(
      unavailableService.getIntegrationEntitlement(accountId)
    ).rejects.toBeInstanceOf(PlanEntitlementUnavailableError);

    const snapshot = planEntitlementTelemetryStore.snapshot();
    expect(snapshot.cache).toEqual({
      hit: 1,
      miss: 2,
      redis_fallback: 2,
      database_failure: 1,
    });
    expect(snapshot).not.toHaveProperty(accountId);
  });

  it('falls back immediately while Redis is reconnecting without queuing commands', async () => {
    const primary = entitlement();
    const never = new Promise<never>(() => undefined);
    const redis = createRedis({
      status: 'reconnecting',
      mget: jest.fn(() => never),
      multi: jest.fn(() => {
        throw new Error('must not queue');
      }),
    });
    const repository = {
      resolveEntitlement: jest.fn(async () => primary),
    };
    const service = new PlanEntitlementService(
      repository as never,
      redis as never
    );

    await expect(service.getEntitlement(accountId, productId)).resolves.toEqual(
      primary
    );
    expect(redis.mget).not.toHaveBeenCalled();
    await expect(
      service.installDenyFence(accountId, productId)
    ).rejects.toBeInstanceOf(PlanEntitlementUnavailableError);
    expect(redis.multi).not.toHaveBeenCalled();
  });

  it('does not depend on Redis when PostgreSQL finds no allowed target to fence', async () => {
    const repository = {
      installDenyFences: jest.fn(async () => []),
    };
    const redis = createRedis({
      status: 'reconnecting',
      multi: jest.fn(() => {
        throw new Error('must not queue');
      }),
    });
    const service = new PlanEntitlementService(
      repository as never,
      redis as never
    );

    await expect(
      service.installDenyFences([{ accountId, planProductId: productId }])
    ).resolves.toEqual([]);
    expect(repository.installDenyFences).toHaveBeenCalledTimes(1);
    expect(redis.multi).not.toHaveBeenCalled();
  });

  it('does not install an Integration fence for another add-on product', async () => {
    const repository = {
      findCrossSellAccountContext: jest.fn(async () => ({
        accountId,
        planProductId: 'another-plan-product',
        planCrossSellId: 'addon-1',
      })),
    };
    const service = new PlanEntitlementService(
      repository as never,
      createRedis({ status: 'reconnecting' }) as never
    );
    const install = jest.spyOn(service, 'installDenyFence');

    await expect(
      service.installDenyFenceForCrossSellAccount('assignment-1')
    ).resolves.toBeNull();
    expect(install).not.toHaveBeenCalled();
  });

  it('marks a durable fence release-pending when Redis is unavailable after install', async () => {
    const ownerEntitlement = entitlement({ allowed: false, source: null });
    const repository = {
      installDenyFences: jest.fn(
        async (targets: Array<{ ownerToken: string }>) => [
          {
            ownerToken: targets[0]?.ownerToken,
            entitlement: ownerEntitlement,
          },
        ]
      ),
      releaseDenyFence: jest.fn(async () => ({
        released: true,
        entitlement: entitlement(),
      })),
      finalizeReleasedDenyFence: jest.fn(async () => undefined),
    };
    const service = new PlanEntitlementService(
      repository as never,
      createRedis({ status: 'reconnecting' }) as never
    );

    await expect(
      service.installDenyFences([{ accountId, planProductId: productId }])
    ).rejects.toBeInstanceOf(PlanEntitlementUnavailableError);
    expect(repository.installDenyFences).toHaveBeenCalledTimes(1);
    expect(repository.releaseDenyFence).toHaveBeenCalledTimes(1);
    expect(repository.finalizeReleasedDenyFence).not.toHaveBeenCalled();
  });

  it('forces a primary check for a fenced epoch when the short deny key was evicted', async () => {
    const positive = entitlement();
    const denied = entitlement({ allowed: false, source: null });
    const epoch = JSON.stringify({
      ...JSON.parse(
        cachePayload(entitlement({ allowed: false, source: null }))
      ),
      fence_token: '66666666-6666-4666-8666-666666666666',
    });
    const repository = { resolveEntitlement: jest.fn(async () => denied) };
    const redis = createRedis({
      mget: jest.fn(async () => [null, cachePayload(positive), epoch]),
    });
    const service = new PlanEntitlementService(
      repository as never,
      redis as never
    );

    await expect(service.getEntitlement(accountId, productId)).resolves.toEqual(
      denied
    );
    expect(repository.resolveEntitlement).toHaveBeenCalledWith(
      accountId,
      productId
    );
  });

  it('repairs a pending release even while the Redis deny key still exists', async () => {
    const ownerToken = '66666666-6666-4666-8666-666666666666';
    const released = entitlement();
    const fencedEpoch = JSON.stringify({
      ...JSON.parse(
        cachePayload(entitlement({ allowed: false, source: null }))
      ),
      fence_token: ownerToken,
    });
    const repository = {
      resolveEntitlementWithFenceState: jest.fn(async () => ({
        entitlement: released,
        expiredFenceOwnerToken: ownerToken,
      })),
      finalizeReleasedDenyFence: jest.fn(async () => undefined),
    };
    const redis = createRedis({
      mget: jest.fn(async () => [
        fencedEpoch,
        cachePayload(released),
        fencedEpoch,
      ]),
      eval: jest.fn(async () => 2),
    });
    const service = new PlanEntitlementService(
      repository as never,
      redis as never
    );

    await expect(service.getEntitlement(accountId, productId)).resolves.toEqual(
      released
    );
    expect(repository.resolveEntitlementWithFenceState).toHaveBeenCalledTimes(
      1
    );
    expect(repository.finalizeReleasedDenyFence).toHaveBeenCalledWith(
      accountId,
      productId,
      ownerToken
    );
    expect(String(redis.eval.mock.calls[0]?.[0])).toContain(
      'fence.fence_token ~= ARGV[3]'
    );
  });

  it('preserves same-revision epoch ownership until the owner-aware release CAS', async () => {
    const ownerToken = '88888888-8888-4888-8888-888888888888';
    const denied = entitlement({ allowed: false, source: null });
    const allowed = entitlement();
    const fencedEpoch = JSON.stringify({
      ...JSON.parse(cachePayload(denied)),
      fence_token: ownerToken,
    });
    const repository = {
      resolveEntitlement: jest.fn(async () => denied),
      releaseDenyFence: jest.fn(async () => ({
        released: true,
        entitlement: allowed,
      })),
      finalizeReleasedDenyFence: jest.fn(async () => undefined),
    };
    const evalCommand = jest.fn(async (script: unknown) => {
      const source = String(script);
      if (source.includes('fence.fence_token ~= ARGV[3]')) return 2;
      if (source.includes('if current.fence_token then return 0 end')) return 0;
      return 1;
    });
    const redis = createRedis({
      mget: jest.fn(async () => [null, cachePayload(allowed), fencedEpoch]),
      eval: evalCommand,
    });
    const service = new PlanEntitlementService(
      repository as never,
      redis as never
    );

    await expect(service.getEntitlement(accountId, productId)).resolves.toEqual(
      denied
    );
    expect(
      evalCommand.mock.calls.some(([script]) =>
        String(script).includes('if current.fence_token then return 0 end')
      )
    ).toBe(true);

    await expect(
      service.refreshAfterMutation(accountId, productId, ownerToken)
    ).resolves.toEqual(allowed);
    expect(
      evalCommand.mock.calls.some(([script]) =>
        String(script).includes('fence.fence_token ~= ARGV[3]')
      )
    ).toBe(true);
    expect(repository.finalizeReleasedDenyFence).toHaveBeenCalledWith(
      accountId,
      productId,
      ownerToken
    );
  });

  it('remains fail-closed after the 300s deny-key lease expires without a heartbeat', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-11T12:00:00.000Z'));
    const ownerToken = '99999999-9999-4999-8999-999999999999';
    const denied = entitlement({ allowed: false, source: null });
    const fencedEpoch = JSON.stringify({
      ...JSON.parse(cachePayload(denied)),
      fence_token: ownerToken,
    });
    const repository = { resolveEntitlement: jest.fn(async () => denied) };
    const redis = createRedis({
      // The short deny key is gone; the no-TTL epoch owner proof remains.
      mget: jest.fn(async () => [
        null,
        cachePayload(entitlement()),
        fencedEpoch,
      ]),
    });
    const service = new PlanEntitlementService(
      repository as never,
      redis as never
    );

    jest.setSystemTime(new Date('2026-07-11T12:05:01.000Z'));
    await expect(service.getEntitlement(accountId, productId)).resolves.toEqual(
      denied
    );
    expect(repository.resolveEntitlement).toHaveBeenCalledTimes(1);

    const disconnectedRedis = createRedis({
      status: 'reconnecting',
      mget: jest.fn(() => {
        throw new Error('must not queue while reconnecting');
      }),
    });
    await expect(
      new PlanEntitlementService(
        { resolveEntitlement: jest.fn(async () => denied) } as never,
        disconnectedRedis as never
      ).getEntitlement(accountId, productId)
    ).resolves.toEqual(denied);
    expect(disconnectedRedis.mget).not.toHaveBeenCalled();
  });

  it('repairs a release marker after Redis failed between PG release and CAS', async () => {
    const ownerToken = '77777777-7777-4777-8777-777777777777';
    const current = entitlement();
    const firstRepository = {
      releaseDenyFence: jest.fn(async () => ({
        released: true,
        entitlement: current,
      })),
      finalizeReleasedDenyFence: jest.fn(),
    };
    const firstService = new PlanEntitlementService(
      firstRepository as never,
      createRedis({ eval: jest.fn(async () => 0) }) as never
    );
    await expect(
      firstService.refreshAfterMutation(accountId, productId, ownerToken)
    ).rejects.toBeInstanceOf(PlanEntitlementUnavailableError);
    expect(firstRepository.finalizeReleasedDenyFence).not.toHaveBeenCalled();

    const repairRepository = {
      resolveEntitlementWithFenceState: jest.fn(async () => ({
        entitlement: current,
        expiredFenceOwnerToken: ownerToken,
      })),
      finalizeReleasedDenyFence: jest.fn(async () => undefined),
    };
    const repairRedis = createRedis({ eval: jest.fn(async () => 2) });
    const repairService = new PlanEntitlementService(
      repairRepository as never,
      repairRedis as never
    );
    await expect(
      repairService.getEntitlement(accountId, productId, { bypassCache: true })
    ).resolves.toEqual(current);
    expect(repairRepository.finalizeReleasedDenyFence).toHaveBeenCalledWith(
      accountId,
      productId,
      ownerToken
    );
    expect(String(repairRedis.eval.mock.calls[0]?.[0])).toContain('return 2');
  });

  it('does not return a stale grant when release repair loses to a newer fence', async () => {
    const ownerToken = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const repository = {
      resolveEntitlementWithFenceState: jest.fn(async () => ({
        entitlement: entitlement(),
        expiredFenceOwnerToken: ownerToken,
      })),
      finalizeReleasedDenyFence: jest.fn(async () => undefined),
    };
    const service = new PlanEntitlementService(
      repository as never,
      createRedis({ eval: jest.fn(async () => 0) }) as never
    );

    await expect(
      service.getEntitlement(accountId, productId, { bypassCache: true })
    ).rejects.toBeInstanceOf(PlanEntitlementUnavailableError);
    expect(repository.finalizeReleasedDenyFence).not.toHaveBeenCalled();
  });

  it('reconciles account fan-out set-based and writes one Redis pipeline', async () => {
    const secondAccountId = '44444444-4444-4444-8444-444444444444';
    const ownerToken = '55555555-5555-4555-8555-555555555555';
    const first = entitlement({ revision: '10' });
    const second = entitlement({
      accountId: secondAccountId,
      revision: '11',
      source: 'addon',
    });
    const repository = {
      reconcileEntitlements: jest.fn(async () => [
        {
          entitlement: first,
          releasedFenceOwnerToken: ownerToken,
          expiredFenceOwnerToken: null,
        },
        {
          entitlement: second,
          releasedFenceOwnerToken: null,
          expiredFenceOwnerToken: null,
        },
      ]),
      resolveEntitlement: jest.fn(),
      finalizeReleasedDenyFences: jest.fn(async () => undefined),
    };
    const redis = createRedis();
    const service = new PlanEntitlementService(
      repository as never,
      redis as never
    );

    await expect(
      service.refreshAccounts(
        [accountId, secondAccountId, accountId],
        productId,
        [{ accountId, planProductId: productId, ownerToken }]
      )
    ).resolves.toEqual([first, second]);

    expect(repository.reconcileEntitlements).toHaveBeenCalledTimes(1);
    expect(repository.reconcileEntitlements).toHaveBeenCalledWith([
      { accountId, planProductId: productId, ownerToken },
      {
        accountId: secondAccountId,
        planProductId: productId,
        ownerToken: undefined,
      },
    ]);
    expect(repository.resolveEntitlement).not.toHaveBeenCalled();
    expect(redis.multi).toHaveBeenCalledTimes(1);
    expect(redis.pipelineInstance.eval).toHaveBeenCalledTimes(2);
    expect(redis.pipelineInstance.exec).toHaveBeenCalledTimes(1);
  });

  it('records successful and failed fence installation and release', async () => {
    const current = entitlement();
    const installService = new PlanEntitlementService(
      { resolveEntitlement: jest.fn(async () => current) } as never,
      createRedis() as never
    );
    await installService.installDenyFence(accountId, productId);

    const failedInstallService = new PlanEntitlementService(
      { resolveEntitlement: jest.fn(async () => current) } as never,
      createRedis({ status: 'end' }) as never
    );
    await expect(
      failedInstallService.installDenyFence(accountId, productId)
    ).rejects.toBeInstanceOf(PlanEntitlementUnavailableError);

    const released = { released: true, entitlement: current };
    const releaseService = new PlanEntitlementService(
      {
        releaseDenyFence: jest.fn(async () => released),
        finalizeReleasedDenyFence: jest.fn(async () => undefined),
      } as never,
      createRedis() as never
    );
    await releaseService.refreshAfterMutation(
      accountId,
      productId,
      '44444444-4444-4444-8444-444444444444'
    );

    const failedReleaseService = new PlanEntitlementService(
      {
        releaseDenyFence: jest.fn(async () => released),
        finalizeReleasedDenyFence: jest.fn(async () => undefined),
      } as never,
      createRedis({ eval: jest.fn(async () => 0) }) as never
    );
    await expect(
      failedReleaseService.refreshAfterMutation(
        accountId,
        productId,
        '55555555-5555-4555-8555-555555555555'
      )
    ).rejects.toBeInstanceOf(PlanEntitlementUnavailableError);

    expect(planEntitlementTelemetryStore.snapshot().fences).toEqual({
      install: { success: 1, error: 1 },
      release: { success: 1, error: 1 },
    });
  });

  it('heartbeats the durable and Redis leases throughout a long mutation', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-11T12:00:00.000Z'));
    const denied = entitlement({ allowed: false, source: null });
    const repository = {
      installDenyFences: jest.fn(
        async (targets: Array<{ ownerToken: string }>) => [
          {
            ownerToken: targets[0]?.ownerToken,
            entitlement: denied,
          },
        ]
      ),
      heartbeatDenyFences: jest.fn(async (targets) => targets),
      releaseDenyFence: jest.fn(async () => ({
        released: true,
        entitlement: entitlement(),
      })),
      finalizeReleasedDenyFence: jest.fn(async () => undefined),
    };
    const service = new PlanEntitlementService(
      repository as never,
      createRedis() as never
    );
    const ownerToken = await service.installDenyFence(accountId, productId);
    const installedOwnerToken = String(ownerToken);

    await jest.advanceTimersByTimeAsync(301_000);
    expect(
      repository.heartbeatDenyFences.mock.calls.length
    ).toBeGreaterThanOrEqual(10);

    await expect(
      service.refreshAfterMutation(accountId, productId, installedOwnerToken)
    ).resolves.toEqual(entitlement());
    expect(repository.releaseDenyFence).toHaveBeenCalledTimes(1);
  });

  it('keeps a real repository fence active beyond 300s through service heartbeats', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-11T12:00:00.000Z'));
    const dialect = new PgDialect();
    let durableOwnerToken = '';
    let lastHeartbeatAt = Date.now();
    const execute = jest.fn(async (query: SQL) => {
      const compiled = dialect.sqlToQuery(query);
      const source = compiled.sql;
      const serializedTargets = compiled.params.find(
        (value): value is string =>
          typeof value === 'string' && value.startsWith('[')
      );
      if (source.includes('requested_owner_token')) {
        if (!serializedTargets) throw new Error('serialized targets missing');
        const target = JSON.parse(serializedTargets)[0];
        durableOwnerToken = target.owner_token;
        lastHeartbeatAt = Date.now();
        return {
          rows: [
            {
              account_id: accountId,
              plan_product_id: productId,
              allowed: false,
              revision: 3n,
              valid_until: new Date('2099-01-01T00:00:00.000Z'),
              plan_is_active: true,
              source: null,
              deny_fence_token: durableOwnerToken,
              requested_owner_token: durableOwnerToken,
              underlying_allowed: true,
            },
          ],
        };
      }
      if (source.includes('SET deny_fence_created_at = clock_timestamp()')) {
        if (!serializedTargets) throw new Error('serialized targets missing');
        const target = JSON.parse(serializedTargets)[0];
        if (target.owner_token === durableOwnerToken) {
          lastHeartbeatAt = Date.now();
          return {
            rows: [
              {
                account_id: accountId,
                plan_product_id: productId,
                owner_token: durableOwnerToken,
              },
            ],
          };
        }
      }
      if (source.includes('heartbeat_stale')) {
        return {
          rows: [
            {
              owner_token: durableOwnerToken,
              release_pending: false,
              heartbeat_stale: Date.now() - lastHeartbeatAt > 300_000,
            },
          ],
        };
      }
      if (source.includes('entitlement_state AS')) {
        return {
          rows: [
            {
              account_id: accountId,
              plan_product_id: productId,
              allowed: false,
              revision: 3n,
              valid_until: new Date('2099-01-01T00:00:00.000Z'),
              plan_is_active: true,
              source: null,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const database = {
      execute,
      transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
        callback({ execute })
      ),
    };
    const realRepository = new PlanEntitlementRepository(database as never);
    const firstInstance = new PlanEntitlementService(
      realRepository,
      createRedis() as never
    );
    await firstInstance.installDenyFence(accountId, productId);

    await jest.advanceTimersByTimeAsync(301_000);
    expect(Date.now() - lastHeartbeatAt).toBeLessThan(
      PLAN_ENTITLEMENT_DENY_FENCE_HEARTBEAT_INTERVAL_MS * 2
    );

    const release = jest.spyOn(realRepository, 'releaseStaleDenyFence');
    const secondInstance = new PlanEntitlementService(
      realRepository,
      createRedis() as never
    );
    await expect(
      secondInstance.getEntitlement(accountId, productId, {
        bypassCache: true,
      })
    ).resolves.toEqual(entitlement({ allowed: false, source: null }));
    expect(release).not.toHaveBeenCalled();
  });

  it('keeps the fence active and returns 503 after a heartbeat failure', async () => {
    jest.useFakeTimers();
    const denied = entitlement({ allowed: false, source: null });
    const repository = {
      installDenyFences: jest.fn(
        async (targets: Array<{ ownerToken: string }>) => [
          {
            ownerToken: targets[0]?.ownerToken,
            entitlement: denied,
          },
        ]
      ),
      heartbeatDenyFences: jest.fn(async () => {
        throw new Error('primary heartbeat unavailable');
      }),
      releaseDenyFence: jest.fn(),
    };
    const service = new PlanEntitlementService(
      repository as never,
      createRedis() as never
    );
    const ownerToken = await service.installDenyFence(accountId, productId);
    const installedOwnerToken = String(ownerToken);

    await jest.advanceTimersByTimeAsync(
      PLAN_ENTITLEMENT_DENY_FENCE_HEARTBEAT_INTERVAL_MS
    );
    await expect(
      service.refreshAfterMutation(accountId, productId, installedOwnerToken)
    ).rejects.toBeInstanceOf(PlanEntitlementUnavailableError);
    expect(repository.releaseDenyFence).not.toHaveBeenCalled();
    expect(planEntitlementTelemetryStore.snapshot().fences.release.error).toBe(
      1
    );
  });

  it('stops an old process heartbeat after PostgreSQL owner CAS is lost', async () => {
    jest.useFakeTimers();
    const denied = entitlement({ allowed: false, source: null });
    const repository = {
      installDenyFences: jest.fn(
        async (targets: Array<{ ownerToken: string }>) => [
          {
            ownerToken: targets[0]?.ownerToken,
            entitlement: denied,
          },
        ]
      ),
      heartbeatDenyFences: jest.fn(async () => []),
      releaseDenyFence: jest.fn(),
    };
    const service = new PlanEntitlementService(
      repository as never,
      createRedis() as never
    );
    const ownerToken = await service.installDenyFence(accountId, productId);
    const installedOwnerToken = String(ownerToken);

    await jest.advanceTimersByTimeAsync(
      PLAN_ENTITLEMENT_DENY_FENCE_HEARTBEAT_INTERVAL_MS * 3
    );
    expect(repository.heartbeatDenyFences).toHaveBeenCalledTimes(1);
    await expect(
      service.refreshAfterMutation(accountId, productId, installedOwnerToken)
    ).rejects.toBeInstanceOf(PlanEntitlementUnavailableError);
    expect(repository.releaseDenyFence).not.toHaveBeenCalled();
  });

  it('another instance remains fail-closed for a stale PG heartbeat while Redis is unavailable', async () => {
    const ownerToken = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const denied = entitlement({ allowed: false, source: null });
    const repository = {
      resolveEntitlementWithFenceState: jest.fn(async () => ({
        entitlement: denied,
        expiredFenceOwnerToken: null,
        staleFenceOwnerToken: ownerToken,
      })),
      releaseStaleDenyFence: jest.fn(),
    };
    const redis = createRedis({ status: 'reconnecting' });
    const secondInstance = new PlanEntitlementService(
      repository as never,
      redis as never
    );

    await expect(
      secondInstance.getEntitlement(accountId, productId, {
        bypassCache: true,
      })
    ).resolves.toEqual(denied);
    expect(repository.releaseStaleDenyFence).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('recovers a stale orphan only on a second claim after the grace period', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-11T12:00:00.000Z'));
    const ownerToken = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const denied = entitlement({ allowed: false, source: null });
    const allowed = entitlement();
    const repository = {
      resolveEntitlementWithFenceState: jest.fn(async () => ({
        entitlement: denied,
        expiredFenceOwnerToken: null,
        staleFenceOwnerToken: ownerToken,
      })),
      releaseStaleDenyFence: jest.fn(async () => ({
        released: true,
        entitlement: allowed,
      })),
      finalizeReleasedDenyFence: jest.fn(async () => undefined),
    };
    const evalCommand = jest
      .fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    const service = new PlanEntitlementService(
      repository as never,
      createRedis({ eval: evalCommand }) as never
    );

    await expect(
      service.getEntitlement(accountId, productId, { bypassCache: true })
    ).resolves.toEqual(denied);
    expect(repository.releaseStaleDenyFence).not.toHaveBeenCalled();
    expect(String(evalCommand.mock.calls[0]?.[0])).toContain(
      'epoch.recovery_token = ARGV[2]'
    );
    expect(String(evalCommand.mock.calls[0]?.[0])).toContain(
      'fence.recovery_token = ARGV[2]'
    );

    jest.advanceTimersByTime(
      PLAN_ENTITLEMENT_DENY_FENCE_RECOVERY_GRACE_SECONDS * 1_000
    );
    await expect(
      service.getEntitlement(accountId, productId, { bypassCache: true })
    ).resolves.toEqual(allowed);
    expect(repository.releaseStaleDenyFence).toHaveBeenCalledWith(
      accountId,
      productId,
      ownerToken
    );
    expect(repository.finalizeReleasedDenyFence).toHaveBeenCalledWith(
      accountId,
      productId,
      ownerToken
    );
  });

  it('lets a resumed owner heartbeat cancel a stale recovery claim during grace', async () => {
    jest.useFakeTimers();
    let ownerToken = '';
    const denied = entitlement({ allowed: false, source: null });
    const repository = {
      installDenyFences: jest.fn(
        async (targets: Array<{ ownerToken: string }>) => {
          const target = targets[0];
          if (!target) throw new Error('fence target missing');
          ownerToken = target.ownerToken;
          return [{ ownerToken, entitlement: denied }];
        }
      ),
      heartbeatDenyFences: jest.fn(
        async (targets: Array<{ ownerToken: string }>) => targets
      ),
      resolveEntitlementWithFenceState: jest.fn(async () => ({
        entitlement: denied,
        expiredFenceOwnerToken: null,
        staleFenceOwnerToken: ownerToken,
      })),
      releaseStaleDenyFence: jest.fn(),
    };
    const ownerRedis = createRedis();
    const ownerService = new PlanEntitlementService(
      repository as never,
      ownerRedis as never
    );
    await ownerService.installDenyFence(accountId, productId);

    const recoveryEval = jest
      .fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    const recoveryService = new PlanEntitlementService(
      repository as never,
      createRedis({ eval: recoveryEval }) as never
    );
    await expect(
      recoveryService.getEntitlement(accountId, productId, {
        bypassCache: true,
      })
    ).resolves.toEqual(denied);

    await jest.advanceTimersByTimeAsync(
      PLAN_ENTITLEMENT_DENY_FENCE_HEARTBEAT_INTERVAL_MS
    );
    expect(repository.heartbeatDenyFences).toHaveBeenCalled();
    const heartbeatScript = ownerRedis.pipelineInstance.eval.mock.calls
      .map(([script]) => String(script))
      .find((script) => script.includes('fence.recovery_token'));
    expect(heartbeatScript).toContain(
      "redis.call('set', KEYS[1], epoch_raw, 'EX', ARGV[2])"
    );

    jest.advanceTimersByTime(
      PLAN_ENTITLEMENT_DENY_FENCE_RECOVERY_GRACE_SECONDS * 1_000
    );
    await expect(
      recoveryService.getEntitlement(accountId, productId, {
        bypassCache: true,
      })
    ).resolves.toEqual(denied);
    expect(repository.releaseStaleDenyFence).not.toHaveBeenCalled();
  });
});
