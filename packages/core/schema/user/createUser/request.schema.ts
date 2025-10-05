import { Static, Type } from '@sinclair/typebox';

const userInfoSchema = Type.Object({
  phone_ddi: Type.String(),
  phone: Type.String(),
  name: Type.String(),
  last_name: Type.String(),
  birth_date: Type.Union([Type.String(), Type.Null()]),
});

const userDocumentSchema = Type.Object({
  user_document_type_id: Type.String({ format: 'uuid' }),
  document: Type.String(),
});

const userAddressSchema = Type.Object({
  country_id: Type.Number(),
  zip_code: Type.String(),
  address1: Type.String(),
  address2: Type.Union([Type.String(), Type.Null()]),
  city: Type.String(),
  state: Type.String(),
  district: Type.String(),
});

export const createUserRequestSchema = Type.Object({
  username: Type.String(),
  email: Type.String(),
  password: Type.String(),
  user_info: userInfoSchema,
  user_document: userDocumentSchema,
  user_address: userAddressSchema,
});

export type CreateUserRequest = Static<typeof createUserRequestSchema>;
