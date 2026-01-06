import { Static, Type } from '@sinclair/typebox';

const userInfoSchema = Type.Object({
  user_info_id: Type.String({ format: 'uuid' }),
  phone_ddi: Type.Union([Type.String(), Type.Null()]),
  phone_partial: Type.Union([Type.String(), Type.Null()]),
  name: Type.Union([Type.String(), Type.Null()]),
  last_name: Type.Union([Type.String(), Type.Null()]),
  birth_date: Type.Union([Type.String(), Type.Null()]),
  photo: Type.Union([Type.String(), Type.Null()]),
});

const documentTypeSchema = Type.Object({
  user_document_type_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

const userDocumentSchema = Type.Object({
  user_document_id: Type.String({ format: 'uuid' }),
  user_document_type: Type.Union([documentTypeSchema, Type.Null()]),
  document_partial: Type.Union([Type.String(), Type.Null()]),
});

const countrySchema = Type.Object({
  country_id: Type.Number(),
  iso_code: Type.String(),
  name: Type.String(),
});

const userAddressSchema = Type.Object({
  user_address_id: Type.String({ format: 'uuid' }),
  country: Type.Union([countrySchema, Type.Null()]),
  zip_code: Type.Union([Type.String(), Type.Null()]),
  address1_partial: Type.Union([Type.String(), Type.Null()]),
  address2_partial: Type.Union([Type.String(), Type.Null()]),
  city: Type.Union([Type.String(), Type.Null()]),
  state: Type.Union([Type.String(), Type.Null()]),
  district: Type.Union([Type.String(), Type.Null()]),
});

export const viewUserInfoResponseSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
  email_partial: Type.String(),
  user_info: Type.Optional(Type.Union([userInfoSchema, Type.Null()])),
  user_document: Type.Optional(Type.Union([userDocumentSchema, Type.Null()])),
  user_address: Type.Optional(Type.Union([userAddressSchema, Type.Null()])),
});

export type ViewUserInfoResponse = Static<typeof viewUserInfoResponseSchema>;
