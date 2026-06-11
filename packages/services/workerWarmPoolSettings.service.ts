import Redis from 'ioredis';
import { inject, injectable } from 'tsyringe';
import { WorkerWarmPoolSettingsRepository } from '@core/repositories/worker/WorkerWarmPoolSettings.repository';
import {
  IWorkerWarmPoolSettings,
  IWorkerWarmPoolSettingsInput,
} from '@core/common/interfaces/IWorkerWarmPoolSettings';
import { workerPoolEnvironment } from '@core/config/environments';
import {
  isRedisConnectionClosed,
  safeRedisGet,
  safeRedisSet,
} from '@core/plugins/redis';

const SETTINGS_CACHE_KEY = 'worker:warm_pool:settings:v1';
const SCAN_GATE_CACHE_KEY = 'worker:warm_pool:scan:gate:v1';
const SETTINGS_CACHE_TTL_SECONDS = 60;

@injectable()
export class WorkerWarmPoolSettingsService {
  constructor(
    @inject(WorkerWarmPoolSettingsRepository)
    private readonly workerWarmPoolSettingsRepository: WorkerWarmPoolSettingsRepository,
    @inject('Redis') private readonly redis: Redis
  ) {}

  getDefaults(): IWorkerWarmPoolSettingsInput {
    const targetReady = workerPoolEnvironment.warmWorkerTargetReady;

    return {
      warmup_enabled: workerPoolEnvironment.warmWorkerPoolEnabled,
      target_ready_baileys: targetReady,
      target_ready_wwebjs: targetReady,
      target_ready_whatsmeow: targetReady,
      scan_interval_seconds:
        workerPoolEnvironment.warmWorkerScanIntervalSeconds,
      reservation_ttl_seconds: Math.max(
        10,
        Math.floor(workerPoolEnvironment.warmWorkerReservationTtlMs / 1000)
      ),
      warming_stale_after_seconds: 180,
    };
  }

  normalize(input: IWorkerWarmPoolSettingsInput): IWorkerWarmPoolSettingsInput {
    return {
      warmup_enabled: input.warmup_enabled,
      target_ready_baileys: this.clampInteger(
        input.target_ready_baileys,
        0,
        100
      ),
      target_ready_wwebjs: this.clampInteger(input.target_ready_wwebjs, 0, 100),
      target_ready_whatsmeow: this.clampInteger(
        input.target_ready_whatsmeow,
        0,
        100
      ),
      scan_interval_seconds: this.clampInteger(
        input.scan_interval_seconds,
        5,
        3600
      ),
      reservation_ttl_seconds: this.clampInteger(
        input.reservation_ttl_seconds,
        10,
        3600
      ),
      warming_stale_after_seconds: this.clampInteger(
        input.warming_stale_after_seconds,
        30,
        3600
      ),
    };
  }

  async view(): Promise<IWorkerWarmPoolSettings> {
    const cached = await this.getCachedSettings();
    if (cached) {
      return cached;
    }

    const settings =
      (await this.workerWarmPoolSettingsRepository.view()) ??
      (await this.workerWarmPoolSettingsRepository.createDefaults(
        this.getDefaults()
      ));

    await this.writeCache(settings);

    return settings;
  }

  async update(
    input: IWorkerWarmPoolSettingsInput
  ): Promise<IWorkerWarmPoolSettings> {
    const settings = await this.workerWarmPoolSettingsRepository.upsert(
      this.normalize(input)
    );

    await this.writeCache(settings);

    return settings;
  }

  async shouldRunScan(
    settings: Pick<IWorkerWarmPoolSettings, 'scan_interval_seconds'>
  ): Promise<boolean> {
    if (isRedisConnectionClosed(this.redis)) {
      return true;
    }

    try {
      const result = await this.redis.set(
        SCAN_GATE_CACHE_KEY,
        String(Date.now()),
        'PX',
        settings.scan_interval_seconds * 1000,
        'NX'
      );

      return result === 'OK';
    } catch {
      return true;
    }
  }

  private clampInteger(
    value: number,
    minimum: number,
    maximum: number
  ): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return minimum;
    }

    return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
  }

  private async getCachedSettings(): Promise<IWorkerWarmPoolSettings | null> {
    let cached: string | null = null;
    try {
      cached = await safeRedisGet(this.redis, SETTINGS_CACHE_KEY);
    } catch {
      return null;
    }

    if (!cached) {
      return null;
    }

    try {
      return JSON.parse(cached) as IWorkerWarmPoolSettings;
    } catch {
      await this.invalidateCache();
      return null;
    }
  }

  private async writeCache(settings: IWorkerWarmPoolSettings): Promise<void> {
    try {
      await safeRedisSet(
        this.redis,
        SETTINGS_CACHE_KEY,
        JSON.stringify(settings),
        'EX',
        SETTINGS_CACHE_TTL_SECONDS
      );
    } catch {}
  }

  private async invalidateCache(): Promise<void> {
    if (isRedisConnectionClosed(this.redis)) {
      return;
    }

    try {
      await this.redis.del(SETTINGS_CACHE_KEY);
    } catch {}
  }
}
