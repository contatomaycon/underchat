import { Static, Type } from '@sinclair/typebox';

export const uploadPhotoResponseSchema = Type.Object({
  photo: Type.Union([Type.String(), Type.Null()]),
});

export type UploadPhotoResponse = Static<typeof uploadPhotoResponseSchema>;
