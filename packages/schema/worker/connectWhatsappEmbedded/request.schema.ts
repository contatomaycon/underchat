import { Static, Type } from '@sinclair/typebox';

export const connectWhatsappEmbeddedRequestSchema = Type.Object({
  name: Type.String(),
  code: Type.String(),
  business_id: Type.Optional(Type.String()),
  waba_id: Type.String(),
  phone_number_id: Type.Optional(Type.String()),
});

export type ConnectWhatsappEmbeddedRequest = Static<
  typeof connectWhatsappEmbeddedRequestSchema
>;
