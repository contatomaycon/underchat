import { Static, Type } from '@sinclair/typebox';

export const updateSecurityKeyParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export const updateSecurityKeyRequestSchema = Type.Object({
  enabled: Type.Boolean(),
  chatbot: Type.Boolean(),
  schedule: Type.Boolean(),
  quick_message: Type.Boolean(),
});

export type UpdateSecurityKeyParams = Static<
  typeof updateSecurityKeyParamsSchema
>;
export type UpdateSecurityKeyRequest = Static<
  typeof updateSecurityKeyRequestSchema
>;
