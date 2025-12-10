import { Static, Type } from '@sinclair/typebox';
import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';

export const uploadPhotoParamsSchema = Type.Object({
  user_id: Type.String(),
});

export const uploadPhotoRequestSchema = Type.Object({
  photo: uploadFileRequestSchema,
});

export type UploadPhotoParams = Static<typeof uploadPhotoParamsSchema>;
export type UploadPhotoRequest = Static<typeof uploadPhotoRequestSchema>;
