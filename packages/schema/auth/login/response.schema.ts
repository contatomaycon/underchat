import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { EContentLayoutNav } from '@core/common/enums/EContentLayoutNav';
import { EContentWidth } from '@core/common/enums/EContentWidth';
import { EFooter } from '@core/common/enums/EFooter';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ENavbar } from '@core/common/enums/ENavbar';
import { ESkin } from '@core/common/enums/ESkin';
import { Static, Type } from '@sinclair/typebox';
import { userAttendanceGuardStatusSchema } from '@core/schema/user/attendanceHours/shared.schema';

export const chatsUserResponseSchema = Type.Object({
  chat_user_id: Type.String(),
  about: Type.Union([Type.String(), Type.Null()]),
  status: Type.String({ enum: Object.values(EChatUserStatus) }),
  notifications: Type.Boolean(),
  notifications_sound: Type.Boolean(),
  notifications_toast: Type.Boolean(),
  notifications_browser: Type.Boolean(),
  notifications_push: Type.Boolean(),
  notifications_message_queue: Type.Boolean(),
  notifications_message_in_chat: Type.Boolean(),
  notifications_message_chatbot: Type.Boolean(),
  notifications_transfer: Type.Boolean(),
  notifications_internal_chat: Type.Boolean(),
  notifications_internal_chat_direct: Type.Boolean(),
  notifications_internal_chat_group: Type.Boolean(),
  notifications_internal_chat_sound: Type.Boolean(),
  notifications_internal_chat_toast: Type.Boolean(),
  notifications_internal_chat_browser: Type.Boolean(),
  notifications_internal_chat_push: Type.Boolean(),
  sort_by_chat_order: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  sort_in_chat_order: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  sort_by_my_chats_order: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  sort_my_chats_order: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  sort_by_queue_order: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  sort_queue_order: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  sort_by_chatbot_order: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  sort_chatbot_order: Type.Optional(Type.Union([Type.String(), Type.Null()])),
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
    document_partial: Type.Union([Type.String(), Type.Null()]),
    document_type: Type.String(),
  }),
  address: Type.Union([
    Type.Object({
      user_address_id: Type.String(),
      zip_code: Type.Union([Type.String(), Type.Null()]),
      address1_partial: Type.Union([Type.String(), Type.Null()]),
      address2_partial: Type.Union([Type.String(), Type.Null()]),
      city: Type.Union([Type.String(), Type.Null()]),
      state: Type.Union([Type.String(), Type.Null()]),
      district: Type.Union([Type.String(), Type.Null()]),
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

export const userChannelResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
});

export const authLoginResponseSchema = Type.Object({
  user: authUserResponseSchema,
  permissions: Type.Array(Type.String()),
  layout: Type.Union([accountInfoResponseSchema, Type.Null()]),
  token: Type.String(),
  sectors: Type.Array(Type.String()),
  channels: Type.Array(userChannelResponseSchema),
  plan_is_active: Type.Boolean(),
  plan_products: Type.Array(Type.String()),
  attendance_guard: userAttendanceGuardStatusSchema,
});

export type AuthLoginResponse = Static<typeof authLoginResponseSchema>;
export type AuthUserResponse = Static<typeof authUserResponseSchema>;
export type AccountInfoResponse = Static<typeof accountInfoResponseSchema>;
