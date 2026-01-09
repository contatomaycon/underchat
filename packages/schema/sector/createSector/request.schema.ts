import { Static, Type } from '@sinclair/typebox';

export const createSectorRequestSchema = Type.Object({
  name: Type.String({ maxLength: 100 }),
  color: Type.String({ maxLength: 20 }),
});

export type CreateSectorRequest = Static<typeof createSectorRequestSchema>;
