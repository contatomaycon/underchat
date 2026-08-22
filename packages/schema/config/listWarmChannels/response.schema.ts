import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';

const warmChannelServerSchema = Type.Object({
  id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
});

const warmChannelTypeSchema = Type.Object({
  id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
});

export const listWarmChannelsResponseSchema = Type.Object({
  warm_pool_id: Type.String(),
  server: warmChannelServerSchema,
  type: warmChannelTypeSchema,
  state: Type.String(),
  container_id: Type.Union([Type.String(), Type.Null()]),
  container_name: Type.Union([Type.String(), Type.Null()]),
  session_storage: Type.Enum(EWorkerSessionStorage),
  session_volume_name: Type.Union([Type.String(), Type.Null()]),
  last_health_at: Type.Union([Type.String(), Type.Null()]),
  last_error: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.Union([Type.String(), Type.Null()]),
  updated_at: Type.Union([Type.String(), Type.Null()]),
});

export const listWarmChannelsFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listWarmChannelsResponseSchema),
});

export type ListWarmChannelsResponse = Static<
  typeof listWarmChannelsResponseSchema
>;
export type ListWarmChannelsFinalResponse = Static<
  typeof listWarmChannelsFinalResponseSchema
>;
