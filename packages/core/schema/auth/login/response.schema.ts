import { Static, Type } from '@sinclair/typebox';

export const authUserResponseSchema = Type.Object({
  user_id: Type.Number(),
  email_partial: Type.String(),
  status: Type.Object({
    status_id: Type.Number(),
    name: Type.String(),
  }),
  info: Type.Object({
    user_info_id: Type.Number(),
    name: Type.String(),
    last_name: Type.String(),
    phone_partial: Type.String(),
    photo: Type.Union([Type.String(), Type.Null()]),
    birth_date: Type.Union([Type.String(), Type.Null()]),
  }),
  type: Type.Object({
    user_type_id: Type.Number(),
    name: Type.String(),
  }),
  document: Type.Object({
    user_document_id: Type.Number(),
    document_partial: Type.String(),
    document_type: Type.String(),
  }),
  address: Type.Union([
    Type.Object({
      user_address_id: Type.Number(),
      zip_code: Type.String(),
      address1_partial: Type.String(),
      address2_partial: Type.Union([Type.String(), Type.Null()]),
      city: Type.String(),
      state: Type.String(),
      district: Type.String(),
    }),
    Type.Null(),
  ]),
});

export const authLoginResponseSchema = Type.Object({
  user: authUserResponseSchema,
  permissions: Type.Array(Type.String()),
  token: Type.String(),
});

export type AuthLoginResponse = Static<typeof authLoginResponseSchema>;
export type AuthUserResponse = Static<typeof authUserResponseSchema>;
