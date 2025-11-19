import { Static, Type } from '@sinclair/typebox';

export const listProfileStatusPhotosRequestSchema = Type.Object({
  worker_id: Type.String(),
});

export type ListProfileStatusPhotosRequest = Static<
  typeof listProfileStatusPhotosRequestSchema
>;
