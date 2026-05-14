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
import { ability } from '@/plugins/0.casl/ability';
import { useI18n } from 'vue-i18n';
import ActiveWhatsappValidationCard from '@/components/auth/ActiveWhatsappValidationCard.vue';
import { useActiveWhatsappValidation } from '@/composables/useActiveWhatsappValidation';
import type { AuthForgotPasswordSendCodeResponse } from '@core/schema/auth/forgotPassword/sendCode/response.schema';
import { EColor } from '@core/common/enums/EColor';
import {
  requiredValidator,
  emailValidator,
  confirmedValidator,
} from '@/@webcore/utils/validators';
import { validatePassword } from '@/@webcore/utils/passwordStrength';

const { t: $t } = useI18n();

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

const refFormEmail = ref<VForm>();
const refFormPassword = ref<VForm>();

const currentStep = ref(0);
const email = ref('');
const isSendingCode = ref(false);
const isResettingPassword = ref(false);
const resetPasswordToken = ref<string | null>(null);
const activeValidation = ref<AuthForgotPasswordSendCodeResponse | null>(null);
const activeValidationStatus = ref<'waiting' | 'validated' | 'rejected'>(
  'waiting'
);
const activeValidationRejectionReason = ref<string | null>(null);
const activeWhatsappValidation = useActiveWhatsappValidation();
let activeValidationAdvanceTimer: number | null = null;

const recoverableActiveValidationReasons = new Set([
  'phone_mismatch',
  'worker_mismatch',
]);

const isRecoverableActiveValidationReason = (
  reason: string | null | undefined
): boolean => !!reason && recoverableActiveValidationReasons.has(reason);

const newPassword = ref('');
const confirmPassword = ref('');
const isNewPasswordVisible = ref(false);
const isConfirmPasswordVisible = ref(false);

const authThemeImg = useGenerateImageVariant(
  authV2LoginIllustrationLight,
  authV2LoginIllustrationDark,
  authV2LoginIllustrationBorderedLight,
  authV2LoginIllustrationBorderedDark,
  true
);

const authThemeMask = useGenerateImageVariant(authV2MaskLight, authV2MaskDark);

const clearActiveValidationAdvanceTimer = () => {
  if (activeValidationAdvanceTimer !== null) {
    window.clearTimeout(activeValidationAdvanceTimer);
    activeValidationAdvanceTimer = null;
  }
};

const initActiveValidationSubscription = async (
  validation: AuthForgotPasswordSendCodeResponse
) => {
  activeWhatsappValidation.cleanup();
  clearActiveValidationAdvanceTimer();

  try {
    await activeWhatsappValidation.subscribe(
      {
        centrifugoUrl: validation.centrifugo_url,
        centrifugoToken: validation.centrifugo_token,
        centrifugoChannel: validation.centrifugo_channel,
      },
      (payload) => {
        if (payload.context !== 'forgot_password') return;

        if (payload.status === 'validated' && payload.token) {
          resetPasswordToken.value = payload.token;
          activeValidationStatus.value = 'validated';
          activeValidationRejectionReason.value = null;
          activeWhatsappValidation.cleanup();
          clearActiveValidationAdvanceTimer();
          activeValidationAdvanceTimer = window.setTimeout(() => {
            currentStep.value = 2;
          }, 1200);
          return;
        }

        if (payload.status === 'rejected') {
          activeValidationRejectionReason.value = payload.reason ?? null;

          if (isRecoverableActiveValidationReason(payload.reason)) {
            activeValidationStatus.value = 'waiting';
            return;
          }

          activeValidationStatus.value = 'rejected';
          activeWhatsappValidation.cleanup();
          authStore.showSnackbar(
            $t('active_whatsapp_validation_rejected_description'),
            EColor.error
          );
        }
      }
    );
  } catch (error) {
    activeValidationStatus.value = 'rejected';
    activeValidationRejectionReason.value = 'connection_error';
    if (import.meta.env.DEV) {
      console.error('Erro ao conectar validação ativa:', error);
    }
  }
};

const handleSendCode = async () => {
  const validateForm = await refFormEmail?.value?.validate();
  if (!validateForm?.valid) return;

  isSendingCode.value = true;

  try {
    const response = await authStore.forgotPasswordSendCode({
      email: email.value.trim(),
    });

    if (response) {
      activeValidation.value = response;
      activeValidationStatus.value = 'waiting';
      activeValidationRejectionReason.value = null;
      currentStep.value = 1;
      await initActiveValidationSubscription(response);
    }
  } finally {
    isSendingCode.value = false;
  }
};

const backToEmailStep = () => {
  activeWhatsappValidation.cleanup();
  clearActiveValidationAdvanceTimer();
  activeValidation.value = null;
  activeValidationStatus.value = 'waiting';
  activeValidationRejectionReason.value = null;
  currentStep.value = 0;
};

