import { Static, Type } from '@sinclair/typebox';
import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';

export const updatePhotoRequestSchema = Type.Object({
  photo: uploadFileRequestSchema,
});

export type UpdatePhotoRequest = Static<typeof updatePhotoRequestSchema>;
