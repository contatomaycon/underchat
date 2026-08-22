import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import {
  createLockLeaseGuard,
  LockLeaseLostError,
  withLock,
} from '@core/common/functions/withLock';

class FakeRedisLease extends EventEmitter {
  status = 'ready';
  owner: string | null = 'owner';
  set = jest.fn(async (_key: string, token: string) => {
    this.owner = token;
    return 'OK';
  });
  get = jest.fn(async () => null);
  eval = jest.fn(
    async (script: string, _keyCount: number, _key: string, token: string) => {
      if (script.includes('pexpire')) {
        return this.owner === token ? 1 : 0;
      }
      if (script.includes('del') && this.owner === token) {
        this.owner = null;
        return 1;
      }
      return 0;
    }
  );
}

describe('distributed lock lease fence', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('aborts immediately when Redis reports that the owner token was lost', async () => {
    jest.useFakeTimers();
    const redis = new FakeRedisLease();
    const guard = createLockLeaseGuard(
      redis as never,
      'lock:key',
      'test lease',
      'owner',
      100,
      { renewIntervalMs: 10 }
    );

    redis.owner = 'new-owner';
    await jest.advanceTimersByTimeAsync(10);

    expect(guard.context.signal.aborted).toBe(true);
    expect(() => guard.assertActive()).toThrow(LockLeaseLostError);
    await guard.stop();
  });

  it('expires the confirmed lease when Redis remains unavailable through the TTL', async () => {
    jest.useFakeTimers();
    const redis = new FakeRedisLease();
    const guard = createLockLeaseGuard(
      redis as never,
      'lock:key',
      'test lease',
      'owner',
      30,
      { renewIntervalMs: 5 }
    );

    redis.status = 'end';
    await jest.advanceTimersByTimeAsync(31);

    expect(guard.context.signal.aborted).toBe(true);
    expect(() => guard.context.assertActive()).toThrow(LockLeaseLostError);
    expect(redis.eval).not.toHaveBeenCalled();
    await guard.stop();
  });

  it('does not return callback success after ownership is lost', async () => {
    jest.useFakeTimers();
    const redis = new FakeRedisLease();

    const result = withLock(
      redis as never,
      'callback-loss',
      async () => {
        redis.owner = 'new-owner';
        await jest.advanceTimersByTimeAsync(10);
        return 'should-not-escape';
      },
      {
        ttlMs: 20,
      }
    );

    await expect(result).rejects.toBeInstanceOf(LockLeaseLostError);
  });

  it('aborts sibling work before releasing the lock after callback failure', async () => {
    const redis = new FakeRedisLease();
    const callbackError = new Error('branch failed');
    let siblingObservedAbort = false;
    let ownerWhenSiblingAborted: string | null = null;

    await expect(
      withLock(redis as never, 'parallel-failure', async (context) => {
        await Promise.all([
          Promise.reject(callbackError),
          new Promise<void>((resolve) => {
            context.signal.addEventListener(
              'abort',
              () => {
                siblingObservedAbort = true;
                ownerWhenSiblingAborted = redis.owner;
                resolve();
              },
              { once: true }
            );
          }),
        ]);
      })
    ).rejects.toBe(callbackError);

    expect(siblingObservedAbort).toBe(true);
    expect(ownerWhenSiblingAborted).not.toBeNull();
    expect(redis.owner).toBeNull();
  });
});
