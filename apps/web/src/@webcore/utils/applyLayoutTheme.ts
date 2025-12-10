import { useStorage } from '@vueuse/core';
import { h } from 'vue';
import { useTheme } from 'vuetify';
import logo from '@images/logo.svg?raw';
import { AccountInfoResponse } from '@core/schema/auth/login/response.schema';
import { ELanguage } from '@core/common/enums/ELanguage';
import {
  AppContentLayoutNav,
  ContentWidth,
  FooterType,
  NavbarType,
} from '@layouts/enums';
import {
  cookieRef,
  namespaceConfig,
  useLayoutConfigStore,
} from '@layouts/stores/config';
import { layoutConfig as layoutsLayoutConfig } from '@layouts/config';
import { Skins } from '@webcore/enums';
import { useConfigStore } from '@webcore/stores/config';
import { getLayout } from '@/@webcore/localStorage/user';
import { layoutConfig as appLayoutConfig, themeConfig } from '@themeConfig';

type ThemeContext = {
  vuetifyTheme: ReturnType<typeof useTheme>;
  configStore: ReturnType<typeof useConfigStore>;
  layoutStore: ReturnType<typeof useLayoutConfigStore>;
};

const DEFAULT_LIGHT_PRIMARY = '#2865B7';
const DEFAULT_LIGHT_SECONDARY = '#5098E5';
const DEFAULT_DARK_PRIMARY = '#152642';
const DEFAULT_DARK_SECONDARY = '#2865B7';

const resolveNavbarType = (
  navbarType: string | null | undefined
): (typeof NavbarType)[keyof typeof NavbarType] => {
  if (navbarType === NavbarType.Sticky) return NavbarType.Sticky;
  if (navbarType === NavbarType.Static) return NavbarType.Static;
  if (navbarType === NavbarType.Hidden) return NavbarType.Hidden;

  return NavbarType.Sticky;
};

const resolveFooterType = (
  footerType: string | null | undefined
): (typeof FooterType)[keyof typeof FooterType] => {
  if (footerType === FooterType.Sticky) return FooterType.Sticky;
  if (footerType === FooterType.Static) return FooterType.Static;
  if (footerType === FooterType.Hidden) return FooterType.Hidden;

  return FooterType.Sticky;
};

const buildLogoNode = (layoutLogo?: string | null) => {
  const logoContent = layoutLogo ?? logo;

  if (
    logoContent &&
    (logoContent.startsWith('http://') || logoContent.startsWith('https://'))
  ) {
    return h('img', {
      src: logoContent,
      alt: 'Logo',
      style: 'line-height:0; max-height: 2rem;',
    });
  }

  return h('div', {
    innerHTML: logoContent,
    style: 'line-height:0; color: rgb(var(--v-global-theme-primary))',
  });
};

