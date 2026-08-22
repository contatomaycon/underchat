<script setup lang="ts">
import { computed, shallowRef, useTemplateRef } from 'vue';
import type { VNode } from 'vue';
import { VForm } from 'vuetify/components/VForm';
import { useI18n } from 'vue-i18n';
import type { AuthForgotPasswordSendCodeResponse } from '@core/schema/auth/forgotPassword/sendCode/response.schema';
import {
  confirmedValidator,
  emailValidator,
  requiredValidator,
} from '@/@webcore/utils/validators';
import { validatePassword } from '@/@webcore/utils/passwordStrength';
import ActiveWhatsappValidationCard from '@/components/auth/ActiveWhatsappValidationCard.vue';
import AuthMobileBrand from '@/components/auth/shared/AuthMobileBrand.vue';

type RecoveryStep = 0 | 1 | 2;
type ActiveValidationStatus = 'waiting' | 'validated' | 'rejected';

const props = defineProps<{
  activeValidation: AuthForgotPasswordSendCodeResponse | null;
  activeValidationRejectionReason: string | null;
  activeValidationStatus: ActiveValidationStatus;
  appTitle: string;
  currentStep: RecoveryStep;
  isResettingPassword: boolean;
  isSendingCode: boolean;
  logo: VNode | VNode[];
}>();

const emit = defineEmits<{
  backToEmail: [];
  resetPassword: [];
  restart: [];
  sendCode: [];
}>();

const email = defineModel<string>('email', { required: true });
const newPassword = defineModel<string>('newPassword', { required: true });
const confirmPassword = defineModel<string>('confirmPassword', {
  required: true,
});

const { t } = useI18n();
const emailForm = useTemplateRef<InstanceType<typeof VForm>>('emailForm');
const passwordForm = useTemplateRef<InstanceType<typeof VForm>>('passwordForm');
const isNewPasswordVisible = shallowRef(false);
const isConfirmPasswordVisible = shallowRef(false);

const steps = computed(() => [
  { label: t('forgot_password_step_identity'), icon: 'tabler-mail' },
  {
    label: t('forgot_password_step_validation'),
    icon: 'tabler-brand-whatsapp',
  },
  { label: t('forgot_password_step_password'), icon: 'tabler-key' },
]);

const stepTitle = computed(() => {
  if (props.currentStep === 1) return t('verification_code');
  if (props.currentStep === 2) return t('reset_password');
  return t('forgot_password_form_title');
});

const stepDescription = computed(() => {
  if (props.currentStep === 1) {
    return t('forgot_password_code_description');
  }

  if (props.currentStep === 2) {
    return t('reset_password_description');
  }

  return t('forgot_password_form_description');
});

const stepIcon = computed(() => {
  if (props.currentStep === 1) return 'tabler-brand-whatsapp';
  if (props.currentStep === 2) return 'tabler-key';
  return 'tabler-lock-open';
});

const passwordRules = [
  (value: string | null) => requiredValidator(value, t('password_required')),
  (value: string | null) => {
    if (!value) return true;
    const validation = validatePassword(value);
    if (validation.isValid) return true;
    return validation.errors.map((error) => t(error)).join(', ');
  },
];

const confirmPasswordRules = [
  (value: string | null) =>
    !newPassword.value || !!value || t('confirm_password_required'),
  (value: string | null) =>
    confirmedValidator(
      value || '',
      newPassword.value || '',
      t('passwords_do_not_match')
    ) === true || t('passwords_do_not_match'),
];

function getStepState(index: number) {
  if (index < props.currentStep) return 'complete';
  if (index === props.currentStep) return 'active';
  return 'upcoming';
}

async function handleSendCode() {
  const validation = await emailForm.value?.validate();
  if (!validation?.valid) return;
  emit('sendCode');
}

async function handleResetPassword() {
  const validation = await passwordForm.value?.validate();
  if (!validation?.valid) return;
  emit('resetPassword');
}
</script>

