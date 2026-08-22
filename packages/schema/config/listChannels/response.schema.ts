import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerRecreatePhase } from '@core/common/enums/EWorkerRecreatePhase';
import { sessionStorageMigrationSummarySchema } from '@core/schema/config/sessionStorageMigration/response.schema';

const channelStatusSchema = Type.Object({
  id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
});

const channelTypeSchema = Type.Object({
  id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
});

const channelServerSchema = Type.Object({
  id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
});

const channelAccountSchema = Type.Object({
  id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
});

export const listChannelsResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  session_storage: Type.Enum(EWorkerSessionStorage),
  number: Type.Union([Type.String(), Type.Null()]),
  status: Type.Union([channelStatusSchema, Type.Null()]),
  type: Type.Union([channelTypeSchema, Type.Null()]),
  server: Type.Optional(Type.Union([channelServerSchema, Type.Null()])),
  account: Type.Optional(Type.Union([channelAccountSchema, Type.Null()])),
  connection_date: Type.Union([Type.String(), Type.Null()]),
  last_connection_check_at: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.Union([Type.String(), Type.Null()]),
  updated_at: Type.Union([Type.String(), Type.Null()]),
  recreate_phase: Type.Optional(Type.Enum(EWorkerRecreatePhase)),
  session_storage_migration: Type.Union([
    sessionStorageMigrationSummarySchema,
    Type.Null(),
  ]),
});

export const listChannelsFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listChannelsResponseSchema),
});

export type ListChannelsResponse = Static<typeof listChannelsResponseSchema>;
export type ListChannelsFinalResponse = Static<
  typeof listChannelsFinalResponseSchema
>;
