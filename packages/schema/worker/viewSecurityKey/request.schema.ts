import { Static, Type } from '@sinclair/typebox';

export const viewSecurityKeyParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export type ViewSecurityKeyParams = Static<typeof viewSecurityKeyParamsSchema>;