<template>
  <div
    class="forgot-password-flow"
    :class="{ 'forgot-password-flow--wide': currentStep === 1 }"
  >
    <AuthMobileBrand :app-title="appTitle" :logo="logo" />

    <nav
      class="forgot-password-flow__progress"
      :aria-label="$t('forgot_password_progress_label')"
    >
      <ol class="forgot-password-flow__steps">
        <li
          v-for="(step, index) in steps"
          :key="step.label"
          class="forgot-password-flow__step"
          :class="`forgot-password-flow__step--${getStepState(index)}`"
          :aria-current="index === currentStep ? 'step' : undefined"
        >
          <span class="forgot-password-flow__step-icon">
            <VIcon
              v-if="getStepState(index) === 'complete'"
              icon="tabler-check"
              size="15"
            />
            <VIcon v-else :icon="step.icon" size="15" />
          </span>
          <span class="forgot-password-flow__step-label">
            {{ step.label }}
          </span>
        </li>
      </ol>
    </nav>

    <section :key="currentStep" class="forgot-password-flow__stage">
      <div class="forgot-password-flow__heading">
        <p class="forgot-password-flow__eyebrow">
          <VIcon :icon="stepIcon" size="16" />
          {{ $t('forgot_password_form_kicker') }}
        </p>

        <h2 class="forgot-password-flow__title">
          {{ stepTitle }}
        </h2>

        <p class="forgot-password-flow__description">
          {{ stepDescription }}
        </p>
      </div>

      <VForm
        v-if="currentStep === 0"
        ref="emailForm"
        class="forgot-password-flow__form"
        validate-on="submit"
        @submit.prevent="handleSendCode"
      >
        <div class="forgot-password-flow__field">
          <VLabel
            for="app-text-field-recovery-email"
            class="forgot-password-flow__label"
          >
            {{ $t('email') }}
          </VLabel>
          <AppTextField
            id="recovery-email"
            v-model="email"
            autofocus
            autocomplete="email"
            color="#0369D1"
            name="email"
            type="email"
            :placeholder="$t('login_email_placeholder')"
            prepend-inner-icon="tabler-mail"
            :rules="[
              requiredValidator(email, $t('email_required')),
              (value: string) => emailValidator(value, $t('email_invalid')),
            ]"
          />
        </div>

        <VBtn
          block
          class="forgot-password-flow__submit"
          color="#0369D1"
          size="large"
          type="submit"
          :loading="isSendingCode"
          :disabled="isSendingCode"
          append-icon="tabler-arrow-right"
        >
          {{ $t('send_code') }}
        </VBtn>

        <RouterLink class="forgot-password-flow__back-link" to="/login">
          <VIcon icon="tabler-arrow-left" size="17" />
          {{ $t('back_to_login') }}
        </RouterLink>
      </VForm>

      <div
        v-else-if="currentStep === 1"
        class="forgot-password-flow__validation"
      >
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

        <VBtn
          block
          class="forgot-password-flow__secondary-action"
          variant="text"
          prepend-icon="tabler-arrow-left"
          @click="emit('backToEmail')"
        >
          {{ $t('back') }}
        </VBtn>
      </div>

      <VForm
        v-else
        ref="passwordForm"
        class="forgot-password-flow__form"
        validate-on="submit"
        @submit.prevent="handleResetPassword"
      >
        <div class="forgot-password-flow__field">
          <VLabel
            for="app-text-field-new-password"
            class="forgot-password-flow__label"
          >
            {{ $t('new_password') }}
          </VLabel>
          <AppTextField
            id="new-password"
            v-model="newPassword"
            autofocus
            autocomplete="new-password"
            autocapitalize="off"
            autocorrect="off"
            color="#0369D1"
            name="new-password"
            placeholder="••••••••"
            prepend-inner-icon="tabler-key"
            spellcheck="false"
            :type="isNewPasswordVisible ? 'text' : 'password'"
            :rules="passwordRules"
          >
            <template #append-inner>
              <button
                class="forgot-password-flow__password-toggle"
                type="button"
                :aria-label="
                  isNewPasswordVisible
                    ? $t('login_hide_password')
                    : $t('login_show_password')
                "
                @click="isNewPasswordVisible = !isNewPasswordVisible"
              >
                <VIcon
                  :icon="isNewPasswordVisible ? 'tabler-eye-off' : 'tabler-eye'"
                  size="18"
                />
              </button>
            </template>
          </AppTextField>
        </div>

        <div class="forgot-password-flow__field">
          <VLabel
            for="app-text-field-confirm-password"
            class="forgot-password-flow__label"
          >
            {{ $t('confirm_password') }}
          </VLabel>
          <AppTextField
            id="confirm-password"
            v-model="confirmPassword"
            autocomplete="new-password"
            autocapitalize="off"
            autocorrect="off"
            color="#0369D1"
            name="confirm-password"
            placeholder="••••••••"
            prepend-inner-icon="tabler-lock-check"
            spellcheck="false"
            :type="isConfirmPasswordVisible ? 'text' : 'password'"
            :rules="confirmPasswordRules"
          >
            <template #append-inner>
              <button
                class="forgot-password-flow__password-toggle"
                type="button"
                :aria-label="
                  isConfirmPasswordVisible
                    ? $t('login_hide_password')
                    : $t('login_show_password')
                "
                @click="isConfirmPasswordVisible = !isConfirmPasswordVisible"
              >
                <VIcon
                  :icon="
                    isConfirmPasswordVisible ? 'tabler-eye-off' : 'tabler-eye'
                  "
                  size="18"
                />
              </button>
            </template>
          </AppTextField>
        </div>

        <VBtn
          block
          class="forgot-password-flow__submit"
          color="#0369D1"
          size="large"
          type="submit"
          :loading="isResettingPassword"
          :disabled="isResettingPassword"
          append-icon="tabler-arrow-right"
        >
          {{ $t('reset_password') }}
        </VBtn>

        <VBtn
          block
          class="forgot-password-flow__secondary-action"
          variant="text"
          prepend-icon="tabler-refresh"
          @click="emit('restart')"
        >
          {{ $t('forgot_password_start_over') }}
        </VBtn>
      </VForm>
    </section>
  </div>
