import { Static, Type } from '@sinclair/typebox';

export const deleteServerBuildVersionRequestSchema = Type.Object({
  server_build_version_id: Type.String(),
});

export type DeleteServerBuildVersionRequest = Static<
  typeof deleteServerBuildVersionRequestSchema
>;
