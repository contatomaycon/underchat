import { storeToRefs } from 'pinia';
import { useTheme } from 'vuetify';
import { cookieRef, useLayoutConfigStore } from '@layouts/stores/config';
import { themeConfig } from '@themeConfig';

export const useConfigStore = defineStore('config', () => {
  const userPreferredColorScheme = usePreferredColorScheme();
  const cookieColorScheme = cookieRef<'light' | 'dark'>(
    'color-scheme',
    'light'
  );

  watch(
    userPreferredColorScheme,
    (val) => {
      if (val !== 'no-preference') cookieColorScheme.value = val;
    },
    { immediate: true }
  );

  const theme = cookieRef('theme', themeConfig.app.theme);

  const isVerticalNavSemiDark = cookieRef(
    'isVerticalNavSemiDark',
    themeConfig.verticalNav.isVerticalNavSemiDark
  );

  const skin = cookieRef('skin', themeConfig.app.skin);

  const {
    isLessThanOverlayNavBreakpoint,
    appContentWidth,
    navbarType,
    isNavbarBlurEnabled,
    appContentLayoutNav,
    isVerticalNavCollapsed,
    footerType,
    isAppRTL,
  } = storeToRefs(useLayoutConfigStore());

  return {
    theme,
    isVerticalNavSemiDark,
    skin,
    isLessThanOverlayNavBreakpoint,
    appContentWidth,
    navbarType,
    isNavbarBlurEnabled,
    appContentLayoutNav,
    isVerticalNavCollapsed,
    footerType,
    isAppRTL,
  };
});

export const initConfigStore = () => {
  const userPreferredColorScheme = usePreferredColorScheme();
  const vuetifyTheme = useTheme();
  const configStore = useConfigStore();

  watch([() => configStore.theme, userPreferredColorScheme], () => {
    let newTheme: string;

    if (configStore.theme === 'system') {
      newTheme = userPreferredColorScheme.value === 'dark' ? 'dark' : 'light';
    } else {
      newTheme = configStore.theme;
    }

    vuetifyTheme.global.name.value = newTheme;
  });

  onMounted(() => {
    if (configStore.theme === 'system')
      vuetifyTheme.global.name.value = userPreferredColorScheme.value;
  });
};
