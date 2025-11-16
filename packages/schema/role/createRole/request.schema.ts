import { Static, Type } from '@sinclair/typebox';

export const createRoleRequestSchema = Type.Object({
  name: Type.String(),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type CreateRoleRequest = Static<typeof createRoleRequestSchema>;
