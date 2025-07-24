import { breakpointsVuetifyV3 } from '@vueuse/core';
import { VIcon } from 'vuetify/components/VIcon';
import { defineThemeConfig } from '@webcore';
import { Skins } from '@webcore/enums';
import logo from '@images/logo.svg?raw';
import {
  AppContentLayoutNav,
  ContentWidth,
  FooterType,
  NavbarType,
} from '@layouts/enums';
import { getLayout } from '@/@webcore/localStorage/user';
import { ELanguage } from '@core/common/enums/ELanguage';

const layout = getLayout();

const navbarType = (navbarType: string | null | undefined) => {
  if (navbarType === NavbarType.Sticky) {
    return NavbarType.Sticky;
  }

  if (navbarType === NavbarType.Static) {
    return NavbarType.Static;
  }

  if (navbarType === NavbarType.Hidden) {
    return NavbarType.Hidden;
  }

  return NavbarType.Sticky;
};

const footerType = (footerType: string | null | undefined) => {
  if (footerType === FooterType.Sticky) {
    return FooterType.Sticky;
  }

  if (footerType === FooterType.Static) {
    return FooterType.Static;
  }

  if (footerType === FooterType.Hidden) {
    return FooterType.Hidden;
  }

  return FooterType.Sticky;
};

const titleLayout = (
  layout?.name ?? 'underchat'
).toLowerCase() as Lowercase<string>;
const logoLayout = layout?.logo ?? logo;
const contentWidthLayout =
  layout?.content_width === ContentWidth.Boxed
    ? ContentWidth.Boxed
    : ContentWidth.Fluid;
const contentLayoutNav =
  layout?.content_layout_nav === AppContentLayoutNav.Horizontal
    ? AppContentLayoutNav.Horizontal
    : AppContentLayoutNav.Vertical;
const defaultLocale = layout?.default_locale ?? ELanguage.pt;
const skin = layout?.skin === Skins.Bordered ? Skins.Bordered : Skins.Default;
const navbar = navbarType(layout?.navbar);
const footer = footerType(layout?.footer);
const isVerticalNavCollapsed = layout?.is_vertical_nav_collapsed ?? false;
const isVerticalNavSemiDark = layout?.is_vertical_nav_semi_dark ?? true;

export const { themeConfig, layoutConfig } = defineThemeConfig({
  app: {
    title: titleLayout,
    logo: h('div', {
      innerHTML: logoLayout,
      style: 'line-height:0; color: rgb(var(--v-global-theme-primary))',
    }),
    contentWidth: contentWidthLayout,
    contentLayoutNav: contentLayoutNav,
    overlayNavFromBreakpoint: breakpointsVuetifyV3.lg - 1,
    i18n: {
      enable: true,
      defaultLocale: defaultLocale,
      langConfig: [
        {
          label: 'English',
          i18nLang: ELanguage.en,
          isRTL: false,
        },
        {
          label: 'Português',
          i18nLang: ELanguage.pt,
          isRTL: false,
        },
        {
          label: 'Español',
          i18nLang: ELanguage.es,
          isRTL: false,
        },
      ],
    },
    theme: 'system',
    skin: skin,
    iconRenderer: VIcon,
  },
  navbar: {
    type: navbar,
    navbarBlur: true,
  },
  footer: { type: footer },
  verticalNav: {
    isVerticalNavCollapsed,
    defaultNavItemIconProps: { icon: 'tabler-circle' },
    isVerticalNavSemiDark,
  },
  horizontalNav: {
    type: 'sticky',
    transition: 'slide-y-reverse-transition',
    popoverOffset: 6,
  },
  icons: {
    chevronDown: { icon: 'tabler-chevron-down' },
    chevronRight: { icon: 'tabler-chevron-right', size: 20 },
    close: { icon: 'tabler-x', size: 20 },
    verticalNavPinned: { icon: 'tabler-circle-dot', size: 20 },
    verticalNavUnPinned: { icon: 'tabler-circle', size: 20 },
    sectionTitlePlaceholder: { icon: 'tabler-minus' },
  },
});
