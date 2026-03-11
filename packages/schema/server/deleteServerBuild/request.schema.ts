import { Static, Type } from '@sinclair/typebox';

export const deleteServerBuildRequestSchema = Type.Object({
  server_build_job_id: Type.String(),
});

export type DeleteServerBuildRequest = Static<
  typeof deleteServerBuildRequestSchema
>;
