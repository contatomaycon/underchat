import { Static, Type } from '@sinclair/typebox';

export const createSectorRoleParamsSchema = Type.Object({
  sector_id: Type.String(),
});

export type CreateSectorRoleParams = Static<
  typeof createSectorRoleParamsSchema
>;

export const createSectorRoleRequestSchema = Type.Object({
  permission_role_id: Type.Array(Type.String()),
});

export type CreateSectorRoleRequest = Static<
  typeof createSectorRoleRequestSchema
>;
