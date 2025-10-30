import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { EContentLayoutNav } from '@core/common/enums/EContentLayoutNav';
import { EContentWidth } from '@core/common/enums/EContentWidth';
import { EFooter } from '@core/common/enums/EFooter';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ENavbar } from '@core/common/enums/ENavbar';
import { ESkin } from '@core/common/enums/ESkin';
import { Static, Type } from '@sinclair/typebox';

export const chatsUserResponseSchema = Type.Object({
  chat_user_id: Type.String(),
  about: Type.Union([Type.String(), Type.Null()]),
  status: Type.String({ enum: Object.values(EChatUserStatus) }),
  notifications: Type.Boolean(),
});

export const authUserResponseSchema = Type.Object({
  user_id: Type.String(),
  account_id: Type.String(),
  email_partial: Type.String(),
  status: Type.Object({
    status_id: Type.String(),
    name: Type.String(),
  }),
  info: Type.Object({
    user_info_id: Type.String(),
    name: Type.String(),
    last_name: Type.String(),
    phone_partial: Type.String(),
    photo: Type.Union([Type.String(), Type.Null()]),
    birth_date: Type.Union([Type.String(), Type.Null()]),
  }),
  type: Type.Object({
    user_type_id: Type.String(),
    name: Type.String(),
  }),
  document: Type.Object({
    user_document_id: Type.String(),
    document_partial: Type.String(),
    document_type: Type.String(),
  }),
  address: Type.Union([
    Type.Object({
      user_address_id: Type.String(),
      zip_code: Type.String(),
      address1_partial: Type.String(),
      address2_partial: Type.Union([Type.String(), Type.Null()]),
      city: Type.String(),
      state: Type.String(),
      district: Type.String(),
    }),
    Type.Null(),
  ]),
  chat_user: Type.Union([chatsUserResponseSchema, Type.Null()]),
});

export const accountInfoResponseSchema = Type.Object({
  account_info_id: Type.String(),
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
