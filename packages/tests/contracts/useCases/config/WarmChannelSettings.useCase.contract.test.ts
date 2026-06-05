import 'reflect-metadata';
import { WarmChannelSettingsUpdaterUseCase } from '@core/useCases/config/WarmChannelSettingsUpdater.useCase';
import { WarmChannelSettingsViewerUseCase } from '@core/useCases/config/WarmChannelSettingsViewer.useCase';

describe('Warm channel settings use cases', () => {
  it('views warm channel settings through the service', async () => {
    const settingsService = {
      view: jest.fn(async () => ({
        warmup_enabled: true,
        target_ready_baileys: 2,
        target_ready_wwebjs: 3,
        target_ready_whatsmeow: 4,
        scan_interval_seconds: 30,
        reservation_ttl_seconds: 90,
        warming_stale_after_seconds: 180,
        created_at: undefined,
        updated_at: '2026-06-05T12:00:00.000Z',
      })),
    };
    const useCase = new WarmChannelSettingsViewerUseCase(
      settingsService as never
    );

    await expect(useCase.execute()).resolves.toEqual({
      warmup_enabled: true,
      target_ready_baileys: 2,
      target_ready_wwebjs: 3,
      target_ready_whatsmeow: 4,
      scan_interval_seconds: 30,
      reservation_ttl_seconds: 90,
      warming_stale_after_seconds: 180,
      created_at: null,
      updated_at: '2026-06-05T12:00:00.000Z',
    });
  });

  it('updates warm channel settings through the service', async () => {
    const payload = {
      warmup_enabled: false,
      target_ready_baileys: 0,
      target_ready_wwebjs: 1,
      target_ready_whatsmeow: 2,
      scan_interval_seconds: 60,
      reservation_ttl_seconds: 120,
      warming_stale_after_seconds: 240,
    };
    const settingsService = {
      update: jest.fn(async () => ({
        ...payload,
        created_at: '2026-06-05T11:00:00.000Z',
        updated_at: undefined,
      })),
    };
    const useCase = new WarmChannelSettingsUpdaterUseCase(
      settingsService as never
    );

    await expect(useCase.execute(payload)).resolves.toEqual({
      ...payload,
      created_at: '2026-06-05T11:00:00.000Z',
      updated_at: null,
    });
    expect(settingsService.update).toHaveBeenCalledWith(payload);
  });
});
