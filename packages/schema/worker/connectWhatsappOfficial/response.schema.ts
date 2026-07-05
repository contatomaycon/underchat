import { Static, Type } from '@sinclair/typebox';

export const connectWhatsappOfficialResponseSchema = Type.Object({
  worker_id: Type.String(),
  account_id: Type.String(),
  server_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  worker_type_id: Type.String(),
  worker_status_id: Type.String(),
  number: Type.Union([Type.String(), Type.Null()]),
  waba_id: Type.String(),
  phone_number_id: Type.String(),
});

export type ConnectWhatsappOfficialResponse = Static<
  typeof connectWhatsappOfficialResponseSchema
>;
