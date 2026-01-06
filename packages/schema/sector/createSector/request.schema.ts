import { Static, Type } from '@sinclair/typebox';

export const createSectorRequestSchema = Type.Object({
  name: Type.String(),
  color: Type.String(),
  permission_role_id: Type.Array(Type.String({ format: 'uuid' })),
});

export type CreateSectorRequest = Static<typeof createSectorRequestSchema>;
