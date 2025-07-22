import type { Router } from 'vue-router';
import { layoutConfig } from '@layouts/config';
import { AppContentLayoutNav } from '@layouts/enums';
import { useLayoutConfigStore } from '@layouts/stores/config';
import type { NavGroup, NavLink, NavLinkProps } from '@layouts/types';
import { RouteNamedMap } from 'vue-router/auto-routes';

export const openGroups = ref<string[]>([]);

export const getComputedNavLinkToProp = computed(() => (link: NavLink) => {
  const props: NavLinkProps = {
    target: link.target,
    rel: link.rel,
  };

  if (link.to) {
    props.to =
      typeof link.to === 'string'
        ? { name: link.to as keyof RouteNamedMap }
        : link.to;
  } else {
    props.href = link.href;
  }

  return props;
});

export const resolveNavLinkRouteName = (link: NavLink, router: Router) => {
  if (!link.to) return null;

  if (typeof link.to === 'string') return link.to;

  return router.resolve(link.to).name;
};

export const isNavLinkActive = (link: NavLink, router: Router) => {
  const matchedRoutes = router.currentRoute.value.matched;
  const resolveRoutedName = resolveNavLinkRouteName(link, router);

  if (!resolveRoutedName) return false;

  return matchedRoutes.some((route) => {
    return (
      route.name === resolveRoutedName ||
      route.meta.navActiveLink === resolveRoutedName
    );
  });
};

export const isNavGroupActive = (
  children: (NavLink | NavGroup)[],
  router: Router
): boolean =>
  children.some((child) => {
    if ('children' in child) return isNavGroupActive(child.children, router);

    return isNavLinkActive(child, router);
  });

export const _setDirAttr = (dir: 'ltr' | 'rtl') => {
  if (typeof document !== 'undefined')
    document.documentElement.setAttribute('dir', dir);
};

export const getDynamicI18nProps = (key: string, tag = 'span') => {
  if (!layoutConfig.app.i18n.enable) return {};

  return {
    keypath: key,
    tag,
    scope: 'global',
  };
};

export const switchToVerticalNavOnLtOverlayNavBreakpoint = () => {
  const configStore = useLayoutConfigStore();
  const lgAndUpNav = ref(configStore.appContentLayoutNav);

  watch(
    () => configStore.appContentLayoutNav,
    (value) => {
      if (!configStore.isLessThanOverlayNavBreakpoint) lgAndUpNav.value = value;
    }
  );

  watch(
    () => configStore.isLessThanOverlayNavBreakpoint,
    (val) => {
      configStore.appContentLayoutNav = val
        ? AppContentLayoutNav.Vertical
        : lgAndUpNav.value;
    },
    { immediate: true }
  );
};

export const hexToRgb = (hex: string) => {
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;

  hex = hex.replace(
    shorthandRegex,
    (m: string, r: string, g: string, b: string) => {
      return r + r + g + g + b + b;
    }
  );

  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);

  return result
    ? `${Number.parseInt(result[1], 16)},${Number.parseInt(result[2], 16)},${Number.parseInt(result[3], 16)}`
    : null;
};

export const rgbaToHex = (rgba: string, forceRemoveAlpha = false) => {
  return `#${rgba
    .replace(/^(rgba?\(|\s+|\))$/g, '')
    .split(',')
    .filter((string, index) => !forceRemoveAlpha || index !== 3)
    .map((string) => Number.parseFloat(string))
    .map((number, index) => (index === 3 ? Math.round(number * 255) : number))
    .map((number) => number.toString(16))
    .map((string) => (string.length === 1 ? `0${string}` : string))
    .join('')}`;
};
