import { Static, Type } from '@sinclair/typebox';

export const createSectorRoleAccountSectorRequestSchema = Type.Object({
  sector_id: Type.String({ format: 'uuid' }),
});

export type CreateSectorRoleAccountSectorRequest = Static<
  typeof createSectorRoleAccountSectorRequestSchema
>;
