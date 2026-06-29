import { Static, Type } from '@sinclair/typebox';

export const connectWhatsappEmbeddedResponseSchema = Type.Object({
  worker_id: Type.String(),
  account_id: Type.String(),
  server_id: Type.String(),
  worker_type_id: Type.String(),
  worker_status_id: Type.String(),
  number: Type.Union([Type.String(), Type.Null()]),
  waba_id: Type.String(),
  phone_number_id: Type.String(),
});

export type ConnectWhatsappEmbeddedResponse = Static<
  typeof connectWhatsappEmbeddedResponseSchema
>;