</template>

<style scoped lang="scss">
.forgot-password-flow {
  --v-theme-primary: 3, 105, 209;

  inline-size: min(100%, 28rem);
  transition: inline-size 320ms ease;
}

.forgot-password-flow--wide {
  inline-size: min(100%, 42rem);
}

.forgot-password-flow__progress {
  margin-block-end: 2.5rem;
}

.forgot-password-flow__steps {
  display: grid;
  margin: 0;
  padding: 0;
  gap: 0;
  grid-template-columns: repeat(3, 1fr);
  list-style: none;
}

.forgot-password-flow__step {
  position: relative;
  display: flex;
  min-inline-size: 0;
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.4);
  gap: 0.45rem;
}

.forgot-password-flow__step:not(:last-child)::after {
  block-size: 1px;
  flex: 1;
  margin-inline: 0.55rem;
  background: rgba(var(--v-theme-on-surface), 0.12);
  content: '';
}

.forgot-password-flow__step--active,
.forgot-password-flow__step--complete {
  color: var(--auth-primary);
}

.forgot-password-flow__step--complete:not(:last-child)::after {
  background: rgba(var(--auth-primary-rgb), 0.45);
}

.forgot-password-flow__step-icon {
  display: grid;
  flex: 0 0 1.85rem;
  block-size: 1.85rem;
  border: 1px solid currentcolor;
  border-radius: 50%;
  inline-size: 1.85rem;
  place-items: center;
}

.forgot-password-flow__step--active .forgot-password-flow__step-icon {
  background: var(--auth-primary);
  box-shadow: 0 0 0 4px rgba(var(--auth-primary-rgb), 0.1);
  color: #fff;
}

.forgot-password-flow__step--complete .forgot-password-flow__step-icon {
  background: rgba(var(--auth-primary-rgb), 0.1);
}

