import { Static, Type } from '@sinclair/typebox';

export const createSectorRequestSchema = Type.Object({
  sector_status_id: Type.String(),
  name: Type.String(),
  color: Type.String(),
});

export type CreateSectorRequest = Static<typeof createSectorRequestSchema>;
