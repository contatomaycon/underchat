import { Static, Type } from '@sinclair/typebox';
import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';

const multipartTextFieldSchema = Type.Union([
  Type.String(),
  Type.Object({
    value: Type.String(),
  }),
  Type.Null(),
]);

export const uploadProfileInfoParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export const uploadProfileInfoRequestSchema = Type.Object({
  name: Type.Optional(multipartTextFieldSchema),
  message: Type.Optional(multipartTextFieldSchema),
  about: Type.Optional(multipartTextFieldSchema),
  description: Type.Optional(multipartTextFieldSchema),
  address: Type.Optional(multipartTextFieldSchema),
  email: Type.Optional(multipartTextFieldSchema),
  websites: Type.Optional(multipartTextFieldSchema),
  vertical: Type.Optional(multipartTextFieldSchema),
  profile_picture_handle: Type.Optional(multipartTextFieldSchema),
  photo: Type.Optional(Type.Union([uploadFileRequestSchema, Type.Null()])),
  remove_photo: Type.Optional(
    Type.Union([
      Type.Boolean(),
      Type.String({ enum: ['true', 'false', '1', '0'] }),
      Type.Object({
        value: Type.Union([
          Type.Boolean(),
          Type.String({ enum: ['true', 'false', '1', '0'] }),
        ]),
      }),
    ])
  ),
});

export type UploadProfileInfoParams = Static<
  typeof uploadProfileInfoParamsSchema
>;
export type UploadProfileInfoRequest = Static<
  typeof uploadProfileInfoRequestSchema
>;
