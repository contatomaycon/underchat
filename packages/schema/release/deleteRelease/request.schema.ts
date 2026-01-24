import { Static, Type } from '@sinclair/typebox';

export const deleteReleaseRequestSchema = Type.Object({
  release_id: Type.String({ format: 'uuid' }),
});

export type DeleteReleaseRequest = Static<typeof deleteReleaseRequestSchema>;