const handleResetPassword = async (): Promise<boolean> => {
  const validateForm = await refFormPassword?.value?.validate();
  if (!validateForm?.valid || !resetPasswordToken.value) {
    return false;
  }

  isResettingPassword.value = true;

  try {
    const loginData = await authStore.forgotPasswordResetPassword(
      resetPasswordToken.value,
      {
        new_password: newPassword.value,
        confirm_password: confirmPassword.value,
      }
    );

    if (!loginData) {
      return false;
    }

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

    return true;
  } catch (error) {
    console.error('Erro ao redefinir senha:', error);
    return false;
  } finally {
    isResettingPassword.value = false;
  }
};

const passwordRules = [
  (v: string | null) => requiredValidator(v, $t('password_required')),
  (v: string | null) => {
    if (!v) return true;
    const validation = validatePassword(v);
    if (validation.isValid) return true;
    return validation.errors.map((err) => $t(err)).join(', ');
  },
];

const confirmPasswordRules = [
  (v: string | null) =>
    !newPassword.value || !!v || $t('confirm_password_required'),
  (v: string | null) =>
    confirmedValidator(
      v || '',
      newPassword.value || '',
      $t('passwords_do_not_match')
    ) === true || $t('passwords_do_not_match'),
];

onBeforeUnmount(() => {
  activeWhatsappValidation.cleanup();
  clearActiveValidationAdvanceTimer();
});
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
    <VCol
      :md="currentStep === 1 || currentStep === 2 ? 6 : 8"
      class="d-none d-md-flex"
    >
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
      :md="currentStep === 1 || currentStep === 2 ? 6 : 4"
      class="auth-card-v2 d-flex align-center justify-center"
      :class="{ 'auth-card-v2--code': currentStep === 1 || currentStep === 2 }"
    >
      <VCard
        flat
        :max-width="currentStep === 1 || currentStep === 2 ? 700 : 500"
        class="mt-12 mt-sm-0 pa-6"
        :class="{ 'w-100': currentStep === 1 || currentStep === 2 }"
      >
        <VCardText v-if="currentStep === 0">
          <h4 class="text-h4 mb-1">
            {{ $t('forgot_password_title') }}
          </h4>
          <p class="mb-6">
            {{ $t('forgot_password_description') }}
          </p>
          <VForm ref="refFormEmail" @submit.prevent>
            <VRow>
              <VCol cols="12">
                <VLabel class="text-body-2 mb-1">{{ $t('email') }}:</VLabel>
                <AppTextField
                  v-model="email"
                  autofocus
                  type="email"
                  placeholder="email@email.com"
                  :rules="[
                    requiredValidator(email, $t('email_required')),
                    emailValidator,
                  ]"
                />
              </VCol>

              <VCol cols="12">
                <VBtn
                  block
                  type="submit"
                  @click="handleSendCode"
                  :loading="isSendingCode"
                  :disabled="isSendingCode"
                >
                  {{ $t('send_code') }}
                </VBtn>
                <VBtn
                  block
                  variant="text"
                  class="mt-4"
                  @click="router.push('/login')"
                >
                  {{ $t('back_to_login') }}
                </VBtn>
              </VCol>
            </VRow>
          </VForm>
        </VCardText>

        <VCardText v-else-if="currentStep === 1">
          <h4 class="text-h5 mb-1">
            {{ $t('verification_code') }}
          </h4>
          <p class="text-sm mb-6">
            {{ $t('forgot_password_code_description') }}
          </p>

          <VRow justify="center">
            <VCol cols="12" md="12">
              <ActiveWhatsappValidationCard
                v-if="activeValidation"
                :validation-text="activeValidation.validation_text"
                :whatsapp-url="activeValidation.whatsapp_url"
                :target-phone="activeValidation.target_phone"
                :status="activeValidationStatus"
                :rejection-reason="activeValidationRejectionReason"
              />
              <VAlert v-else type="info" variant="tonal">
                {{ $t('active_whatsapp_validation_prepare') }}
              </VAlert>
            </VCol>
          </VRow>

          <VBtn block variant="text" class="mt-4" @click="backToEmailStep">
            {{ $t('back') }}
          </VBtn>
        </VCardText>

        <VCardText v-else-if="currentStep === 2">
          <h4 class="text-h5 mb-1">
            {{ $t('reset_password') }}
          </h4>
          <p class="text-sm mb-6">
            {{ $t('reset_password_description') }}
          </p>

          <VForm ref="refFormPassword" @submit.prevent>
            <VRow>
              <VCol cols="12">
                <VLabel class="text-body-2 mb-1"
                  >{{ $t('new_password') }}:</VLabel
                >
                <AppTextField
                  v-model="newPassword"
                  autofocus
                  :type="isNewPasswordVisible ? 'text' : 'password'"
                  :placeholder="$t('new_password')"
                  autocapitalize="off"
                  autocorrect="off"
                  spellcheck="false"
                  :append-inner-icon="
                    isNewPasswordVisible ? 'tabler-eye-off' : 'tabler-eye'
                  "
                  :rules="passwordRules"
                  @click:append-inner="
                    isNewPasswordVisible = !isNewPasswordVisible
                  "
                />
              </VCol>

              <VCol cols="12">
                <VLabel class="text-body-2 mb-1"
                  >{{ $t('confirm_password') }}:</VLabel
                >
                <AppTextField
                  v-model="confirmPassword"
                  :type="isConfirmPasswordVisible ? 'text' : 'password'"
                  :placeholder="$t('confirm_password')"
                  autocapitalize="off"
                  autocorrect="off"
                  spellcheck="false"
                  :append-inner-icon="
                    isConfirmPasswordVisible ? 'tabler-eye-off' : 'tabler-eye'
                  "
                  :rules="confirmPasswordRules"
                  @click:append-inner="
                    isConfirmPasswordVisible = !isConfirmPasswordVisible
                  "
                />
              </VCol>

              <VCol cols="12">
                <VBtn
                  block
                  type="submit"
                  @click="handleResetPassword"
                  :loading="isResettingPassword"
                  :disabled="isResettingPassword"
                >
                  {{ $t('reset_password') }}
                </VBtn>
                <VBtn
                  block
                  variant="text"
                  class="mt-4"
                  @click="currentStep = 1"
                >
                  {{ $t('back') }}
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

