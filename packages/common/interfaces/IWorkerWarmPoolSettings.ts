export interface IWorkerWarmPoolSettings {
  settings_id: string;
  warmup_enabled: boolean;
  target_ready_baileys: number;
  target_ready_wwebjs: number;
  target_ready_whatsmeow: number;
  scan_interval_seconds: number;
  reservation_ttl_seconds: number;
  warming_stale_after_seconds: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export type IWorkerWarmPoolSettingsInput = Omit<
  IWorkerWarmPoolSettings,
  'settings_id' | 'created_at' | 'updated_at'
>;
