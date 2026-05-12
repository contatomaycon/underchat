import { Static, Type } from '@sinclair/typebox';

export const updateSecurityKeyResponseSchema = Type.Object({
  enabled: Type.Boolean(),
  chatbot: Type.Boolean(),
  schedule: Type.Boolean(),
  quick_message: Type.Boolean(),
});

export type UpdateSecurityKeyResponse = Static<
  typeof updateSecurityKeyResponseSchema
>;
