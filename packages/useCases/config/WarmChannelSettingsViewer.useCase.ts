import { injectable, inject } from 'tsyringe';
import { WorkerWarmPoolSettingsService } from '@core/services/workerWarmPoolSettings.service';
import { WarmChannelSettingsResponse } from '@core/schema/config/viewWarmChannelSettings/response.schema';

@injectable()
export class WarmChannelSettingsViewerUseCase {
  constructor(
    @inject(WorkerWarmPoolSettingsService)
    private readonly workerWarmPoolSettingsService: WorkerWarmPoolSettingsService
  ) {}

  async execute(): Promise<WarmChannelSettingsResponse> {
    const settings = await this.workerWarmPoolSettingsService.view();

    return {
      warmup_enabled: settings.warmup_enabled,
      target_ready_baileys: settings.target_ready_baileys,
      target_ready_wwebjs: settings.target_ready_wwebjs,
      target_ready_whatsmeow: settings.target_ready_whatsmeow,
      scan_interval_seconds: settings.scan_interval_seconds,
      reservation_ttl_seconds: settings.reservation_ttl_seconds,
      warming_stale_after_seconds: settings.warming_stale_after_seconds,
      created_at: settings.created_at ?? null,
      updated_at: settings.updated_at ?? null,
    };
  }
}
