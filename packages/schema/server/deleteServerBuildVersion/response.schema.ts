import { serverBuildTypeSchema } from '@core/schema/server/viewServerBuild/response.schema';
import { Static, Type } from '@sinclair/typebox';

export const deleteServerBuildVersionResponseSchema = Type.Object({
  server_build_version_id: Type.String(),
  build_type: serverBuildTypeSchema,
  version: Type.String(),
});

export type DeleteServerBuildVersionResponse = Static<
  typeof deleteServerBuildVersionResponseSchema
>;
