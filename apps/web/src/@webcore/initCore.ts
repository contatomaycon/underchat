import { watch } from 'vue';
import { useStorage } from '@vueuse/core';
import { useTheme } from 'vuetify';
import { useI18n } from 'vue-i18n';
import { useConfigStore } from '@webcore/stores/config';
import { cookieRef, namespaceConfig } from '@layouts/stores/config';
import { themeConfig } from '@themeConfig';

const _syncAppRtl = () => {
  const configStore = useConfigStore();
  const storedLang = cookieRef<string | null>('language', null);
  const { locale } = useI18n({ useScope: 'global' });

  if (locale.value !== storedLang.value && storedLang.value) {
    locale.value = storedLang.value;
  }

  watch(
    locale,
    (val) => {
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('lang', val);
      }
      storedLang.value = val;
      themeConfig.app.i18n?.langConfig?.forEach((lang) => {
        if (lang.i18nLang === storedLang.value) {
          configStore.isAppRTL = lang.isRTL;
        }
      });
    },
    { immediate: true }
  );
};

const _handleSkinChanges = () => {
  const { themes } = useTheme();
  const configStore = useConfigStore();

  Object.values(themes.value).forEach((t) => {
    t.colors['skin-default-background'] = t.colors.background;
    t.colors['skin-default-surface'] = t.colors.surface;
  });

  watch(
    () => configStore.skin,
    (val) => {
      Object.values(themes.value).forEach((t) => {
        t.colors.background = t.colors[`skin-${val}-background`];
        t.colors.surface = t.colors[`skin-${val}-surface`];
      });
    },
    { immediate: true }
  );
};

const _syncInitialLoaderTheme = () => {
  const vuetifyTheme = useTheme();
  const configStore = useConfigStore();

  watch(
    () => configStore.theme,
    () => {
      useStorage<string | null>(
        namespaceConfig('initial-loader-bg'),
        null
      ).value = vuetifyTheme.current.value.colors.surface;
      useStorage<string | null>(
        namespaceConfig('initial-loader-color'),
        null
      ).value = vuetifyTheme.current.value.colors.primary;
    },
    { immediate: true }
  );
};

const initCore = () => {
  _syncInitialLoaderTheme();
  _handleSkinChanges();
  if (themeConfig.app.i18n.enable) {
    _syncAppRtl();
  }
};

export default initCore;
