import { Static, Type } from '@sinclair/typebox';

export const deleteServerBuildResponseSchema = Type.Object({
  version: Type.String(),
  deleted_jobs: Type.Number(),
  deleted_job_items: Type.Number(),
  deleted_versions: Type.Number(),
});

export type DeleteServerBuildResponse = Static<
  typeof deleteServerBuildResponseSchema
>;
