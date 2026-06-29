import { Static, Type } from '@sinclair/typebox';

export const workerWhatsappEmbeddedConfigResponseSchema = Type.Object({
  app_id: Type.Union([Type.String(), Type.Null()]),
  configuration_id: Type.Union([Type.String(), Type.Null()]),
  api_version: Type.Union([Type.String(), Type.Null()]),
  is_configured: Type.Boolean(),
});

export type WorkerWhatsappEmbeddedConfigResponse = Static<
  typeof workerWhatsappEmbeddedConfigResponseSchema
>;
