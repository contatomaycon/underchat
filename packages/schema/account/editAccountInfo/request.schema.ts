import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';
import { Static, Type } from '@sinclair/typebox';

export const editAccountInfoParamsRequestSchema = Type.Object({
  account_info_id: Type.String({ format: 'uuid' }),
});

export type EditAccountInfoParamsRequest = Static<
  typeof editAccountInfoParamsRequestSchema
>;

export const editAccountInfoRequestSchema = Type.Object({
  account_id: Type.Object({
    value: Type.String({ format: 'uuid' }),
  }),
  logo: Type.Optional(Type.Union([uploadFileRequestSchema, Type.Null()])),
  delete_logo: Type.Optional(
    Type.Object({
      value: Type.Union([Type.Boolean(), Type.Null()]),
    })
  ),
  content_width: Type.Object({
    value: Type.Union([Type.String(), Type.Null()]),
  }),
  content_layout_nav: Type.Object({
    value: Type.Union([Type.String(), Type.Null()]),
  }),
  default_locale: Type.Object({
    value: Type.Union([Type.String(), Type.Null()]),
  }),
  skin: Type.Object({
    value: Type.Union([Type.String(), Type.Null()]),
  }),
  navbar: Type.Object({
    value: Type.Union([Type.String(), Type.Null()]),
  }),
  footer: Type.Object({
    value: Type.Union([Type.String(), Type.Null()]),
  }),
  is_vertical_nav_collapsed: Type.Object({
    value: Type.Boolean(),
  }),
  is_vertical_nav_semi_dark: Type.Object({
    value: Type.Boolean(),
  }),
  light_primary_color: Type.Object({
    value: Type.Union([Type.String(), Type.Null()]),
  }),
  light_secondary_color: Type.Object({
    value: Type.Union([Type.String(), Type.Null()]),
  }),
  dark_primary_color: Type.Object({
    value: Type.Union([Type.String(), Type.Null()]),
  }),
  dark_secondary_color: Type.Object({
    value: Type.Union([Type.String(), Type.Null()]),
  }),
});

export type EditAccountInfoRequest = Static<
  typeof editAccountInfoRequestSchema
>;
