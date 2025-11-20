import { Static, Type } from '@sinclair/typebox';

export const updateProfileStatusParamsSchema = Type.Object({
  worker_profile_status_id: Type.String(),
});

export const updateProfileStatusRequestSchema = Type.Object({
  is_permanent: Type.Union([
    Type.Boolean(),
    Type.String(),
    Type.Object({
      value: Type.Union([Type.Boolean(), Type.String()]),
    }),
  ]),
});

export type UpdateProfileStatusParams = Static<
  typeof updateProfileStatusParamsSchema
>;
export type UpdateProfileStatusRequest = Static<
  typeof updateProfileStatusRequestSchema
>;
