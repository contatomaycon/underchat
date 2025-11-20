import { Static, Type } from '@sinclair/typebox';

export const deleteProfileStatusRequestSchema = Type.Object({
  worker_profile_status_id: Type.String(),
});

export type DeleteProfileStatusRequest = Static<
  typeof deleteProfileStatusRequestSchema
>;
