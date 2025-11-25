import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';
import { Static, Type } from '@sinclair/typebox';

export const editUserParamsRequestSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
});

export type EditUserParamsRequest = Static<typeof editUserParamsRequestSchema>;

export const updateUserRequestSchema = Type.Object({
  email: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String(), Type.Null()]),
    })
  ),
  password: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String(), Type.Null()]),
    })
  ),
  account_id: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    })
  ),
  user_status_id: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    })
  ),
  phone_ddi: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String(), Type.Null()]),
    })
  ),
  phone: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String(), Type.Null()]),
    })
  ),
  name: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String(), Type.Null()]),
    })
  ),
  last_name: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String(), Type.Null()]),
    })
  ),
  birth_date: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String(), Type.Null()]),
    })
  ),
  document_type_id: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    })
  ),
  document: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String(), Type.Null()]),
    })
  ),
  country_id: Type.Optional(
    Type.Object({
      value: Type.Union([Type.Number(), Type.Null()]),
    })
  ),
  zip_code: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String(), Type.Null()]),
    })
  ),
  address1: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String(), Type.Null()]),
    })
  ),
  address2: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String(), Type.Null()]),
    })
  ),
  city: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String(), Type.Null()]),
    })
  ),
  state: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String(), Type.Null()]),
    })
  ),
  district: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String(), Type.Null()]),
    })
  ),
  photo: Type.Optional(uploadFileRequestSchema),
  photo_url: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String(), Type.Null()]),
    })
  ),
});

export type UpdateUserRequest = Static<typeof updateUserRequestSchema>;
