import { Static, Type } from '@sinclair/typebox';

export const createSectorResponseSchema = Type.Object({
  sector_id: Type.String({ format: 'uuid' }),
});

export type CreateSectorResponse = Static<typeof createSectorResponseSchema>;
