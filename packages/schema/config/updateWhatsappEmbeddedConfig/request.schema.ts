import { Static, Type } from '@sinclair/typebox';

export const updateWhatsappEmbeddedConfigRequestSchema = Type.Object({
  app_id: Type.String(),
  app_secret: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  webhook_verify_token: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  configuration_id: Type.String(),
  api_version: Type.String(),
});

export type UpdateWhatsappEmbeddedConfigRequest = Static<
  typeof updateWhatsappEmbeddedConfigRequestSchema
>;
