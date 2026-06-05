import { injectable, inject } from 'tsyringe';
import { WorkerWarmPoolSettingsService } from '@core/services/workerWarmPoolSettings.service';
import { UpdateWarmChannelSettingsRequest } from '@core/schema/config/updateWarmChannelSettings/request.schema';
import { UpdateWarmChannelSettingsResponse } from '@core/schema/config/updateWarmChannelSettings/response.schema';

@injectable()
export class WarmChannelSettingsUpdaterUseCase {
  constructor(
    @inject(WorkerWarmPoolSettingsService)
    private readonly workerWarmPoolSettingsService: WorkerWarmPoolSettingsService
  ) {}

  async execute(
    input: UpdateWarmChannelSettingsRequest
  ): Promise<UpdateWarmChannelSettingsResponse> {
    const settings = await this.workerWarmPoolSettingsService.update(input);

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
