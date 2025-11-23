import { Static, Type } from '@sinclair/typebox';

export const deletePhotoResponseSchema = Type.Object({
  photo: Type.Union([Type.String(), Type.Null()]),
});

export type DeletePhotoResponse = Static<typeof deletePhotoResponseSchema>;
