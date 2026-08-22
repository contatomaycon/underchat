import 'reflect-metadata';
import fastify from 'fastify';
import Redis from 'ioredis';
import { container } from 'tsyringe';
import redisPlugin, {
  SHARED_REDIS_MAX_RETRIES_PER_REQUEST,
} from '@core/plugins/redis';
import {
  PLAN_ENTITLEMENT_REDIS_COMMAND_TIMEOUT_MS,
  PLAN_ENTITLEMENT_REDIS_MAX_RETRIES_PER_REQUEST,
  PLAN_ENTITLEMENT_REDIS_TOKEN,
} from '@core/common/constants/planEntitlement';
import { criticalRedisOperationTimeoutMs } from '@core/common/functions/criticalRedisOperation';

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const createRedisClient = () => ({
  status: 'wait',
  on: jest.fn().mockReturnThis(),
  connect: jest.fn(async () => undefined),
  quit: jest.fn(async () => 'OK'),
  duplicate: jest.fn(),
});

describe('Redis Fastify plugin', () => {
  beforeEach(() => {
    container.reset();
    jest.clearAllMocks();
  });

  afterEach(() => {
    container.reset();
  });

  it('bounds shared Redis commands and keeps entitlement limits isolated', async () => {
    const sharedClient = createRedisClient();
    const planEntitlementClient = createRedisClient();
    sharedClient.duplicate.mockReturnValue(planEntitlementClient);
    const RedisConstructor = Redis as unknown as jest.Mock;
    RedisConstructor.mockImplementation(() => sharedClient);
    const app = fastify();

    await app.register(redisPlugin);
    await app.ready();

    expect(RedisConstructor).toHaveBeenCalledTimes(1);
    expect(RedisConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        commandTimeout: criticalRedisOperationTimeoutMs(),
        maxRetriesPerRequest: SHARED_REDIS_MAX_RETRIES_PER_REQUEST,
      })
    );
    expect(sharedClient.duplicate).toHaveBeenCalledWith({
      commandTimeout: PLAN_ENTITLEMENT_REDIS_COMMAND_TIMEOUT_MS,
      maxRetriesPerRequest: PLAN_ENTITLEMENT_REDIS_MAX_RETRIES_PER_REQUEST,
      lazyConnect: true,
    });
    expect(container.resolve<Redis>('Redis')).toBe(sharedClient);
    expect(container.resolve<Redis>(PLAN_ENTITLEMENT_REDIS_TOKEN)).toBe(
      planEntitlementClient
    );
    expect(sharedClient.connect).toHaveBeenCalledTimes(1);
    expect(planEntitlementClient.connect).toHaveBeenCalledTimes(1);

    await app.close();

    expect(sharedClient.quit).toHaveBeenCalledTimes(1);
    expect(planEntitlementClient.quit).toHaveBeenCalledTimes(1);
  });
});
