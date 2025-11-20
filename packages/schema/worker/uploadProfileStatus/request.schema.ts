import { Static, Type } from '@sinclair/typebox';
import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';

export const uploadProfileStatusParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export const uploadProfileStatusRequestSchema = Type.Object({
  worker_profile_status_type_id: Type.Union([
    Type.String(),
    Type.Object({
      value: Type.String(),
    }),
  ]),
  photos: Type.Optional(
    Type.Union([
      uploadFileRequestSchema,
      Type.Array(uploadFileRequestSchema),
      Type.Null(),
    ])
  ),
  text: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Object({
        value: Type.String(),
      }),
    ])
  ),
  caption: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Object({
        value: Type.String(),
      }),
    ])
  ),
  is_permanent: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Object({
        value: Type.String(),
      }),
    ])
  ),
  visibility_type: Type.Union([
    Type.String(),
    Type.Object({
      value: Type.String(),
    }),
  ]),
  contact_group_ids: Type.Optional(
    Type.Union([Type.Array(Type.String()), Type.String()])
  ),
  contact_ids: Type.Optional(
    Type.Union([Type.Array(Type.String()), Type.String()])
  ),
});

export type UploadProfileStatusParams = Static<
  typeof uploadProfileStatusParamsSchema
>;
export type UploadProfileStatusRequest = Static<
  typeof uploadProfileStatusRequestSchema
>;
