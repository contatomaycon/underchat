<script lang="ts" setup>
import navItems from '@/navigation/vertical';
import { themeConfig } from '@themeConfig';
import Footer from '@/layouts/components/Footer.vue';
import NavbarThemeSwitcher from '@/layouts/components/NavbarThemeSwitcher.vue';
import UserProfile from '@/layouts/components/UserProfile.vue';
import NavBarI18n from '@webcore/components/I18n.vue';
import MasterSessionSwitcher from '@webcore/components/MasterSessionSwitcher.vue';
import { VerticalNavLayout } from '@layouts';
import { useAuthStore } from '@/@webcore/stores/auth';
import { filterNavItemsByPlan } from '@/navigation/filterByPlan';

const authStore = useAuthStore();

const computedNavItems = computed(() => {
  return filterNavItemsByPlan(navItems, authStore.planIsActive);
});
</script>

<template>
  <VerticalNavLayout :nav-items="computedNavItems">
    <template #navbar="{ toggleVerticalOverlayNavActive }">
      <div class="d-flex h-100 align-center">
        <IconBtn
          id="vertical-nav-toggle-btn"
          class="ms-n3 d-lg-none"
          @click="toggleVerticalOverlayNavActive(true)"
        >
          <VIcon size="26" icon="tabler-menu-2" />
        </IconBtn>

        <NavbarThemeSwitcher />

        <VSpacer />

        <NavBarI18n
          v-if="
            themeConfig.app.i18n.enable &&
            themeConfig.app.i18n.langConfig?.length
          "
          :languages="themeConfig.app.i18n.langConfig"
        />
        <MasterSessionSwitcher />
        <UserProfile />
      </div>
    </template>

    <slot />

    <template #footer>
      <Footer />
    </template>
  </VerticalNavLayout>
</template>
