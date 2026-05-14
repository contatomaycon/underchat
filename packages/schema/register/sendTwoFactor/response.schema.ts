import { Static, Type } from '@sinclair/typebox';

export const authRegisterSendTwoFactorResponseSchema = Type.Object({
  success: Type.Boolean(),
  message: Type.String(),
  validation_id: Type.String({ format: 'uuid' }),
  validation_text: Type.String(),
  whatsapp_url: Type.String(),
  target_phone: Type.String(),
  centrifugo_url: Type.String(),
  centrifugo_token: Type.String(),
  centrifugo_channel: Type.String(),
});

export type AuthRegisterSendTwoFactorResponse = Static<
  typeof authRegisterSendTwoFactorResponseSchema
>;
