import { Static, Type } from '@sinclair/typebox';

export const createReleaseResponseSchema = Type.Object({
  release_id: Type.String({ format: 'uuid' }),
});

export type CreateReleaseResponse = Static<typeof createReleaseResponseSchema>;
