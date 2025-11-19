import { Static, Type } from '@sinclair/typebox';

export const profileStatusSchema = Type.Object({
  worker_profile_status_id: Type.String(),
  worker_id: Type.String(),
  worker_profile_status_type_id: Type.String(),
  value: Type.String(),
  is_permanent: Type.Boolean(),
  created_at: Type.String(),
});

export const listProfileStatusResponseSchema = Type.Array(profileStatusSchema);

export type ProfileStatus = Static<typeof profileStatusSchema>;
export type ListProfileStatusResponse = Static<
  typeof listProfileStatusResponseSchema
>;
