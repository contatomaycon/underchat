import { Static, Type } from '@sinclair/typebox';

export const createSectorRequestSchema = Type.Object({
  name: Type.String(),
  color: Type.String(),
});

export type CreateSectorRequest = Static<typeof createSectorRequestSchema>;