.auth-card-v2--code {
  @media (min-width: 960px) {
    padding-left: 3rem;
    padding-right: 2rem;
  }
}

.otp-input-wrapper {
  width: 100%;
  display: flex;
  justify-content: center;
  margin-bottom: 1.25rem;
  overflow-x: auto;
  padding: 0 0.5rem;

  @media (max-width: 599px) {
    padding: 0;
  }
}

.otp-input-custom {
  width: 100%;
  max-width: 100%;
  display: flex;
  justify-content: center;

  .v-otp-input {
    gap: 0.5rem;
    width: 100%;
    max-width: 100%;
    display: flex;
    justify-content: center;
    flex-wrap: nowrap;

    @media (min-width: 600px) {
      gap: 0.75rem;
    }

    @media (min-width: 960px) {
      gap: 1rem;
    }
  }

  .v-otp-input__content {
    width: 100%;
    max-width: 100%;
    display: flex;
    justify-content: center;
    flex-wrap: nowrap;
    gap: inherit;
  }

  .v-field {
    border-radius: 12px;
    font-size: 1rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    width: 48px;
    min-width: 48px;
    max-width: 56px;
    height: 56px;
    background-color: rgb(var(--v-theme-surface));
    border: 1px solid rgb(var(--v-theme-primary) / 0.18);
    box-shadow: 0 10px 30px -18px rgb(var(--v-theme-on-surface) / 0.5);
    transition:
      transform 0.15s ease,
      box-shadow 0.2s ease,
      border-color 0.2s ease;
    flex-shrink: 1;
    flex-grow: 0;

    @media (min-width: 600px) {
      width: 56px;
      min-width: 56px;
      height: 64px;
      font-size: 1.1rem;
    }

    @media (min-width: 960px) {
      width: 60px;
      min-width: 60px;
      max-width: 60px;
      height: 68px;
    }

    .v-field__input {
      text-align: center;
      text-transform: uppercase;
      padding-block: 10px;
      width: 100%;
    }

    &.v-field--focused {
      transform: translateY(-2px);
      box-shadow: 0 14px 40px -18px rgb(var(--v-theme-primary) / 0.6);
      border-color: rgb(var(--v-theme-primary));

      .v-field__outline {
        border-width: 2px;
        border-color: rgb(var(--v-theme-primary)) !important;
      }
    }
  }
}

.otp-card {
  padding: 24px;
  background:
    linear-gradient(135deg, rgb(var(--v-theme-primary) / 0.1), transparent 60%),
    rgb(var(--v-theme-surface-variant));
  border-radius: 16px;
  border: 1px solid rgb(var(--v-theme-primary) / 0.14);
  box-shadow: 0 18px 60px -26px rgb(var(--v-theme-on-surface) / 0.4);
  position: relative;
  overflow: visible;

  @media (min-width: 600px) {
    padding: 28px;
  }

  &::after {
    content: '';
    position: absolute;
    inset-block-start: -40px;
    inset-inline-end: -40px;
    inline-size: 120px;
    block-size: 120px;
    background: radial-gradient(
      circle,
      rgb(var(--v-theme-primary) / 0.14),
      transparent 60%
    );
    filter: blur(12px);
    pointer-events: none;
  }
}

.otp-card__header {
  display: flex;
  align-items: center;
  gap: 12px;
  position: relative;
  z-index: 1;
}

.otp-card__badge {
  inline-size: 38px;
  block-size: 38px;
  border-radius: 10px;
  background: linear-gradient(
    135deg,
    rgb(var(--v-theme-primary)),
    rgb(var(--v-theme-primary) / 0.7)
  );
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgb(var(--v-theme-on-primary));
  flex-shrink: 0;
}

.otp-hint {
  text-align: center;
  margin-top: 0.5rem;
}
</style>
