import { EventEmitter } from 'node:events';

const { createRedisLeaderElection } =
  require('../../../../apps/manager_api/src/plugins/shared/redisLeaderElection') as {
    createRedisLeaderElection(options: Record<string, unknown>): {
      start(): void;
      stop(): Promise<void>;
      getStatus(): { role: string; healthy: boolean };
    };
  };

class FakeRedis extends EventEmitter {
  public status = 'connecting';
  public readonly set = jest.fn(async () => 'OK');
  public readonly get = jest.fn(async () => 'manager-1');
  public readonly expire = jest.fn(async () => 1);
  public readonly del = jest.fn(async () => 1);
}

describe('manager Redis leader election', () => {
  it('does not issue lock commands until the shared Redis client is ready', async () => {
    const redis = new FakeRedis();
    const onLeaderAcquire = jest.fn(async () => undefined);
    const election = createRedisLeaderElection({
      redis,
      logger: { info: jest.fn(), warn: jest.fn() },
      lockKey: 'leader:test',
      instanceId: 'manager-1',
      refreshIntervalMs: 60_000,
      onLeaderAcquire,
      onLeaderLose: jest.fn(async () => undefined),
    });

    election.start();
    await Promise.resolve();

    expect(election.getStatus()).toMatchObject({
      role: 'electing',
      healthy: true,
    });
    expect(redis.set).not.toHaveBeenCalled();

    redis.status = 'ready';
    redis.emit('ready');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(redis.set).toHaveBeenCalledWith(
      'leader:test',
      'manager-1',
      'EX',
      30,
      'NX'
    );
    expect(onLeaderAcquire).toHaveBeenCalledTimes(1);
    expect(election.getStatus()).toMatchObject({
      role: 'leader',
      healthy: true,
    });

    await election.stop();
    expect(redis.listenerCount('ready')).toBe(0);
  });

  it('stops cleanly before Redis is ready without issuing commands', async () => {
    const redis = new FakeRedis();
    const election = createRedisLeaderElection({
      redis,
      logger: { info: jest.fn(), warn: jest.fn() },
      lockKey: 'leader:test',
      instanceId: 'manager-1',
      onLeaderAcquire: jest.fn(async () => undefined),
      onLeaderLose: jest.fn(async () => undefined),
    });

    election.start();
    await election.stop();

    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
    expect(redis.listenerCount('ready')).toBe(0);
    expect(election.getStatus()).toMatchObject({
      role: 'stopped',
      healthy: true,
    });
  });
});
