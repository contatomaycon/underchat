<script lang="ts" setup>
import { useConfigStore } from '@/@webcore/stores/config';
import { AppContentLayoutNav } from '@layouts/enums';
import { switchToVerticalNavOnLtOverlayNavBreakpoint } from '@layouts/utils';

const DefaultLayoutWithHorizontalNav = defineAsyncComponent(
  () => import('./components/DefaultLayoutWithHorizontalNav.vue')
);
const DefaultLayoutWithVerticalNav = defineAsyncComponent(
  () => import('./components/DefaultLayoutWithVerticalNav.vue')
);

const configStore = useConfigStore();

switchToVerticalNavOnLtOverlayNavBreakpoint();

const { layoutAttrs, injectSkinClasses } = useSkins();

injectSkinClasses();

const isFallbackStateActive = ref(false);
const refLoadingIndicator = ref<any>(null);

watch(
  [isFallbackStateActive, refLoadingIndicator],
  () => {
    if (isFallbackStateActive.value && refLoadingIndicator.value)
      refLoadingIndicator.value.fallbackHandle();

    if (!isFallbackStateActive.value && refLoadingIndicator.value)
      refLoadingIndicator.value.resolveHandle();
  },
  { immediate: true }
);
</script>

<template>
  <Component
    v-bind="layoutAttrs"
    :is="
      configStore.appContentLayoutNav === AppContentLayoutNav.Vertical
        ? DefaultLayoutWithVerticalNav
        : DefaultLayoutWithHorizontalNav
    "
  >
    <AppLoadingIndicator ref="refLoadingIndicator" />

    <RouterView v-slot="{ Component }">
      <Suspense
        :timeout="0"
        @fallback="isFallbackStateActive = true"
        @resolve="isFallbackStateActive = false"
      >
        <Component :is="Component" />
      </Suspense>
    </RouterView>
  </Component>
</template>

<style lang="scss">
@use '@layouts/styles/default-layout';
</style>
