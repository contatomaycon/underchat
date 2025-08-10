import { Static, Type } from '@sinclair/typebox';

export const deleteSectorRequestSchema = Type.Object({
  sector_id: Type.String({ format: 'uuid' }),
});

export type DeleteSectorRequest = Static<typeof deleteSectorRequestSchema>;
