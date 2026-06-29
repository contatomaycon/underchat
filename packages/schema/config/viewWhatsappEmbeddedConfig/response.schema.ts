import { Static, Type } from '@sinclair/typebox';

export const viewWhatsappEmbeddedConfigResponseSchema = Type.Object({
  app_id: Type.Union([Type.String(), Type.Null()]),
  configuration_id: Type.Union([Type.String(), Type.Null()]),
  api_version: Type.Union([Type.String(), Type.Null()]),
  has_app_secret: Type.Boolean(),
  is_configured: Type.Boolean(),
  updated_at: Type.Union([Type.String(), Type.Null()]),
});

export type ViewWhatsappEmbeddedConfigResponse = Static<
  typeof viewWhatsappEmbeddedConfigResponseSchema
>;
