import { Static, Type } from '@sinclair/typebox';

const targetReadySchema = Type.Number({ minimum: 0, maximum: 100 });
const scanIntervalSchema = Type.Number({ minimum: 5, maximum: 3600 });
const reservationTtlSchema = Type.Number({ minimum: 10, maximum: 3600 });
const warmingStaleSchema = Type.Number({ minimum: 30, maximum: 3600 });

export const updateWarmChannelSettingsRequestSchema = Type.Object({
  warmup_enabled: Type.Boolean(),
  target_ready_baileys: targetReadySchema,
  target_ready_wwebjs: targetReadySchema,
  target_ready_whatsmeow: targetReadySchema,
  scan_interval_seconds: scanIntervalSchema,
  reservation_ttl_seconds: reservationTtlSchema,
  warming_stale_after_seconds: warmingStaleSchema,
});

export type UpdateWarmChannelSettingsRequest = Static<
  typeof updateWarmChannelSettingsRequestSchema
>;
