import { Static, Type } from '@sinclair/typebox';

export const workerProfileStatusSchema = Type.Object({
  worker_profile_status_id: Type.String(),
  worker_id: Type.String(),
  worker_profile_status_type_id: Type.String(),
  value: Type.String(),
  is_permanent: Type.Boolean(),
  mimetype: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  duration: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  width: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  height: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
});

export const uploadProfileStatusResponseSchema = Type.Array(
  workerProfileStatusSchema
);

export type WorkerProfileStatus = Static<typeof workerProfileStatusSchema>;
export type UploadProfileStatusResponse = Static<
  typeof uploadProfileStatusResponseSchema
>;
