import { Static, Type } from '@sinclair/typebox';

export const profileStatusPhotoSchema = Type.Object({
  worker_profile_status_id: Type.String(),
  worker_id: Type.String(),
  url: Type.String(),
  is_permanent: Type.Boolean(),
  created_at: Type.String(),
});

export const listProfileStatusPhotosResponseSchema = Type.Array(
  profileStatusPhotoSchema
);

export type ProfileStatusPhoto = Static<typeof profileStatusPhotoSchema>;
export type ListProfileStatusPhotosResponse = Static<
  typeof listProfileStatusPhotosResponseSchema
>;
