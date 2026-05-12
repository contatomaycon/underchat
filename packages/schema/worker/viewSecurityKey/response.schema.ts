import { Static, Type } from '@sinclair/typebox';

export const viewSecurityKeyResponseSchema = Type.Object({
  enabled: Type.Boolean(),
  chatbot: Type.Boolean(),
  schedule: Type.Boolean(),
  quick_message: Type.Boolean(),
});

export type ViewSecurityKeyResponse = Static<
  typeof viewSecurityKeyResponseSchema
>;
