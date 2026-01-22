<script lang="ts" setup>
import navItems from '@/navigation/horizontal';
import { filterNavItemsByPlan } from '@/navigation/filterByPlan';
import { themeConfig } from '@themeConfig';
import Footer from '@/layouts/components/Footer.vue';
import NavbarThemeSwitcher from '@/layouts/components/NavbarThemeSwitcher.vue';
import UserProfile from '@/layouts/components/UserProfile.vue';
import NavBarI18n from '@webcore/components/I18n.vue';
import MasterSessionSwitcher from '@webcore/components/MasterSessionSwitcher.vue';
import ChannelStatusBanner from '@/components/ChannelStatusBanner.vue';
import { HorizontalNavLayout } from '@layouts';
import { VNodeRenderer } from '@layouts/components/VNodeRenderer';
import { useLayoutConfigStore } from '@layouts/stores/config';
import { useAuthStore } from '@/@webcore/stores/auth';

const configStore = useLayoutConfigStore();
const authStore = useAuthStore();

const computedNavItems = computed(() => {
  return filterNavItemsByPlan(navItems, authStore.planIsActive);
});
</script>

<template>
  <HorizontalNavLayout :nav-items="computedNavItems">
    <template #navbar>
      <RouterLink to="/" class="app-logo d-flex align-center gap-x-3">
        <VNodeRenderer :nodes="configStore.appLogo" />

        <h1
          class="app-title font-weight-bold leading-normal text-xl text-capitalize"
        >
          {{ configStore.appTitle }}
        </h1>
      </RouterLink>
      <VSpacer />

      <ChannelStatusBanner />

      <MasterSessionSwitcher />
      <NavBarI18n
        v-if="
          themeConfig.app.i18n.enable && themeConfig.app.i18n.langConfig?.length
        "
        :languages="themeConfig.app.i18n.langConfig"
      />
      <NavbarThemeSwitcher class="me-2" />
      <UserProfile />
    </template>

    <slot />

    <template #footer>
      <Footer />
    </template>
  </HorizontalNavLayout>
</template>
