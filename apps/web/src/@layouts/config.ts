import {
  AppContentLayoutNav,
  ContentWidth,
  FooterType,
  HorizontalNavType,
  NavbarType,
} from '@layouts/enums';
import type { LayoutConfig } from '@layouts/types';

export const layoutConfig: LayoutConfig = {
  app: {
    title: 'underchat',
    logo: h('img', { src: '/src/assets/logo.svg' }),
    contentWidth: ContentWidth.Boxed,
    contentLayoutNav: AppContentLayoutNav.Vertical,
    overlayNavFromBreakpoint: 0,
    i18n: {
      enable: true,
    },
    iconRenderer: h('div'),
  },
  navbar: {
    type: NavbarType.Sticky,
    navbarBlur: true,
  },
  footer: {
    type: FooterType.Static,
  },
  verticalNav: {
    isVerticalNavCollapsed: false,
    defaultNavItemIconProps: { icon: 'tabler-circle' },
  },
  horizontalNav: {
    type: HorizontalNavType.Sticky,
    transition: 'none',
    popoverOffset: 0,
  },
  icons: {
    chevronDown: { icon: 'tabler-chevron-down' },
    chevronRight: { icon: 'tabler-chevron-right' },
    close: { icon: 'tabler-x' },
    verticalNavPinned: { icon: 'tabler-circle-dot' },
    verticalNavUnPinned: { icon: 'tabler-circle' },
    sectionTitlePlaceholder: { icon: 'tabler-minus' },
  },
};
