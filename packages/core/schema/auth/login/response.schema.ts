import { EContentLayoutNav } from '@core/common/enums/EContentLayoutNav';
import { EContentWidth } from '@core/common/enums/EContentWidth';
import { EFooter } from '@core/common/enums/EFooter';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ENavbar } from '@core/common/enums/ENavbar';
import { ESkin } from '@core/common/enums/ESkin';
import { Static, Type } from '@sinclair/typebox';

export const authUserResponseSchema = Type.Object({
  user_id: Type.Number(),
  account_id: Type.Number(),
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

export const accountInfoResponseSchema = Type.Object({
  account_info_id: Type.Number(),
  name: Type.String(),
  logo: Type.Union([Type.String(), Type.Null()]),
  content_width: Type.Union([Type.String(EContentWidth), Type.Null()]),
  content_layout_nav: Type.Union([Type.String(EContentLayoutNav), Type.Null()]),
  default_locale: Type.Union([Type.String(ELanguage), Type.Null()]),
  skin: Type.Union([Type.String(ESkin), Type.Null()]),
  navbar: Type.Union([Type.String(ENavbar), Type.Null()]),
  footer: Type.Union([Type.String(EFooter), Type.Null()]),
  is_vertical_nav_collapsed: Type.Boolean(),
  is_vertical_nav_semi_dark: Type.Boolean(),
  light_primary_color: Type.Union([Type.String(), Type.Null()]),
  light_secondary_color: Type.Union([Type.String(), Type.Null()]),
  dark_primary_color: Type.Union([Type.String(), Type.Null()]),
  dark_secondary_color: Type.Union([Type.String(), Type.Null()]),
});

export const authLoginResponseSchema = Type.Object({
  user: authUserResponseSchema,
  permissions: Type.Array(Type.String()),
  layout: Type.Union([accountInfoResponseSchema, Type.Null()]),
  token: Type.String(),
});

export type AuthLoginResponse = Static<typeof authLoginResponseSchema>;
export type AuthUserResponse = Static<typeof authUserResponseSchema>;
export type AccountInfoResponse = Static<typeof accountInfoResponseSchema>;
