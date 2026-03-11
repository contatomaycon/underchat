import { Static, Type } from '@sinclair/typebox';

export const serverBuildDefaultParamsSchema = Type.Object({
  server_build_version_id: Type.String(),
});

export type ServerBuildDefaultParams = Static<
  typeof serverBuildDefaultParamsSchema
>;
