<script setup lang="ts">
import { useGenerateImageVariant } from '@webcore/composable/useGenerateImageVariant';
import authV2LoginIllustrationBorderedDark from '@images/pages/auth-v2-login-illustration-bordered-dark.png';
import authV2LoginIllustrationBorderedLight from '@images/pages/auth-v2-login-illustration-bordered-light.png';
import authV2LoginIllustrationDark from '@images/pages/auth-v2-login-illustration-dark.png';
import authV2LoginIllustrationLight from '@images/pages/auth-v2-login-illustration-light.png';
import authV2MaskDark from '@images/pages/misc-mask-dark.png';
import authV2MaskLight from '@images/pages/misc-mask-light.png';
import { VNodeRenderer } from '@layouts/components/VNodeRenderer';
import { themeConfig } from '@themeConfig';
import { useConfigStore } from '@webcore/stores/config';
import { useAuthStore } from '@webcore/stores/auth';
import { useLayoutConfigStore } from '@layouts/stores/config';
import { applyLayoutTheme } from '@/@webcore/utils/applyLayoutTheme';
import { useChatStore } from '@webcore/stores/chat';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { resetConnection } from '@webcore/centrifugo';
import { resetPresencePermissionError } from '@webcore/presence';
import { VForm } from 'vuetify/components/VForm';
import { useTheme } from 'vuetify';

const authStore = useAuthStore();
const chatStore = useChatStore();
const configStore = useConfigStore();
const layoutStore = useLayoutConfigStore();
const vuetifyTheme = useTheme();
useSnackbarCleanup(authStore);
useSnackbarCleanup(chatStore);
const route = useRoute();
const router = useRouter();
const ability = useAbility();

definePage({
  meta: {
    layout: 'blank',
    public: true,
    unauthenticatedOnly: true,
  },
});

const refFormLogin = ref<VForm>();

const form = ref({
  login: '',
  password: '',
});

const isPasswordVisible = ref(false);

const authThemeImg = useGenerateImageVariant(
  authV2LoginIllustrationLight,
  authV2LoginIllustrationDark,
  authV2LoginIllustrationBorderedLight,
  authV2LoginIllustrationBorderedDark,
  true
);

const authThemeMask = useGenerateImageVariant(authV2MaskLight, authV2MaskDark);

const handleLogin = async () => {
  const validateForm = await refFormLogin?.value?.validate();
  if (!validateForm?.valid) return;

  const result = await authStore.login(form.value.login, form.value.password);

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

  <a href="javascript:void(0)">
    <div class="auth-logo d-flex align-center gap-x-3">
      <VNodeRenderer :nodes="themeConfig.app.logo" />
      <h1 class="auth-title">
        {{ themeConfig.app.title }}
      </h1>
    </div>
  </a>

  <VRow no-gutters class="auth-wrapper bg-surface">
    <VCol md="8" class="d-none d-md-flex">
      <div class="position-relative bg-background w-100 me-0">
        <div
          class="d-flex align-center justify-center w-100 h-100"
          style="padding-inline: 6.25rem"
        >
          <VImg
            max-width="613"
            :src="authThemeImg"
            class="auth-illustration mt-16 mb-2"
          />
        </div>

        <img
          class="auth-footer-mask flip-in-rtl"
          :src="authThemeMask"
          alt="auth-footer-mask"
          height="280"
          width="100"
        />
      </div>
    </VCol>

    <VCol
      cols="12"
      md="4"
      class="auth-card-v2 d-flex align-center justify-center"
    >
      <VCard flat :max-width="500" class="mt-12 mt-sm-0 pa-6">
        <VCardText>
          <h4 class="text-h4 mb-1">
            {{ $t('welcome') }}
            <span class="text-capitalize">{{ themeConfig.app.title }}</span
            >!
          </h4>
          <p class="mb-0">
            {{ $t('please_login') }}
          </p>
        </VCardText>
        <VCardText>
          <VForm ref="refFormLogin" @submit.prevent>
            <VRow>
              <VCol cols="12">
                <VLabel class="text-body-2 mb-1">{{ $t('email') }}:</VLabel>
                <AppTextField
                  v-model="form.login"
                  autofocus
                  type="text"
                  placeholder="email@email.com"
                  :rules="[requiredValidator(form.login, $t('email_required'))]"
                />
              </VCol>

              <VCol cols="12">
                <VLabel class="text-body-2 mb-1">{{ $t('password') }}:</VLabel>
                <AppTextField
                  v-model="form.password"
                  placeholder="············"
                  :type="isPasswordVisible ? 'text' : 'password'"
                  :append-inner-icon="
                    isPasswordVisible ? 'tabler-eye-off' : 'tabler-eye'
                  "
                  @click:append-inner="isPasswordVisible = !isPasswordVisible"
                  :rules="[
                    requiredValidator(form.password, $t('password_required')),
                  ]"
                />

                <div
                  class="d-flex align-center flex-wrap justify-space-between my-6"
                >
                  <a class="text-primary" href="javascript:void(0)">
                    {{ $t('forgot_password') }}
                  </a>
                </div>

                <VBtn block type="submit" @click="handleLogin">
                  {{ $t('login') }}
                </VBtn>
              </VCol>
            </VRow>
          </VForm>
        </VCardText>
      </VCard>
    </VCol>
  </VRow>
</template>

<style lang="scss">
@use '@webcore/scss/template/pages/page-auth';
</style>
