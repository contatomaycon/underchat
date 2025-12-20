import type { Router, RouteLocationRaw } from 'vue-router';
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
        ? ({ name: link.to as keyof RouteNamedMap } as RouteLocationRaw)
        : (link.to as RouteLocationRaw);
  } else {
    props.href = link.href;
  }

  return props;
});

export const resolveNavLinkRouteName = (link: NavLink, router: Router) => {
  if (!link.to) return null;

  if (typeof link.to === 'string') return link.to;

  try {
    return router.resolve(link.to).name;
  } catch {
    return null;
  }
};

export const isNavLinkActive = (link: NavLink, router: Router) => {
  const currentRoute = router.currentRoute.value;
  const resolveRoutedName = resolveNavLinkRouteName(link, router);
  if (!resolveRoutedName) return false;

  const targetLocation = link.to ? router.resolve(link.to) : null;
  const targetQuery = targetLocation?.query ?? {};
  const matchedRoutes = currentRoute.matched;

  const matchesRoute =
    matchedRoutes.some(
      (route) =>
        route.name === resolveRoutedName ||
        route.meta.navActiveLink === resolveRoutedName
    ) || currentRoute.name === resolveRoutedName;

  if (!matchesRoute) return false;

  const normalizeQueryValue = (value: unknown): string | undefined => {
    if (Array.isArray(value)) {
      const sorted = value.map(String).toSorted((a, b) => a.localeCompare(b));
      return sorted.join('|');
    }

    if (value === undefined) return undefined;

    if (value === null) return 'null';

    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const entries = Object.keys(record)
        .toSorted((a, b) => a.localeCompare(b))
        .map((key) => {
          const entryValue = normalizeQueryValue(record[key]);
          return `${key}:${entryValue ?? ''}`;
        });

      return entries.join('|');
    }

    if (typeof value === 'symbol') {
      return value.toString();
    }

    return String(value as string | number | boolean | bigint);
  };

  const keys = new Set([
    ...Object.keys(targetQuery),
    ...Object.keys(currentRoute.query ?? {}),
  ]);

  for (const key of keys) {
    const expected = normalizeQueryValue(targetQuery[key]);
    const current = normalizeQueryValue(currentRoute.query?.[key]);

    if (expected !== current) {
      return false;
    }
  }

  return true;
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
    .replaceAll(/^(rgba?\(|\s+|\))$/g, '')
    .split(',')
    .filter((_, index) => !forceRemoveAlpha || index !== 3)
    .map((s) => Number.parseFloat(s))
    .map((n, i) => (i === 3 ? Math.round(n * 255) : n))
    .map((n) => n.toString(16))
    .map((s) => (s.length === 1 ? `0${s}` : s))
    .join('')}`;
};
