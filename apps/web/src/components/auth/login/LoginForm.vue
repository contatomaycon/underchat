<script setup lang="ts">
import { reactive, shallowRef, useTemplateRef } from 'vue';
import type { VNode } from 'vue';
import { VForm } from 'vuetify/components/VForm';
import AuthMobileBrand from '@/components/auth/shared/AuthMobileBrand.vue';

interface LoginCredentials {
  login: string;
  password: string;
}

defineProps<{
  appTitle: string;
  isLoading: boolean;
  logo: VNode | VNode[];
}>();

const emit = defineEmits<{
  submit: [credentials: LoginCredentials];
}>();

const loginForm = useTemplateRef<InstanceType<typeof VForm>>('loginForm');
const credentials = reactive<LoginCredentials>({
  login: '',
  password: '',
});
const isPasswordVisible = shallowRef(false);

async function handleSubmit() {
  const validation = await loginForm.value?.validate();

  if (!validation?.valid) return;

  emit('submit', {
    login: credentials.login.trim(),
    password: credentials.password,
  });
}
</script>

<template>
  <div class="login-form">
    <AuthMobileBrand :app-title="appTitle" :logo="logo" />

    <div class="login-form__heading">
      <p class="login-form__eyebrow">
        <VIcon icon="tabler-lock" size="16" />
        {{ $t('login_form_kicker') }}
      </p>

      <h2 class="login-form__title">
        {{ $t('login_form_title') }}
      </h2>

      <p class="login-form__subtitle">
        {{ $t('login_form_subtitle') }}
      </p>
    </div>

    <VForm
      ref="loginForm"
      class="login-form__fields"
      validate-on="submit"
      @submit.prevent="handleSubmit"
    >
      <div class="login-form__field">
        <VLabel for="app-text-field-login-email" class="login-form__label">
          {{ $t('email') }}
        </VLabel>
        <AppTextField
          id="login-email"
          v-model="credentials.login"
          autofocus
          autocomplete="username"
          color="#0369D1"
          name="email"
          type="text"
          :placeholder="$t('login_email_placeholder')"
          prepend-inner-icon="tabler-mail"
          :rules="[requiredValidator(credentials.login, $t('email_required'))]"
        />
      </div>

      <div class="login-form__field">
        <div class="login-form__label-row">
          <VLabel for="app-text-field-login-password" class="login-form__label">
            {{ $t('password') }}
          </VLabel>

          <RouterLink class="login-form__forgot-link" to="/forgot-password">
            {{ $t('forgot_password') }}
          </RouterLink>
        </div>

        <AppTextField
          id="login-password"
          v-model="credentials.password"
          autocomplete="current-password"
          color="#0369D1"
          name="password"
          placeholder="••••••••"
          prepend-inner-icon="tabler-key"
          :type="isPasswordVisible ? 'text' : 'password'"
          :rules="[
            requiredValidator(credentials.password, $t('password_required')),
          ]"
        >
          <template #append-inner>
            <button
              class="login-form__password-toggle"
              type="button"
              :aria-label="
                isPasswordVisible
                  ? $t('login_hide_password')
                  : $t('login_show_password')
              "
              @click="isPasswordVisible = !isPasswordVisible"
            >
              <VIcon
                :icon="isPasswordVisible ? 'tabler-eye-off' : 'tabler-eye'"
                size="18"
              />
            </button>
          </template>
        </AppTextField>
      </div>

      <VBtn
        block
        class="login-form__submit"
        color="#0369D1"
        size="large"
        type="submit"
        :loading="isLoading"
        :disabled="isLoading"
        append-icon="tabler-arrow-right"
      >
        {{ $t('login') }}
      </VBtn>
    </VForm>

    <div class="login-form__security">
      <VIcon icon="tabler-shield-check" size="18" />
      <span>{{ $t('login_security_note') }}</span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.login-form {
  inline-size: min(100%, 28rem);
}

.login-form__heading {
  animation: form-content-arrival 0.65s 0.12s ease both;
}

.login-form__eyebrow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 1.25rem;
  color: var(--auth-primary);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.login-form__title {
  max-inline-size: 12ch;
  margin: 0;
  color: rgb(var(--v-theme-on-surface));
  font-size: clamp(2.35rem, 3.4vw, 3.25rem);
  font-weight: 700;
  letter-spacing: -0.055em;
  line-height: 1.02;
  text-wrap: balance;
}

.login-form__subtitle {
  max-inline-size: 37ch;
  margin: 1.1rem 0 0;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.96rem;
  line-height: 1.65;
}

.login-form__fields {
  display: grid;
  gap: 1.3rem;
  margin-block-start: 2.6rem;
  animation: form-content-arrival 0.65s 0.22s ease both;
}

.login-form__field {
  display: grid;
  gap: 0.55rem;
}

.login-form__label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.login-form__label {
  color: rgba(var(--v-theme-on-surface), 0.78);
  font-size: 0.8rem;
  font-weight: 650;
}

.login-form__forgot-link {
  color: var(--auth-primary);
  font-size: 0.78rem;
  font-weight: 650;
  text-decoration: none;
  transition: color 180ms ease;
}

.login-form__forgot-link:hover {
  color: var(--auth-primary-strong);
}

.login-form__password-toggle {
  display: grid;
  border: 0;
  block-size: 2rem;
  border-radius: 50%;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.58);
  cursor: pointer;
  inline-size: 2rem;
  place-items: center;
  transition:
    background-color 180ms ease,
    color 180ms ease;
}

.login-form__password-toggle:hover,
.login-form__password-toggle:focus-visible {
  outline: none;
  background: rgba(var(--auth-primary-rgb), 0.1);
  color: var(--auth-primary);
}

.login-form__submit {
  min-block-size: 3.35rem;
  margin-block-start: 0.4rem;
  border-radius: 0.85rem;
  box-shadow: 0 12px 30px rgba(var(--auth-primary-rgb), 0.24);
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  text-transform: none;
  transition:
    box-shadow 180ms ease,
    transform 180ms ease;
}

.login-form__submit:hover {
  box-shadow: 0 16px 34px rgba(var(--auth-primary-rgb), 0.32);
  transform: translateY(-1px);
}

.login-form__security {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-block-start: 2rem;
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.73rem;
  animation: form-content-arrival 0.65s 0.32s ease both;
}

:deep(.app-text-field .v-field),
:deep(.v-field) {
  border-radius: 0.85rem;
  background: rgba(var(--v-theme-surface), 0.82);
  box-shadow: 0 1px 0 rgba(var(--v-theme-on-surface), 0.02);
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease,
    transform 180ms ease;
}

:deep(.v-field--focused) {
  box-shadow: 0 0 0 4px rgba(var(--auth-primary-rgb), 0.12);
  transform: translateY(-1px);
}

:deep(.v-field__prepend-inner) {
  color: rgba(var(--v-theme-on-surface), 0.42);
}

:deep(.v-input__details) {
  padding-inline: 0.25rem;
}

@keyframes form-content-arrival {
  from {
    opacity: 0;
    transform: translateY(14px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 599px) {
  .login-form__title {
    font-size: 2.4rem;
  }

  .login-form__fields {
    margin-block-start: 2.2rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .login-form__heading,
  .login-form__fields,
  .login-form__security {
    animation: none;
  }

  .login-form__submit {
    transition: none;
  }
}
</style>
