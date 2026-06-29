import { Static, Type } from '@sinclair/typebox';

export const workerProfileInfoSchema = Type.Object({
  worker_profile_info_id: Type.String(),
  worker_id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
  message: Type.Union([Type.String(), Type.Null()]),
  photo: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.Union([Type.String(), Type.Null()]),
  updated_at: Type.Union([Type.String(), Type.Null()]),
  is_official: Type.Optional(Type.Boolean()),
  about: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  address: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  email: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  websites: Type.Optional(Type.Array(Type.String())),
  vertical: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  profile_picture_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const viewProfileInfoResponseSchema = Type.Union([
  workerProfileInfoSchema,
  Type.Null(),
]);

export type WorkerProfileInfo = Static<typeof workerProfileInfoSchema>;
export type ViewProfileInfoResponse = Static<
  typeof viewProfileInfoResponseSchema
>;
