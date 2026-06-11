import 'reflect-metadata';
import { IWorkerWarmPoolSettings } from '@core/common/interfaces/IWorkerWarmPoolSettings';
import { WorkerWarmPoolSettingsService } from '@core/services/workerWarmPoolSettings.service';

jest.mock('@core/config/environments', () => ({
  workerPoolEnvironment: {
    warmWorkerPoolEnabled: true,
    warmWorkerTargetReady: 4,
    warmWorkerScanIntervalSeconds: 45,
    warmWorkerReservationTtlMs: 120_000,
  },
}));

function makeSettings(
  overrides: Partial<IWorkerWarmPoolSettings> = {}
): IWorkerWarmPoolSettings {
  return {
    settings_id: 'default',
    warmup_enabled: true,
    target_ready_baileys: 2,
    target_ready_wwebjs: 2,
    target_ready_whatsmeow: 2,
    scan_interval_seconds: 30,
    reservation_ttl_seconds: 90,
    warming_stale_after_seconds: 180,
    created_at: '2026-06-05T11:00:00.000Z',
    updated_at: '2026-06-05T12:00:00.000Z',
    ...overrides,
  };
}

function buildService(
  overrides: {
    cached?: string | null;
    settings?: IWorkerWarmPoolSettings | null;
    redisStatus?: string;
    redisGetError?: Error;
    redisSetResult?: string | null;
  } = {}
) {
  const repository = {
    view: jest.fn(async () =>
      Object.prototype.hasOwnProperty.call(overrides, 'settings')
        ? overrides.settings
        : makeSettings()
    ),
    createDefaults: jest.fn(async () => makeSettings()),
    upsert: jest.fn(async (input) => makeSettings(input)),
  };
  const redis = {
    status: overrides.redisStatus ?? 'ready',
    get: jest.fn(async () => {
      if (overrides.redisGetError) {
        throw overrides.redisGetError;
      }
      return overrides.cached ?? null;
    }),
    set: jest.fn(async () => overrides.redisSetResult ?? 'OK'),
    del: jest.fn(async () => 1),
  };
  const service = new WorkerWarmPoolSettingsService(
    repository as never,
    redis as never
  );

  return {
    redis,
    repository,
    service,
  };
}

describe('WorkerWarmPoolSettingsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reads settings from Redis without hitting the repository', async () => {
    const cachedSettings = makeSettings({
      warmup_enabled: false,
      target_ready_baileys: 0,
    });
    const { repository, redis, service } = buildService({
      cached: JSON.stringify(cachedSettings),
    });

    await expect(service.view()).resolves.toEqual(cachedSettings);
    expect(redis.get).toHaveBeenCalledWith('worker:warm_pool:settings:v1');
    expect(repository.view).not.toHaveBeenCalled();
    expect(repository.createDefaults).not.toHaveBeenCalled();
  });

  it('creates defaults from env fallback when no settings row exists', async () => {
    const { repository, redis, service } = buildService({
      settings: null,
    });

    await expect(service.view()).resolves.toEqual(makeSettings());
    expect(repository.view).toHaveBeenCalledTimes(1);
    expect(repository.createDefaults).toHaveBeenCalledWith({
      warmup_enabled: true,
      target_ready_baileys: 4,
      target_ready_wwebjs: 4,
      target_ready_whatsmeow: 4,
      scan_interval_seconds: 45,
      reservation_ttl_seconds: 120,
      warming_stale_after_seconds: 180,
    });
    expect(redis.set).toHaveBeenCalledWith(
      'worker:warm_pool:settings:v1',
      JSON.stringify(makeSettings()),
      'EX',
      60
    );
  });

  it('clamps update values and rewrites cache', async () => {
    const { repository, redis, service } = buildService();

    await expect(
      service.update({
        warmup_enabled: false,
        target_ready_baileys: 999,
        target_ready_wwebjs: -1,
        target_ready_whatsmeow: 4.9,
        scan_interval_seconds: 2,
        reservation_ttl_seconds: 1,
        warming_stale_after_seconds: 9999,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        warmup_enabled: false,
        target_ready_baileys: 100,
        target_ready_wwebjs: 0,
        target_ready_whatsmeow: 4,
        scan_interval_seconds: 5,
        reservation_ttl_seconds: 10,
        warming_stale_after_seconds: 3600,
      })
    );

    expect(repository.upsert).toHaveBeenCalledWith({
      warmup_enabled: false,
      target_ready_baileys: 100,
      target_ready_wwebjs: 0,
      target_ready_whatsmeow: 4,
      scan_interval_seconds: 5,
      reservation_ttl_seconds: 10,
      warming_stale_after_seconds: 3600,
    });
    expect(redis.set).toHaveBeenCalledWith(
      'worker:warm_pool:settings:v1',
      expect.any(String),
      'EX',
      60
    );
  });

  it('falls back to the repository when Redis read fails', async () => {
    const settings = makeSettings({
      target_ready_wwebjs: 5,
    });
    const { repository, service } = buildService({
      redisGetError: new Error('redis down'),
      settings,
    });

    await expect(service.view()).resolves.toEqual(settings);
    expect(repository.view).toHaveBeenCalledTimes(1);
  });

  it('uses Redis NX gate to respect scan interval', async () => {
    const { redis, service } = buildService();

    (redis.set as jest.Mock)
      .mockResolvedValueOnce('OK')
      .mockResolvedValueOnce(null);

    await expect(
      service.shouldRunScan({ scan_interval_seconds: 30 })
    ).resolves.toBe(true);
    await expect(
      service.shouldRunScan({ scan_interval_seconds: 30 })
    ).resolves.toBe(false);
    expect(redis.set).toHaveBeenCalledWith(
      'worker:warm_pool:scan:gate:v1',
      expect.any(String),
      'PX',
      30000,
      'NX'
    );
  });
});
