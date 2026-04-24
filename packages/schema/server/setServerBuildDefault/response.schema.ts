import { EServerBuildType } from '@core/common/enums/EServerBuildType';
import { Static, Type } from '@sinclair/typebox';

export const serverBuildTypeSchema = Type.Union([
  Type.Literal(EServerBuildType.baileys),
  Type.Literal(EServerBuildType.wwebjs),
  Type.Literal(EServerBuildType.whatsmeow),
  Type.Literal(EServerBuildType.balance_api),
]);

export const serverBuildVersionSchema = Type.Object({
  server_build_version_id: Type.String(),
  build_type: serverBuildTypeSchema,
  version: Type.String(),
  harbor_registry: Type.String(),
  harbor_repository: Type.String(),
  image_reference: Type.String(),
  is_default: Type.Boolean(),
  created_at: Type.String(),
  updated_at: Type.String(),
});

export const serverBuildDefaultResponseSchema = serverBuildVersionSchema;

export type ServerBuildDefaultResponse = Static<
  typeof serverBuildDefaultResponseSchema
>;
