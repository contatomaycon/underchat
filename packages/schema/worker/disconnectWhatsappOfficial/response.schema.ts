import { Static, Type } from '@sinclair/typebox';

export const disconnectWhatsappOfficialResponseSchema = Type.Object({
  worker_id: Type.String(),
  disconnected: Type.Boolean({ const: true }),
  meta_unsubscribed: Type.Boolean(),
  meta_warning: Type.Union([Type.String(), Type.Null()]),
});

export type DisconnectWhatsappOfficialResponse = Static<
  typeof disconnectWhatsappOfficialResponseSchema
>;
