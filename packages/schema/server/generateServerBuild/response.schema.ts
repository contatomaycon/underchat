import { Static, Type } from '@sinclair/typebox';

export const serverBuildGenerateResponseSchema = Type.Object({
  server_build_job_id: Type.String(),
  version: Type.String(),
});

export type ServerBuildGenerateResponse = Static<
  typeof serverBuildGenerateResponseSchema
>;
