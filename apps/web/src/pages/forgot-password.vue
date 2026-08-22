<script setup lang="ts">
import { themeConfig } from '@themeConfig';
import { useForgotPasswordFlow } from '@/composables/useForgotPasswordFlow';
import AuthHero from '@/components/auth/shared/AuthHero.vue';
import AuthSplitLayout from '@/components/auth/shared/AuthSplitLayout.vue';
import ForgotPasswordFlow from '@/components/auth/forgot-password/ForgotPasswordFlow.vue';
import recoveryHeroImage from '@images/pages/forgot-password/underchat-secure-recovery-blue.webp';

definePage({
  meta: {
    layout: 'blank',
    public: true,
    unauthenticatedOnly: true,
  },
});

const {
  activeValidation,
  activeValidationRejectionReason,
  activeValidationStatus,
  authStore,
  confirmPassword,
  currentStep,
  email,
  isResettingPassword,
  isSendingCode,
  newPassword,
  resetPassword,
  restartRecovery,
  sendCode,
} = useForgotPasswordFlow();
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

  <AuthSplitLayout :panel-aria-label="$t('forgot_password_form_kicker')">
    <template #hero>
      <AuthHero
        :app-title="themeConfig.app.title"
        :logo="themeConfig.app.logo"
        :eyebrow="$t('forgot_password_hero_kicker')"
        :title="$t('forgot_password_hero_title')"
        :description="$t('forgot_password_hero_description')"
        :image-src="recoveryHeroImage"
        :status="$t('forgot_password_hero_status')"
      />
    </template>

    <ForgotPasswordFlow
      v-model:email="email"
      v-model:new-password="newPassword"
      v-model:confirm-password="confirmPassword"
      :app-title="themeConfig.app.title"
      :logo="themeConfig.app.logo"
      :current-step="currentStep"
      :is-sending-code="isSendingCode"
      :is-resetting-password="isResettingPassword"
      :active-validation="activeValidation"
      :active-validation-status="activeValidationStatus"
      :active-validation-rejection-reason="activeValidationRejectionReason"
      @send-code="sendCode"
      @back-to-email="restartRecovery"
      @restart="restartRecovery"
      @reset-password="resetPassword"
    />
  </AuthSplitLayout>
</template>
