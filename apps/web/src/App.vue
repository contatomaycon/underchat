<script setup lang="ts">
import { useTheme } from 'vuetify';
import ScrollToTop from '@core/components/ScrollToTop.vue';
import initCore from '@core/initCore';
import { initConfigStore, useConfigStore } from '@core/stores/config';
import { hexToRgb } from '@core/utils/colorConverter';

const { global } = useTheme();

initCore();
initConfigStore();

const configStore = useConfigStore();
</script>

<template>
  <VLocaleProvider :rtl="configStore.isAppRTL">
    <VApp
      :style="`--v-global-theme-primary: ${hexToRgb(global.current.value.colors.primary)}`"
    >
      <RouterView />

      <ScrollToTop />
    </VApp>
  </VLocaleProvider>
</template>
