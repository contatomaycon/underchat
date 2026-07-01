import { Static, Type } from '@sinclair/typebox';

export const updateWhatsappEmbeddedConfigResponseSchema = Type.Object({
  app_id: Type.Union([Type.String(), Type.Null()]),
  configuration_id: Type.Union([Type.String(), Type.Null()]),
  api_version: Type.Union([Type.String(), Type.Null()]),
  webhook_verify_token: Type.Union([Type.String(), Type.Null()]),
  has_app_secret: Type.Boolean(),
  has_webhook_verify_token: Type.Boolean(),
  is_configured: Type.Boolean(),
  is_webhook_configured: Type.Boolean(),
  updated_at: Type.Union([Type.String(), Type.Null()]),
});

export type UpdateWhatsappEmbeddedConfigResponse = Static<
  typeof updateWhatsappEmbeddedConfigResponseSchema
>;
