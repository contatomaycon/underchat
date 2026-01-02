import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';

const userStatusSchema = Type.Object({
  user_status_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

const accountSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

const permissionRoleSchema = Type.Object({
  permission_role_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

const userInfoSchema = Type.Object({
  user_info_id: Type.String({ format: 'uuid' }),
  phone_ddi: Type.Union([Type.String(), Type.Null()]),
  phone_partial: Type.Union([Type.String(), Type.Null()]),
  name: Type.Union([Type.String(), Type.Null()]),
  last_name: Type.Union([Type.String(), Type.Null()]),
  birth_date: Type.Union([Type.String(), Type.Null()]),
  photo: Type.Union([Type.String(), Type.Null()]),
});

const chatUserSchema = Type.Object({
  chat_user_id: Type.String({ format: 'uuid' }),
  status: Type.String({ enum: Object.values(EChatUserStatus) }),
});

const documentTypeSchema = Type.Object({
  user_document_type_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

const userDocumentSchema = Type.Object({
  user_document_id: Type.String({ format: 'uuid' }),
  user_document_type: Type.Union([documentTypeSchema, Type.Null()]),
  document_partial: Type.String(),
});

const countrySchema = Type.Object({
  country_id: Type.Number(),
  iso_code: Type.String(),
  name: Type.String(),
});

const userAddressSchema = Type.Object({
  user_address_id: Type.String({ format: 'uuid' }),
  country: Type.Union([countrySchema, Type.Null()]),
  zip_code: Type.String(),
  address1_partial: Type.String(),
  address2_partial: Type.Union([Type.String(), Type.Null()]),
  city: Type.Union([Type.String(), Type.Null()]),
  state: Type.Union([Type.String(), Type.Null()]),
  city_fiscal_code: Type.Union([Type.String(), Type.Null()]),
  state_fiscal_code: Type.Union([Type.String(), Type.Null()]),
  district: Type.String(),
});

export const listUserResponseSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
  account: Type.Union([accountSchema, Type.Null()]),
  permission_role: Type.Optional(
    Type.Union([permissionRoleSchema, Type.Null()])
  ),
  email_partial: Type.String(),
  user_status: Type.Optional(Type.Union([userStatusSchema, Type.Null()])),
  user_info: Type.Optional(Type.Union([userInfoSchema, Type.Null()])),
  user_document: Type.Optional(Type.Union([userDocumentSchema, Type.Null()])),
  user_address: Type.Optional(Type.Union([userAddressSchema, Type.Null()])),
  chat_user: Type.Optional(Type.Union([chatUserSchema, Type.Null()])),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const listUserFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listUserResponseSchema),
});

export type ListUserResponse = Static<typeof listUserResponseSchema>;
export type ListUserFinalResponse = Static<typeof listUserFinalResponseSchema>;
