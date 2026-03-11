import { Static, Type } from '@sinclair/typebox';

export const pairServerBuildResponseSchema = Type.Object({
  imported_versions: Type.Number(),
  created_jobs: Type.Number(),
  created_versions: Type.Number(),
  skipped_versions: Type.Number(),
});

export type PairServerBuildResponse = Static<
  typeof pairServerBuildResponseSchema
>;
