import { Static, Type } from '@sinclair/typebox';

export const connectWhatsappOfficialRequestSchema = Type.Object({
  code: Type.String(),
  business_id: Type.Optional(Type.String()),
  waba_id: Type.String(),
  phone_number_id: Type.Optional(Type.String()),
});

export type ConnectWhatsappOfficialRequest = Static<
  typeof connectWhatsappOfficialRequestSchema
>;
