import { Static, Type } from '@sinclair/typebox';
import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';

export const uploadProfileInfoParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export const uploadProfileInfoRequestSchema = Type.Object({
  name: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Object({
        value: Type.String(),
      }),
      Type.Null(),
    ])
  ),
  message: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Object({
        value: Type.String(),
      }),
      Type.Null(),
    ])
  ),
  photo: Type.Optional(Type.Union([uploadFileRequestSchema, Type.Null()])),
});

export type UploadProfileInfoParams = Static<
  typeof uploadProfileInfoParamsSchema
>;
export type UploadProfileInfoRequest = Static<
  typeof uploadProfileInfoRequestSchema
>;
