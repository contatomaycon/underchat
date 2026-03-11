import { serverBuildTypeSchema } from '@core/schema/server/viewServerBuild/response.schema';
import { Static, Type } from '@sinclair/typebox';

export const retryServerBuildRequestSchema = Type.Object({
  server_build_job_id: Type.String(),
  build_type: serverBuildTypeSchema,
});

export type RetryServerBuildRequest = Static<
  typeof retryServerBuildRequestSchema
>;
