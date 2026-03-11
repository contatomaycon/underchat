import { EServerBuildJobItemStatus } from '@core/common/enums/EServerBuildJobItemStatus';
import { EServerBuildJobStatus } from '@core/common/enums/EServerBuildJobStatus';
import { EServerBuildType } from '@core/common/enums/EServerBuildType';
import { Static, Type } from '@sinclair/typebox';

export const serverBuildTypeSchema = Type.Union([
  Type.Literal(EServerBuildType.baileys),
  Type.Literal(EServerBuildType.wwebjs),
  Type.Literal(EServerBuildType.balance_api),
]);

export const serverBuildJobStatusSchema = Type.Union([
  Type.Literal(EServerBuildJobStatus.queued),
  Type.Literal(EServerBuildJobStatus.running),
  Type.Literal(EServerBuildJobStatus.cancel_requested),
  Type.Literal(EServerBuildJobStatus.canceled),
  Type.Literal(EServerBuildJobStatus.failed),
  Type.Literal(EServerBuildJobStatus.completed),
]);

export const serverBuildJobItemStatusSchema = Type.Union([
  Type.Literal(EServerBuildJobItemStatus.pending),
  Type.Literal(EServerBuildJobItemStatus.running),
  Type.Literal(EServerBuildJobItemStatus.success),
  Type.Literal(EServerBuildJobItemStatus.failed),
  Type.Literal(EServerBuildJobItemStatus.canceled),
]);

export const serverBuildVersionSchema = Type.Object({
  server_build_version_id: Type.String(),
  build_type: serverBuildTypeSchema,
  version: Type.String(),
  harbor_registry: Type.String(),
  harbor_repository: Type.String(),
  image_reference: Type.String(),
  is_default: Type.Boolean(),
  created_at: Type.String(),
  updated_at: Type.String(),
});

export const serverBuildJobItemSchema = Type.Object({
  server_build_job_item_id: Type.String(),
  server_build_job_id: Type.String(),
  build_type: serverBuildTypeSchema,
  status: serverBuildJobItemStatusSchema,
  image_reference: Type.Union([Type.String(), Type.Null()]),
  error_message: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.String(),
  updated_at: Type.String(),
  started_at: Type.Union([Type.String(), Type.Null()]),
  finished_at: Type.Union([Type.String(), Type.Null()]),
});

export const serverBuildJobSchema = Type.Object({
  server_build_job_id: Type.String(),
  requested_by: Type.Union([Type.String(), Type.Null()]),
  version: Type.String(),
  status: serverBuildJobStatusSchema,
  error_message: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.String(),
  updated_at: Type.String(),
  started_at: Type.Union([Type.String(), Type.Null()]),
  finished_at: Type.Union([Type.String(), Type.Null()]),
  items: Type.Array(serverBuildJobItemSchema),
});

export const serverBuildVersionsByTypeSchema = Type.Object({
  [EServerBuildType.baileys]: Type.Array(serverBuildVersionSchema),
  [EServerBuildType.wwebjs]: Type.Array(serverBuildVersionSchema),
  [EServerBuildType.balance_api]: Type.Array(serverBuildVersionSchema),
});

export const serverBuildViewResponseSchema = Type.Object({
  active_job: Type.Union([serverBuildJobSchema, Type.Null()]),
  versions_by_type: serverBuildVersionsByTypeSchema,
});

export type ServerBuildType = Static<typeof serverBuildTypeSchema>;
export type ServerBuildJobStatus = Static<typeof serverBuildJobStatusSchema>;
export type ServerBuildJobItemStatus = Static<
  typeof serverBuildJobItemStatusSchema
>;
export type ServerBuildVersion = Static<typeof serverBuildVersionSchema>;
export type ServerBuildJobItem = Static<typeof serverBuildJobItemSchema>;
export type ServerBuildJob = Static<typeof serverBuildJobSchema>;
export type ServerBuildVersionsByType = Static<
  typeof serverBuildVersionsByTypeSchema
>;
export type ServerBuildViewResponse = Static<
  typeof serverBuildViewResponseSchema
>;
