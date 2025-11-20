import { Static, Type } from '@sinclair/typebox';

export const workerProfileInfoSchema = Type.Object({
  worker_profile_info_id: Type.String(),
  worker_id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
  message: Type.Union([Type.String(), Type.Null()]),
  photo: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.Union([Type.String(), Type.Null()]),
  updated_at: Type.Union([Type.String(), Type.Null()]),
});

export const viewProfileInfoResponseSchema = Type.Union([
  workerProfileInfoSchema,
  Type.Null(),
]);

export type WorkerProfileInfo = Static<typeof workerProfileInfoSchema>;
export type ViewProfileInfoResponse = Static<
  typeof viewProfileInfoResponseSchema
>;
