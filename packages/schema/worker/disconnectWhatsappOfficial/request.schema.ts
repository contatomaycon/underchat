import { Static, Type } from '@sinclair/typebox';

export const disconnectWhatsappOfficialRequestSchema = Type.Object({
  worker_id: Type.String(),
});

export type DisconnectWhatsappOfficialRequest = Static<
  typeof disconnectWhatsappOfficialRequestSchema
>;
