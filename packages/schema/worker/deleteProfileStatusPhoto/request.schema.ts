import { Static, Type } from '@sinclair/typebox';

export const deleteProfileStatusPhotoRequestSchema = Type.Object({
  worker_profile_status_id: Type.String(),
});

export type DeleteProfileStatusPhotoRequest = Static<
  typeof deleteProfileStatusPhotoRequestSchema
>;
