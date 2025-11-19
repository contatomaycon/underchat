import { Static, Type } from '@sinclair/typebox';

export const updateProfileStatusPhotoParamsSchema = Type.Object({
  worker_profile_status_id: Type.String(),
});

export const updateProfileStatusPhotoRequestSchema = Type.Object({
  is_permanent: Type.Boolean(),
});

export type UpdateProfileStatusPhotoParams = Static<
  typeof updateProfileStatusPhotoParamsSchema
>;
export type UpdateProfileStatusPhotoRequest = Static<
  typeof updateProfileStatusPhotoRequestSchema
>;
