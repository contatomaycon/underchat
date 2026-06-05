import 'reflect-metadata';
import {
  WORKER_WARM_POOL_SETTINGS_ID,
  WorkerWarmPoolSettingsRepository,
} from '@core/repositories/worker/WorkerWarmPoolSettings.repository';
import { IWorkerWarmPoolSettings } from '@core/common/interfaces/IWorkerWarmPoolSettings';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(() => '2026-06-05T12:00:00.000Z'),
}));

function makeSettings(
  overrides: Partial<IWorkerWarmPoolSettings> = {}
): IWorkerWarmPoolSettings {
  return {
    settings_id: WORKER_WARM_POOL_SETTINGS_ID,
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

function createViewChain(result: unknown[]) {
  const queryBuilder = {
    where: jest.fn(),
    limit: jest.fn(),
    execute: jest.fn(async () => result),
  } as any;
  queryBuilder.where.mockReturnValue(queryBuilder);
  queryBuilder.limit.mockReturnValue(queryBuilder);

  const from = jest.fn(() => queryBuilder);
  const select = jest.fn(() => ({ from }));

  return { queryBuilder, select };
}

function createInsertChain(result: unknown[]) {
  const queryBuilder = {
    values: jest.fn(),
    onConflictDoNothing: jest.fn(),
    onConflictDoUpdate: jest.fn(),
    returning: jest.fn(),
    execute: jest.fn(async () => result),
  } as any;
  queryBuilder.values.mockReturnValue(queryBuilder);
  queryBuilder.onConflictDoNothing.mockReturnValue(queryBuilder);
  queryBuilder.onConflictDoUpdate.mockReturnValue(queryBuilder);
  queryBuilder.returning.mockReturnValue(queryBuilder);

  const insert = jest.fn(() => queryBuilder);

  return { insert, queryBuilder };
}

describe('WorkerWarmPoolSettingsRepository', () => {
  it('views the singleton warm pool settings row', async () => {
    const settings = makeSettings();
    const chain = createViewChain([settings]);
    const repository = new WorkerWarmPoolSettingsRepository(
      {} as never,
      { select: chain.select } as never
    );

    await expect(repository.view()).resolves.toEqual(settings);
    expect(chain.queryBuilder.limit).toHaveBeenCalledWith(1);
  });

  it('creates default settings when there is no singleton row yet', async () => {
    const settings = makeSettings();
    const insertChain = createInsertChain([settings]);
    const repository = new WorkerWarmPoolSettingsRepository(
      { insert: insertChain.insert } as never,
      {} as never
    );

    await expect(
      repository.createDefaults({
        warmup_enabled: true,
        target_ready_baileys: 3,
        target_ready_wwebjs: 2,
        target_ready_whatsmeow: 1,
        scan_interval_seconds: 45,
        reservation_ttl_seconds: 120,
        warming_stale_after_seconds: 240,
      })
    ).resolves.toEqual(settings);
    expect(insertChain.queryBuilder.values).toHaveBeenCalledWith({
      settings_id: WORKER_WARM_POOL_SETTINGS_ID,
      warmup_enabled: true,
      target_ready_baileys: 3,
      target_ready_wwebjs: 2,
      target_ready_whatsmeow: 1,
      scan_interval_seconds: 45,
      reservation_ttl_seconds: 120,
      warming_stale_after_seconds: 240,
    });
    expect(insertChain.queryBuilder.onConflictDoNothing).toHaveBeenCalledTimes(
      1
    );
  });

  it('upserts the singleton row with one updated timestamp', async () => {
    const settings = makeSettings({
      warmup_enabled: false,
      target_ready_baileys: 0,
    });
    const insertChain = createInsertChain([settings]);
    const repository = new WorkerWarmPoolSettingsRepository(
      { insert: insertChain.insert } as never,
      {} as never
    );

    await expect(
      repository.upsert({
        warmup_enabled: false,
        target_ready_baileys: 0,
        target_ready_wwebjs: 1,
        target_ready_whatsmeow: 2,
        scan_interval_seconds: 60,
        reservation_ttl_seconds: 120,
        warming_stale_after_seconds: 300,
      })
    ).resolves.toEqual(settings);

    expect(insertChain.queryBuilder.values).toHaveBeenCalledWith({
      settings_id: WORKER_WARM_POOL_SETTINGS_ID,
      warmup_enabled: false,
      target_ready_baileys: 0,
      target_ready_wwebjs: 1,
      target_ready_whatsmeow: 2,
      scan_interval_seconds: 60,
      reservation_ttl_seconds: 120,
      warming_stale_after_seconds: 300,
      updated_at: '2026-06-05T12:00:00.000Z',
    });
    expect(insertChain.queryBuilder.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          warmup_enabled: false,
          target_ready_baileys: 0,
          updated_at: '2026-06-05T12:00:00.000Z',
        }),
      })
    );
  });
});
