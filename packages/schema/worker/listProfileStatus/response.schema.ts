import { Static, Type } from '@sinclair/typebox';

export const profileStatusSchema = Type.Object({
  worker_profile_status_id: Type.String(),
  worker_id: Type.String(),
  worker_profile_status_type_id: Type.String(),
  value: Type.String(),
  is_permanent: Type.Boolean(),
  mimetype: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  duration: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  width: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  height: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  created_at: Type.String(),
});

export const listProfileStatusResponseSchema = Type.Array(profileStatusSchema);

export type ProfileStatus = Static<typeof profileStatusSchema>;
export type ListProfileStatusResponse = Static<
  typeof listProfileStatusResponseSchema
>;
