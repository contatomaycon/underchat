import 'reflect-metadata';

jest.mock('@core/services/balanceWorkerStatusGrpcClient.service', () => ({
  BalanceWorkerStatusGrpcClientService: class BalanceWorkerStatusGrpcClientService {},
}));

import {
  TYPING_SIMULATION_CACHE_TTL_SECONDS,
  defaultTypingSimulationConfig,
  typingSimulationCacheKey,
} from '@core/common/functions/typingSimulationConfig';
import { TypingSimulationRuntimeService } from '@core/services/typingSimulationRuntime.service';

describe('TypingSimulationRuntimeService', () => {
  const makeService = () => {
    const redis = {
      get: jest.fn<Promise<string | null>, [string]>(async () => null),
      set: jest.fn<Promise<'OK'>, [string, string, string, number]>(
        async () => 'OK'
      ),
      del: jest.fn<Promise<number>, [string]>(async () => 1),
    };
    const balanceWorkerStatusGrpcClientService = {
      getTypingSimulationConfig: jest.fn(async () => ({
        enabled: true,
        speed: 50,
      })),
    };

    const service = new TypingSimulationRuntimeService(
      redis as never,
      balanceWorkerStatusGrpcClientService as never
    );

    return {
      balanceWorkerStatusGrpcClientService,
      redis,
      service,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns valid redis cache without calling balance gRPC', async () => {
    const { balanceWorkerStatusGrpcClientService, redis, service } =
      makeService();
    const cacheKey = typingSimulationCacheKey('worker-1');
    redis.get.mockResolvedValueOnce(
      JSON.stringify({ enabled: false, speed: 0 })
    );

    await expect(service.getConfig('worker-1', 'account-1')).resolves.toEqual({
      enabled: false,
      speed: 0,
    });

    expect(redis.get).toHaveBeenCalledWith(cacheKey);
    expect(
      balanceWorkerStatusGrpcClientService.getTypingSimulationConfig
    ).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('fetches from balance gRPC on cache miss and writes redis for seven days', async () => {
    const { balanceWorkerStatusGrpcClientService, redis, service } =
      makeService();
    const cacheKey = typingSimulationCacheKey('worker-1');
    balanceWorkerStatusGrpcClientService.getTypingSimulationConfig.mockResolvedValueOnce(
      { enabled: true, speed: 75 }
    );

    await expect(service.getConfig('worker-1', 'account-1')).resolves.toEqual({
      enabled: true,
      speed: 75,
    });

    expect(
      balanceWorkerStatusGrpcClientService.getTypingSimulationConfig
    ).toHaveBeenCalledWith({
      worker_id: 'worker-1',
      account_id: 'account-1',
    });
    expect(redis.set).toHaveBeenCalledWith(
      cacheKey,
      JSON.stringify({ enabled: true, speed: 75 }),
      'EX',
      TYPING_SIMULATION_CACHE_TTL_SECONDS
    );
  });

  it('deletes invalid redis payload and refreshes from balance gRPC', async () => {
    const { redis, service } = makeService();
    const cacheKey = typingSimulationCacheKey('worker-1');
    redis.get.mockResolvedValueOnce(
      JSON.stringify({ enabled: true, speed: 150 })
    );

    await expect(service.getConfig('worker-1', 'account-1')).resolves.toEqual({
      enabled: true,
      speed: 50,
    });

    expect(redis.del).toHaveBeenCalledWith(cacheKey);
    expect(redis.set).toHaveBeenCalledWith(
      cacheKey,
      JSON.stringify({ enabled: true, speed: 50 }),
      'EX',
      TYPING_SIMULATION_CACHE_TTL_SECONDS
    );
  });

  it('uses default config when balance gRPC fails', async () => {
    const { balanceWorkerStatusGrpcClientService, redis, service } =
      makeService();
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    balanceWorkerStatusGrpcClientService.getTypingSimulationConfig.mockRejectedValueOnce(
      new Error('grpc unavailable')
    );

    await expect(service.getConfig('worker-1', 'account-1')).resolves.toEqual(
      defaultTypingSimulationConfig()
    );

    expect(redis.set).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
