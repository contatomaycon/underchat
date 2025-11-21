import { Static, Type } from '@sinclair/typebox';

export const workerProfileStatusSchema = Type.Object({
  worker_profile_status_id: Type.String(),
  worker_id: Type.String(),
  worker_profile_status_type_id: Type.String(),
  value: Type.String(),
  is_permanent: Type.Boolean(),
});

export const uploadProfileStatusResponseSchema = Type.Array(
  workerProfileStatusSchema
);

export type WorkerProfileStatus = Static<typeof workerProfileStatusSchema>;
export type UploadProfileStatusResponse = Static<
  typeof uploadProfileStatusResponseSchema
>;
