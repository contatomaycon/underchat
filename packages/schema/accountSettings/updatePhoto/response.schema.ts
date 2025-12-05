import { Static, Type } from '@sinclair/typebox';

export const updatePhotoResponseSchema = Type.Object({
  photo: Type.Union([Type.String(), Type.Null()]),
});

export type UpdatePhotoResponse = Static<typeof updatePhotoResponseSchema>;
