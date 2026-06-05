import { EWorkerType } from '@core/common/enums/EWorkerType';
import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { sortRequestSchema } from '@core/schema/common/sortRequestSchema';
import { Static, Type } from '@sinclair/typebox';

const nullableStringSchema = Type.Optional(
  Type.Union([Type.String(), Type.Null()])
);

export const listWarmChannelsRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  sort_by: Type.Optional(Type.Array(sortRequestSchema)),
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

export type ListWarmChannelsRequest = Static<
  typeof listWarmChannelsRequestSchema
>;
