<script setup lang="ts">
import { nextTick, shallowRef } from 'vue';
import { themeConfig } from '@themeConfig';
import { useConfigStore } from '@webcore/stores/config';
import { useAuthStore } from '@webcore/stores/auth';
import { useLayoutConfigStore } from '@layouts/stores/config';
import { applyLayoutTheme } from '@/@webcore/utils/applyLayoutTheme';
import { useChatStore } from '@webcore/stores/chat';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { resetConnection } from '@webcore/centrifugo';
import { resetPresencePermissionError } from '@webcore/presence';
import { useTheme } from 'vuetify';
import { ability } from '@/plugins/0.casl/ability';
import LoginForm from '@/components/auth/login/LoginForm.vue';
import AuthHero from '@/components/auth/shared/AuthHero.vue';
import AuthSplitLayout from '@/components/auth/shared/AuthSplitLayout.vue';
import loginHeroImage from '@images/pages/login/underchat-conversation-hub-blue.webp';

interface LoginCredentials {
  login: string;
  password: string;
}

const authStore = useAuthStore();
const chatStore = useChatStore();
const configStore = useConfigStore();
const layoutStore = useLayoutConfigStore();
const vuetifyTheme = useTheme();
useSnackbarCleanup(authStore);
useSnackbarCleanup(chatStore);
const route = useRoute();
const router = useRouter();

definePage({
  meta: {
    layout: 'blank',
    public: true,
    unauthenticatedOnly: true,
  },
});

const isLoggingIn = shallowRef(false);

const handleLogin = async (credentials: LoginCredentials) => {
  isLoggingIn.value = true;

  try {
    const result = await authStore.login(
      credentials.login,
      credentials.password
    );

    if (result) {
      try {
        applyLayoutTheme(authStore.layout, {
          configStore,
          layoutStore,
          vuetifyTheme,
        });
      } catch (error) {
        console.error('Failed to apply layout/theme after login', error);
      }

      resetConnection();
      resetPresencePermissionError();

      chatStore.updateUser();
      const permissions = authStore.permissions;

      const userAbilityRules = permissions.map((permission) => ({
        action: permission,
        subject: permission,
      }));

      try {
        ability.update(userAbilityRules);
      } catch (error) {
        console.error('Failed to update permissions after login', error);
      }

      await nextTick();
      router.replace(route.query.to ? String(route.query.to) : '/');
    }
  } finally {
    isLoggingIn.value = false;
  }
};
</script>

<template>
  <VSnackbar
    v-model="authStore.snackbar.status"
    transition="scroll-y-reverse-transition"
    location="top end"
    :color="authStore.snackbar.color"
  >
    {{ authStore.snackbar.message }}
  </VSnackbar>

  <AuthSplitLayout :panel-aria-label="$t('login_form_kicker')">
    <template #hero>
      <AuthHero
        :app-title="themeConfig.app.title"
        :logo="themeConfig.app.logo"
        :eyebrow="$t('login_hero_kicker')"
        :title="$t('login_hero_title')"
        :description="$t('login_hero_description')"
        :image-src="loginHeroImage"
        :status="$t('login_hero_status')"
      />
    </template>

    <LoginForm
      :app-title="themeConfig.app.title"
      :logo="themeConfig.app.logo"
      :is-loading="isLoggingIn"
      @submit="handleLogin"
    />
  </AuthSplitLayout>
</template>
