import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import {
  WORKER_COMMAND_OPERATIONAL_BARRIER_POLICY,
  WORKER_COMMAND_OPERATIONAL_BARRIER_PERMITS_KEY,
  WORKER_COMMAND_OPERATIONAL_BARRIER_STATE_KEY,
  WorkerCommandOperationalBarrierError,
  WorkerCommandOperationalBarrierService,
} from '@core/services/workerCommandOperationalBarrier.service';

const redisUrl = process.env.TEST_REDIS_URL?.trim();
const integrationTest = redisUrl ? it : it.skip;

describe('WorkerCommandOperationalBarrierService Redis CAS', () => {
  integrationTest(
    'atomically pauses admission, exposes in-flight permits and resumes only with generation plus token',
    async () => {
      if (!redisUrl) throw new Error('TEST_REDIS_URL is required');
      const redis = new Redis(redisUrl, {
        keyPrefix: `barrier-itest:${randomUUID()}:`,
        lazyConnect: true,
        connectTimeout: 5_000,
        commandTimeout: 5_000,
        maxRetriesPerRequest: 1,
      });
      const barrier = new WorkerCommandOperationalBarrierService(redis);
      let permit: Awaited<ReturnType<typeof barrier.acquirePermit>> | null =
        null;
      try {
        await redis.connect();
        const initial = await barrier.getStatus();
        expect(initial).toMatchObject({
          schema_version: 1,
          state: 'active',
          generation: 1,
          active_permits: 0,
        });

        permit = await barrier.acquirePermit('integration_test');
        const paused = await barrier.pause({
          expectedGeneration: initial.generation,
          actor: 'redis-integration-test',
          reason: 'prove atomic cutover fence',
        });
        expect(paused.status).toMatchObject({
          state: 'paused',
          generation: 2,
          active_permits: 1,
        });
        expect(paused.resume_token).toMatch(/^[A-Za-z0-9_-]{40,}$/u);

        const stored = await redis.hgetall(
          WORKER_COMMAND_OPERATIONAL_BARRIER_STATE_KEY
        );
        expect(stored.resume_token_digest).toMatch(/^[a-f0-9]{64}$/u);
        expect(JSON.stringify(stored)).not.toContain(paused.resume_token);

        await expect(
          barrier.acquirePermit('blocked_job')
        ).rejects.toMatchObject({
          code: 'paused',
          retryable: true,
        });
        await expect(
          barrier.resume({
            generation: paused.status.generation,
            token: 'invalid-resume-token',
            actor: 'redis-integration-test',
          })
        ).rejects.toMatchObject({ code: 'conflict' });

        await barrier.releasePermit(permit);
        permit = null;
        await expect(barrier.getStatus()).resolves.toMatchObject({
          state: 'paused',
          active_permits: 0,
        });

        const active = await barrier.resume({
          generation: paused.status.generation,
          token: paused.resume_token,
          actor: 'redis-integration-test',
        });
        expect(active).toMatchObject({
          state: 'active',
          generation: 3,
          active_permits: 0,
        });
        await expect(
          barrier.pause({
            expectedGeneration: 1,
            actor: 'stale-operator',
            reason: 'must not overwrite newer generation',
          })
        ).rejects.toBeInstanceOf(WorkerCommandOperationalBarrierError);

        permit = await barrier.acquirePermit('after_resume');
        expect(permit.generation).toBe(active.generation);
      } finally {
        if (permit) await barrier.releasePermit(permit).catch(() => undefined);
        await redis
          .del(
            WORKER_COMMAND_OPERATIONAL_BARRIER_STATE_KEY,
            WORKER_COMMAND_OPERATIONAL_BARRIER_PERMITS_KEY
          )
          .catch(() => undefined);
        await redis.quit().catch(() => redis.disconnect());
      }
    }
  );

  it('fails closed without running the protected action when Redis is unavailable', async () => {
    const barrier = new WorkerCommandOperationalBarrierService({
      eval: jest.fn(async () => {
        throw new Error('redis unavailable');
      }),
    } as never);
    const action = jest.fn(async () => 'must-not-run');

    await expect(
      barrier.runWithPermit('unavailable_test', action)
    ).rejects.toThrow('redis unavailable');
    expect(action).not.toHaveBeenCalled();
  });

  it('aborts and fails closed on a lost renewal without releasing while the action is still settling', async () => {
    jest.useFakeTimers();
    let settleAction!: () => void;
    let observedSignal: AbortSignal | undefined;
    const actionSettled = new Promise<void>((resolve) => {
      settleAction = resolve;
    });
    const evalMock = jest
      .fn()
      .mockResolvedValueOnce(['acquired', '1', String(Date.now() + 30_000)])
      .mockResolvedValueOnce(0)
      .mockResolvedValue(1);
    const barrier = new WorkerCommandOperationalBarrierService({
      eval: evalMock,
    } as never);

    try {
      const running = barrier.runWithPermit('renewal_loss', async (signal) => {
        observedSignal = signal;
        await actionSettled;
        return 'must-not-succeed';
      });
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(
        WORKER_COMMAND_OPERATIONAL_BARRIER_POLICY.permitRefreshMs
      );

      expect(observedSignal?.aborted).toBe(true);
      expect(evalMock).toHaveBeenCalledTimes(2);

      await jest.advanceTimersByTimeAsync(
        WORKER_COMMAND_OPERATIONAL_BARRIER_POLICY.permitRefreshMs
      );
      expect(evalMock).toHaveBeenCalledTimes(3);

      settleAction();
      await expect(running).rejects.toThrow(
        'worker_command_operational_barrier_permit_lost'
      );
      expect(evalMock).toHaveBeenCalledTimes(4);
    } finally {
      jest.useRealTimers();
    }
  });

  integrationTest(
    'atomically restores drain evidence before reporting a lost permit renewal',
    async () => {
      if (!redisUrl) throw new Error('TEST_REDIS_URL is required');
      const redis = new Redis(redisUrl, {
        keyPrefix: `barrier-renew-itest:${randomUUID()}:`,
        lazyConnect: true,
        connectTimeout: 5_000,
        commandTimeout: 5_000,
        maxRetriesPerRequest: 1,
      });
      const barrier = new WorkerCommandOperationalBarrierService(redis);
      try {
        await redis.connect();
        const permit = await barrier.acquirePermit('renew_restore');
        await redis.zrem(
          WORKER_COMMAND_OPERATIONAL_BARRIER_PERMITS_KEY,
          permit.member
        );

        await expect(
          (
            barrier as unknown as {
              renewPermit(value: typeof permit): Promise<void>;
            }
          ).renewPermit(permit)
        ).rejects.toThrow('worker_command_operational_barrier_permit_lost');
        await expect(barrier.getStatus()).resolves.toMatchObject({
          active_permits: 1,
        });

        await barrier.releasePermit(permit);
      } finally {
        await redis
          .del(
            WORKER_COMMAND_OPERATIONAL_BARRIER_STATE_KEY,
            WORKER_COMMAND_OPERATIONAL_BARRIER_PERMITS_KEY
          )
          .catch(() => undefined);
        await redis.quit().catch(() => redis.disconnect());
      }
    }
  );
});
