import { Static, Type } from '@sinclair/typebox';
import { EContentLayoutNav } from '@core/common/enums/EContentLayoutNav';
import { EContentWidth } from '@core/common/enums/EContentWidth';
import { EFooter } from '@core/common/enums/EFooter';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ENavbar } from '@core/common/enums/ENavbar';
import { ESkin } from '@core/common/enums/ESkin';

export const viewAccountCustomizationResponseSchema = Type.Object({
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
  can_edit: Type.Boolean(),
});

export type ViewAccountCustomizationResponse = Static<
  typeof viewAccountCustomizationResponseSchema
>;