export const applyLayoutTheme = (
  layoutInput?: AccountInfoResponse | null,
  ctx?: ThemeContext
): void => {
  const layout = layoutInput ?? getLayout();
  const vuetifyTheme = ctx?.vuetifyTheme ?? useTheme();
  const configStore = ctx?.configStore ?? useConfigStore();
  const layoutStore = ctx?.layoutStore ?? useLayoutConfigStore();

  const title = (
    layout?.name ?? 'underchat'
  ).toLowerCase() as Lowercase<string>;
  const logoNode = buildLogoNode(layout?.logo);
  const contentWidth =
    layout?.content_width === ContentWidth.Boxed
      ? ContentWidth.Boxed
      : ContentWidth.Fluid;
  const contentLayoutNav =
    layout?.content_layout_nav === AppContentLayoutNav.Horizontal
      ? AppContentLayoutNav.Horizontal
      : AppContentLayoutNav.Vertical;
  const defaultLocale = layout?.default_locale ?? ELanguage.pt;
  const skin = layout?.skin === Skins.Bordered ? Skins.Bordered : Skins.Default;
  const navbar = resolveNavbarType(layout?.navbar);
  const footer = resolveFooterType(layout?.footer);
  const isVerticalNavCollapsed = layout?.is_vertical_nav_collapsed ?? false;
  const isVerticalNavSemiDark = layout?.is_vertical_nav_semi_dark ?? true;

  // Sync theme and layout configs so new values are used for namespacing and branding
  appLayoutConfig.app.title = title;
  appLayoutConfig.app.logo = logoNode;
  appLayoutConfig.app.contentWidth = contentWidth;
  appLayoutConfig.app.contentLayoutNav = contentLayoutNav;
  appLayoutConfig.navbar.type = navbar;
  appLayoutConfig.footer.type = footer;
  appLayoutConfig.verticalNav.isVerticalNavCollapsed = isVerticalNavCollapsed;

  themeConfig.app.title = title;
  themeConfig.app.logo = logoNode;
  themeConfig.app.contentWidth = contentWidth;
  themeConfig.app.contentLayoutNav = contentLayoutNav;
  themeConfig.app.i18n.defaultLocale = defaultLocale;
  themeConfig.app.skin = skin;
  themeConfig.navbar.type = navbar;
  themeConfig.footer.type = footer;
  themeConfig.verticalNav.isVerticalNavCollapsed = isVerticalNavCollapsed;
  themeConfig.verticalNav.isVerticalNavSemiDark = isVerticalNavSemiDark;

  layoutsLayoutConfig.app.title = title;
  layoutsLayoutConfig.app.logo = logoNode as any;
  layoutsLayoutConfig.app.contentWidth = contentWidth;
  layoutsLayoutConfig.app.contentLayoutNav = contentLayoutNav;
  layoutsLayoutConfig.navbar.type = navbar;
  layoutsLayoutConfig.footer.type = footer;
  layoutsLayoutConfig.verticalNav.isVerticalNavCollapsed =
    isVerticalNavCollapsed;

  // Apply layout preferences to stores
  configStore.skin = skin;
  configStore.isVerticalNavSemiDark = isVerticalNavSemiDark;
  layoutStore.appContentLayoutNav = contentLayoutNav;
  layoutStore.appContentWidth = contentWidth;
  layoutStore.navbarType = navbar;
  layoutStore.footerType = footer;
  layoutStore.isVerticalNavCollapsed = isVerticalNavCollapsed;

  const matchedLang = themeConfig.app.i18n.langConfig?.find(
    (lang) => lang.i18nLang === defaultLocale
  );
  configStore.isAppRTL = matchedLang?.isRTL ?? false;

  // Apply theme colors
  const lightPrimary = layout?.light_primary_color ?? DEFAULT_LIGHT_PRIMARY;
  const lightSecondary =
    layout?.light_secondary_color ?? DEFAULT_LIGHT_SECONDARY;
  const darkPrimary = layout?.dark_primary_color ?? DEFAULT_DARK_PRIMARY;
  const darkSecondary = layout?.dark_secondary_color ?? DEFAULT_DARK_SECONDARY;

  vuetifyTheme.themes.value.light.colors.primary = lightPrimary;
  vuetifyTheme.themes.value.light.colors['primary-darken-1'] = darkPrimary;
  vuetifyTheme.themes.value.light.colors.secondary = lightSecondary;
  vuetifyTheme.themes.value.dark.colors.primary = lightPrimary;
  vuetifyTheme.themes.value.dark.colors['primary-darken-1'] = darkPrimary;
  vuetifyTheme.themes.value.dark.colors.secondary = darkSecondary;

  cookieRef('lightThemePrimaryColor', lightPrimary).value = lightPrimary;
  cookieRef('lightThemePrimaryDarkenColor', darkPrimary).value = darkPrimary;
  cookieRef('darkThemePrimaryColor', lightPrimary).value = lightPrimary;
  cookieRef('darkThemePrimaryDarkenColor', darkPrimary).value = darkPrimary;

  useStorage<string | null>(
    namespaceConfig('initial-loader-color'),
    null
  ).value = lightPrimary;
};
