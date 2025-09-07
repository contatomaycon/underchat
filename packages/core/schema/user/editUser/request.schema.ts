import { Static, Type } from '@sinclair/typebox';

export const editUserParamsRequestSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
});

export type EditUserParamsRequest = Static<typeof editUserParamsRequestSchema>;

const userInfoSchema = Type.Object({
  phone_ddi: Type.Union([Type.String(), Type.Null()]),
  phone: Type.Union([Type.String(), Type.Null()]),
  name: Type.Union([Type.String(), Type.Null()]),
  last_name: Type.Union([Type.String(), Type.Null()]),
  birth_date: Type.Union([Type.String(), Type.Null()]),
});

const userDocumentSchema = Type.Object({
  user_document_type_id: Type.Union([
    Type.String({ format: 'uuid' }),
    Type.Null(),
  ]),
  document: Type.String(),
});

const userAddressSchema = Type.Object({
  country_id: Type.Union([Type.Number(), Type.Null()]),
  zip_code: Type.Union([Type.String(), Type.Null()]),
  address1: Type.Union([Type.String(), Type.Null()]),
  address2: Type.Union([Type.String(), Type.Null()]),
  city: Type.Union([Type.String(), Type.Null()]),
  state: Type.Union([Type.String(), Type.Null()]),
  district: Type.Union([Type.String(), Type.Null()]),
});

export const updateUserRequestSchema = Type.Object({
  username: Type.Union([Type.String(), Type.Null()]),
  email: Type.Union([Type.String(), Type.Null()]),
  password: Type.Union([Type.String(), Type.Null()]),
  user_status_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  user_info: Type.Optional(Type.Union([userInfoSchema, Type.Null()])),
  user_document: Type.Optional(Type.Union([userDocumentSchema, Type.Null()])),
  user_address: Type.Optional(Type.Union([userAddressSchema, Type.Null()])),
});

export type UpdateUserRequest = Static<typeof updateUserRequestSchema>;
