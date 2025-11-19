import { Static, Type } from '@sinclair/typebox';
import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';

export const uploadProfileStatusPhotosParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export const uploadProfileStatusPhotosRequestSchema = Type.Object({
  photos: Type.Union([
    uploadFileRequestSchema,
    Type.Array(uploadFileRequestSchema),
    Type.Null(),
  ]),
  is_permanent: Type.Optional(
    Type.Union([
      Type.Object({
        value: Type.Union([Type.Boolean(), Type.String()]),
      }),
      Type.Null(),
    ])
  ),
});

export type UploadProfileStatusPhotosParams = Static<
  typeof uploadProfileStatusPhotosParamsSchema
>;
export type UploadProfileStatusPhotosRequest = Static<
  typeof uploadProfileStatusPhotosRequestSchema
>;
