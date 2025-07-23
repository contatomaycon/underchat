import { defineStore } from 'pinia';
import { ref, computed, watch, inject, Ref } from 'vue';
import { AppContentLayoutNav, NavbarType } from '@layouts/enums';
import { injectionKeyIsVerticalNavHovered } from '@layouts/symbols';
import { _setDirAttr } from '@layouts/utils';
import { layoutConfig } from '@themeConfig';

export const namespaceConfig = (str: string) =>
  `${layoutConfig.app.title}-${str}`;

export const cookieRef = <T>(key: string, defaultValue: T) =>
  useCookie<T>(namespaceConfig(key), { default: () => defaultValue });

export const useLayoutConfigStore = defineStore('layoutConfig', () => {
  const route = useRoute();

  const navbarType = ref(layoutConfig.navbar.type);
  const isNavbarBlurEnabled = cookieRef(
    'isNavbarBlurEnabled',
    layoutConfig.navbar.navbarBlur
  );
  const isVerticalNavCollapsed = cookieRef(
    'isVerticalNavCollapsed',
    layoutConfig.verticalNav.isVerticalNavCollapsed
  );
  const appContentWidth = cookieRef(
    'appContentWidth',
    layoutConfig.app.contentWidth
  );
  const appContentLayoutNav = ref(layoutConfig.app.contentLayoutNav);

  watch(appContentLayoutNav, (val) => {
    if (val === AppContentLayoutNav.Horizontal) {
      if (navbarType.value === NavbarType.Hidden)
        navbarType.value = NavbarType.Sticky;
      isVerticalNavCollapsed.value = false;
    }
  });

  const horizontalNavType = ref(layoutConfig.horizontalNav.type);
  const horizontalNavPopoverOffset = ref(
    layoutConfig.horizontalNav.popoverOffset
  );
  const footerType = ref(layoutConfig.footer.type);

  const isAppRTL = ref(false);
  watch(isAppRTL, (val) => {
    _setDirAttr(val ? 'rtl' : 'ltr');
  });

  const mql = window.matchMedia(
    `(max-width: ${layoutConfig.app.overlayNavFromBreakpoint}px)`
  );
  const isLessThanOverlayNavBreakpoint = ref(mql.matches);
  mql.addEventListener('change', (e) => {
    isLessThanOverlayNavBreakpoint.value = e.matches;
  });

  const windowScrollY = ref(window.scrollY);
  window.addEventListener('scroll', () => {
    windowScrollY.value = window.scrollY;
  });

  const _layoutClasses = computed(() => [
    `layout-nav-type-${appContentLayoutNav.value}`,
    `layout-navbar-${navbarType.value}`,
    `layout-footer-${footerType.value}`,
    {
      'layout-vertical-nav-collapsed':
        isVerticalNavCollapsed.value &&
        appContentLayoutNav.value === 'vertical' &&
        !isLessThanOverlayNavBreakpoint.value,
    },
    {
      [`horizontal-nav-${horizontalNavType.value}`]:
        appContentLayoutNav.value === 'horizontal',
    },
    `layout-content-width-${appContentWidth.value}`,
    { 'layout-overlay-nav': isLessThanOverlayNavBreakpoint.value },
    { 'window-scrolled': windowScrollY.value > 0 },
    route.meta.layoutWrapperClasses ?? null,
  ]);

  const isVerticalNavMini = (hoveredRef: Ref<boolean> | null = null) => {
    const hover =
      hoveredRef || inject(injectionKeyIsVerticalNavHovered) || ref(false);
    return computed(
      () =>
        isVerticalNavCollapsed.value &&
        !hover.value &&
        !isLessThanOverlayNavBreakpoint.value
    );
  };

  return {
    appContentWidth,
    appContentLayoutNav,
    navbarType,
    isNavbarBlurEnabled,
    isVerticalNavCollapsed,
    horizontalNavType,
    horizontalNavPopoverOffset,
    footerType,
    isLessThanOverlayNavBreakpoint,
    isAppRTL,
    _layoutClasses,
    isVerticalNavMini,
  };
});
