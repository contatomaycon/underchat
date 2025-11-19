import { Static, Type } from '@sinclair/typebox';

export const workerProfileStatusPhotoSchema = Type.Object({
  worker_profile_status_id: Type.String(),
  worker_id: Type.String(),
  url: Type.String(),
  is_permanent: Type.Boolean(),
});

export const uploadProfileStatusPhotosResponseSchema = Type.Array(
  workerProfileStatusPhotoSchema
);

export type WorkerProfileStatusPhoto = Static<
  typeof workerProfileStatusPhotoSchema
>;
export type UploadProfileStatusPhotosResponse = Static<
  typeof uploadProfileStatusPhotosResponseSchema
>;
