import { Static, Type } from '@sinclair/typebox';

export const editUserParamsRequestSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
});

export type EditUserParamsRequest = Static<typeof editUserParamsRequestSchema>;

const userInfoSchema = Type.Object({
  phone_ddi: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  phone: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  last_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  birth_date: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const userDocumentSchema = Type.Object({
  user_document_type_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  document: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const userAddressSchema = Type.Object({
  country_id: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  zip_code: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  address1: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  address2: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  city: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  state: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  district: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const updateUserRequestSchema = Type.Object({
  email: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  password: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  account_id: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
  user_status_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  user_info: Type.Optional(Type.Union([userInfoSchema, Type.Null()])),
  user_document: Type.Optional(Type.Union([userDocumentSchema, Type.Null()])),
  user_address: Type.Optional(Type.Union([userAddressSchema, Type.Null()])),
});

export type UpdateUserRequest = Static<typeof updateUserRequestSchema>;