.forgot-password-flow__step-label {
  overflow: hidden;
  font-size: 0.68rem;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.forgot-password-flow__stage {
  animation: recovery-stage-arrival 0.45s ease both;
}

.forgot-password-flow__eyebrow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 1.15rem;
  color: var(--auth-primary);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.forgot-password-flow__title {
  max-inline-size: 14ch;
  margin: 0;
  color: rgb(var(--v-theme-on-surface));
  font-size: clamp(2.2rem, 3.2vw, 3.1rem);
  font-weight: 700;
  letter-spacing: -0.055em;
  line-height: 1.03;
  text-wrap: balance;
}

.forgot-password-flow--wide .forgot-password-flow__title {
  max-inline-size: 18ch;
}

.forgot-password-flow__description {
  max-inline-size: 42rem;
  margin: 1rem 0 0;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.94rem;
  line-height: 1.62;
  text-wrap: pretty;
}

.forgot-password-flow__form,
.forgot-password-flow__validation {
  display: grid;
  gap: 1.25rem;
  margin-block-start: 2.35rem;
}

.forgot-password-flow__field {
  display: grid;
  gap: 0.55rem;
}

.forgot-password-flow__label {
  color: rgba(var(--v-theme-on-surface), 0.78);
  font-size: 0.8rem;
  font-weight: 650;
}

.forgot-password-flow__submit {
  min-block-size: 3.35rem;
  margin-block-start: 0.25rem;
  border-radius: 0.85rem;
  box-shadow: 0 12px 30px rgba(var(--auth-primary-rgb), 0.24);
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  text-transform: none;
}

.forgot-password-flow__back-link,
.forgot-password-flow__secondary-action {
  display: flex;
  align-items: center;
  justify-content: center;
  min-block-size: 2.5rem;
  color: var(--auth-primary);
  gap: 0.45rem;
  font-size: 0.8rem;
  font-weight: 650;
  text-decoration: none;
  text-transform: none;
}

.forgot-password-flow__password-toggle {
  display: grid;
  border: 0;
  block-size: 2rem;
  border-radius: 50%;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.58);
  cursor: pointer;
  inline-size: 2rem;
  place-items: center;
}

.forgot-password-flow__password-toggle:hover,
.forgot-password-flow__password-toggle:focus-visible {
  outline: none;
  background: rgba(var(--auth-primary-rgb), 0.1);
  color: var(--auth-primary);
}

:deep(.v-field) {
  border-radius: 0.85rem;
  background: rgba(var(--v-theme-surface), 0.82);
  transition:
    box-shadow 180ms ease,
    transform 180ms ease;
}

:deep(.v-field--focused) {
  box-shadow: 0 0 0 4px rgba(var(--auth-primary-rgb), 0.12);
  transform: translateY(-1px);
}

:deep(.active-validation-card) {
  border-color: rgba(var(--auth-primary-rgb), 0.15);
  border-radius: 1.15rem;
  padding: clamp(1rem, 2.5vw, 1.5rem);
  box-shadow: 0 18px 50px rgba(3, 45, 96, 0.1);
}

:deep(.active-validation-status),
:deep(.active-validation-status-icon),
:deep(.active-validation-message) {
  border-radius: 0.85rem;
}

@keyframes recovery-stage-arrival {
  from {
    opacity: 0;
    transform: translateY(12px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 599px) {
  .forgot-password-flow__progress {
    margin-block-end: 2rem;
  }

  .forgot-password-flow__step {
    align-items: flex-start;
    flex-direction: column;
  }

  .forgot-password-flow__step:not(:last-child)::after {
    position: absolute;
    inline-size: calc(100% - 2.5rem);
    inset-block-start: 0.9rem;
    inset-inline-start: 2.15rem;
  }

  .forgot-password-flow__step-label {
    max-inline-size: 5.75rem;
    white-space: normal;
  }

  .forgot-password-flow__title {
    font-size: 2.3rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .forgot-password-flow,
  .forgot-password-flow__stage {
    animation: none;
    transition: none;
  }
}
</style>
