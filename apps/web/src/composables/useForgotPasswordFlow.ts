import { nextTick, onBeforeUnmount, readonly, shallowRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useTheme } from 'vuetify';
import type { AuthForgotPasswordSendCodeResponse } from '@core/schema/auth/forgotPassword/sendCode/response.schema';
import { EColor } from '@core/common/enums/EColor';
import { useAuthStore } from '@webcore/stores/auth';
import { useChatStore } from '@webcore/stores/chat';
import { useConfigStore } from '@webcore/stores/config';
import { useLayoutConfigStore } from '@layouts/stores/config';
import { resetConnection } from '@webcore/centrifugo';
import { resetPresencePermissionError } from '@webcore/presence';
import { applyLayoutTheme } from '@/@webcore/utils/applyLayoutTheme';
import { ability } from '@/plugins/0.casl/ability';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { useActiveWhatsappValidation } from '@/composables/useActiveWhatsappValidation';

type RecoveryStep = 0 | 1 | 2;
type ActiveValidationStatus = 'waiting' | 'validated' | 'rejected';

const recoverableActiveValidationReasons = new Set([
  'phone_mismatch',
  'worker_mismatch',
]);

function isRecoverableActiveValidationReason(
  reason: string | null | undefined
): boolean {
  return !!reason && recoverableActiveValidationReasons.has(reason);
}

export function useForgotPasswordFlow() {
  const { t } = useI18n();
  const route = useRoute();
  const router = useRouter();
  const authStore = useAuthStore();
  const chatStore = useChatStore();
  const configStore = useConfigStore();
  const layoutStore = useLayoutConfigStore();
  const vuetifyTheme = useTheme();
  const activeWhatsappValidation = useActiveWhatsappValidation();

  useSnackbarCleanup(authStore);
  useSnackbarCleanup(chatStore);

  const currentStep = shallowRef<RecoveryStep>(0);
  const email = shallowRef('');
  const newPassword = shallowRef('');
  const confirmPassword = shallowRef('');
  const isSendingCode = shallowRef(false);
  const isResettingPassword = shallowRef(false);
  const resetPasswordToken = shallowRef<string | null>(null);
  const activeValidation =
    shallowRef<AuthForgotPasswordSendCodeResponse | null>(null);
  const activeValidationStatus = shallowRef<ActiveValidationStatus>('waiting');
  const activeValidationRejectionReason = shallowRef<string | null>(null);

  let activeValidationAdvanceTimer: number | null = null;
  let activeValidationSubscriptionVersion = 0;

  function clearActiveValidationAdvanceTimer() {
    if (activeValidationAdvanceTimer === null) return;
    window.clearTimeout(activeValidationAdvanceTimer);
    activeValidationAdvanceTimer = null;
  }

  function invalidateActiveValidationSubscription() {
    activeValidationSubscriptionVersion += 1;
    activeWhatsappValidation.cleanup();
    clearActiveValidationAdvanceTimer();
  }

  async function initActiveValidationSubscription(
    validation: AuthForgotPasswordSendCodeResponse
  ) {
    invalidateActiveValidationSubscription();
    const subscriptionVersion = activeValidationSubscriptionVersion;

    try {
      await activeWhatsappValidation.subscribe(
        {
          centrifugoUrl: validation.centrifugo_url,
          centrifugoToken: validation.centrifugo_token,
          centrifugoChannel: validation.centrifugo_channel,
        },
        (payload) => {
          if (
            subscriptionVersion !== activeValidationSubscriptionVersion ||
            payload.context !== 'forgot_password'
          ) {
            return;
          }

          if (payload.status === 'validated' && payload.token) {
            resetPasswordToken.value = payload.token;
            activeValidationStatus.value = 'validated';
            activeValidationRejectionReason.value = null;
            activeWhatsappValidation.cleanup();
            clearActiveValidationAdvanceTimer();
            activeValidationAdvanceTimer = window.setTimeout(() => {
              if (subscriptionVersion === activeValidationSubscriptionVersion) {
                currentStep.value = 2;
              }
            }, 1200);
            return;
          }

          if (payload.status !== 'rejected') return;

          activeValidationRejectionReason.value = payload.reason ?? null;

          if (isRecoverableActiveValidationReason(payload.reason)) {
            activeValidationStatus.value = 'waiting';
            return;
          }

          activeValidationStatus.value = 'rejected';
          activeWhatsappValidation.cleanup();
          authStore.showSnackbar(
            t('active_whatsapp_validation_rejected_description'),
            EColor.error
          );
        }
      );
    } catch (error) {
      if (subscriptionVersion !== activeValidationSubscriptionVersion) return;

      activeValidationStatus.value = 'rejected';
      activeValidationRejectionReason.value = 'connection_error';

      if (import.meta.env.DEV) {
        console.error('Erro ao conectar validação ativa:', error);
      }
    }
  }

  async function sendCode() {
    isSendingCode.value = true;

    try {
      const response = await authStore.forgotPasswordSendCode({
        email: email.value.trim(),
      });

      if (!response) return;

      activeValidation.value = response;
      activeValidationStatus.value = 'waiting';
      activeValidationRejectionReason.value = null;
      currentStep.value = 1;
      await initActiveValidationSubscription(response);
    } finally {
      isSendingCode.value = false;
    }
  }

  function restartRecovery() {
    invalidateActiveValidationSubscription();
    activeValidation.value = null;
    activeValidationStatus.value = 'waiting';
    activeValidationRejectionReason.value = null;
    resetPasswordToken.value = null;
    newPassword.value = '';
    confirmPassword.value = '';
    currentStep.value = 0;
  }

  async function resetPassword(): Promise<boolean> {
    if (!resetPasswordToken.value) return false;

    isResettingPassword.value = true;

    try {
      const loginData = await authStore.forgotPasswordResetPassword(
        resetPasswordToken.value,
        {
          new_password: newPassword.value,
          confirm_password: confirmPassword.value,
        }
      );

      if (!loginData) return false;

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

      const userAbilityRules = authStore.permissions.map((permission) => ({
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
  }

  onBeforeUnmount(() => {
    invalidateActiveValidationSubscription();
  });

  return {
    activeValidation: readonly(activeValidation),
    activeValidationRejectionReason: readonly(activeValidationRejectionReason),
    activeValidationStatus: readonly(activeValidationStatus),
    authStore,
    confirmPassword,
    currentStep: readonly(currentStep),
    email,
    isResettingPassword: readonly(isResettingPassword),
    isSendingCode: readonly(isSendingCode),
    newPassword,
    resetPassword,
    restartRecovery,
    sendCode,
  };
}
