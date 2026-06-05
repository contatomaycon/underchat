import { EWorkerType } from '@core/common/enums/EWorkerType';
import { Static, Type } from '@sinclair/typebox';

const nullableStringSchema = Type.Optional(
  Type.Union([Type.String(), Type.Null()])
);

export const recreateWarmChannelsAllRequestSchema = Type.Object({
  server_id: nullableStringSchema,
  type: Type.Optional(
    Type.Union([Type.String({ enum: Object.values(EWorkerType) }), Type.Null()])
  ),
  warm_pool_id: nullableStringSchema,
  container_id: nullableStringSchema,
  container_name: nullableStringSchema,
  session_volume_name: nullableStringSchema,
  search: nullableStringSchema,
  created_at_from: nullableStringSchema,
  created_at_to: nullableStringSchema,
  updated_at_from: nullableStringSchema,
  updated_at_to: nullableStringSchema,
  last_health_at_from: nullableStringSchema,
  last_health_at_to: nullableStringSchema,
});

export type RecreateWarmChannelsAllRequest = Static<
  typeof recreateWarmChannelsAllRequestSchema
>;
