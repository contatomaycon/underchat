import { Static, Type } from '@sinclair/typebox';

export const createRoleRequestSchema = Type.Object({
  name: Type.String(),
});

export type CreateRoleRequest = Static<typeof createRoleRequestSchema>;
