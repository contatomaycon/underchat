import { Static, Type } from '@sinclair/typebox';

export const viewSectorRequestSchema = Type.Object({
  sector_id: Type.String({ format: 'uuid' }),
});

export type ViewSectorRequest = Static<typeof viewSectorRequestSchema>;
