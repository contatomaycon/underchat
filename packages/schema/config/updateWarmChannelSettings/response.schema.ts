import { Static, Type } from '@sinclair/typebox';

export const updateWarmChannelSettingsResponseSchema = Type.Object({
  warmup_enabled: Type.Boolean(),
  target_ready_baileys: Type.Number(),
  target_ready_wwebjs: Type.Number(),
  target_ready_whatsmeow: Type.Number(),
  scan_interval_seconds: Type.Number(),
  reservation_ttl_seconds: Type.Number(),
  warming_stale_after_seconds: Type.Number(),
  created_at: Type.Union([Type.String(), Type.Null()]),
  updated_at: Type.Union([Type.String(), Type.Null()]),
});

export type UpdateWarmChannelSettingsResponse = Static<
  typeof updateWarmChannelSettingsResponseSchema
>;
