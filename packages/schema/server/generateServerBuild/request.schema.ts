import { serverBuildTypeSchema } from '@core/schema/server/viewServerBuild/response.schema';
import { Static, Type } from '@sinclair/typebox';

export const serverBuildGenerateRequestSchema = Type.Object(
  {
    build_types: Type.Array(serverBuildTypeSchema, {
      minItems: 1,
      uniqueItems: true,
    }),
    version: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false }
);

export type ServerBuildGenerateRequest = Static<
  typeof serverBuildGenerateRequestSchema
>;
