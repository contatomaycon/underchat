import { injectable, inject } from 'tsyringe';
import Redis from 'ioredis';
import { BalanceWorkerStatusGrpcClientService } from './balanceWorkerStatusGrpcClient.service';
import { ITypingSimulationConfig } from '@core/common/interfaces/ITypingSimulationConfig';
import {
  TYPING_SIMULATION_CACHE_TTL_SECONDS,
  defaultTypingSimulationConfig,
  normalizeTypingSimulationConfig,
  parseTypingSimulationConfigCache,
  typingSimulationCacheKey,
} from '@core/common/functions/typingSimulationConfig';

@injectable()
export class TypingSimulationRuntimeService {
  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject(BalanceWorkerStatusGrpcClientService)
    private readonly balanceWorkerStatusGrpcClientService: BalanceWorkerStatusGrpcClientService
  ) {}

  async getConfig(
    workerId: string,
    accountId: string
  ): Promise<ITypingSimulationConfig> {
    const normalizedWorkerId = workerId.trim();
    const normalizedAccountId = accountId.trim();

    if (!normalizedWorkerId || !normalizedAccountId) {
      return defaultTypingSimulationConfig();
    }

    const cacheKey = typingSimulationCacheKey(normalizedWorkerId);
    const cached = await this.readCache(cacheKey).catch((error) => {
      console.error('[TypingSimulationRuntime] cache read failed', {
        workerId: normalizedWorkerId,
        error,
      });
      return null;
    });
    if (cached) {
      return cached;
    }

    try {
      const config = normalizeTypingSimulationConfig(
        await this.balanceWorkerStatusGrpcClientService.getTypingSimulationConfig(
          {
            worker_id: normalizedWorkerId,
            account_id: normalizedAccountId,
          }
        )
      );

      await this.writeCache(cacheKey, config).catch((error) => {
        console.error('[TypingSimulationRuntime] cache write failed', {
          workerId: normalizedWorkerId,
          error,
        });
      });

      return config;
    } catch (error) {
      console.error('[TypingSimulationRuntime] config fetch failed', {
        workerId: normalizedWorkerId,
        error,
      });

      return defaultTypingSimulationConfig();
    }
  }

  private async readCache(
    cacheKey: string
  ): Promise<ITypingSimulationConfig | null> {
    const raw = await this.redis.get(cacheKey);
    const parsed = parseTypingSimulationConfigCache(raw);

    if (raw && !parsed) {
      await this.redis.del(cacheKey);
    }

    return parsed;
  }

  private async writeCache(
    cacheKey: string,
    config: ITypingSimulationConfig
  ): Promise<void> {
    await this.redis.set(
      cacheKey,
      JSON.stringify(config),
      'EX',
      TYPING_SIMULATION_CACHE_TTL_SECONDS
    );
  }
}
