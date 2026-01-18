<script setup lang="ts">
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAccountSettingsStore } from '@/@webcore/stores/accountSettings';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { requiredValidator } from '@/@webcore/utils/validators';
import { VForm } from 'vuetify/components/VForm';
import { ChangePasswordRequest } from '@core/schema/accountSettings/changePassword/request.schema';
import { EColor } from '@core/common/enums/EColor';
import { usePasswordStrength } from '@/composables/usePasswordStrength';
import { validatePassword } from '@/@webcore/utils/passwordStrength';

const { t } = useI18n();
const accountSettingsStore = useAccountSettingsStore();
useSnackbarCleanup(accountSettingsStore);

const refFormChangePassword = ref<VForm>();

const currentPassword = ref<string | null>(null);
const newPassword = ref<string | null>(null);
const confirmPassword = ref<string | null>(null);

const isCurrentPasswordVisible = ref(false);
const isNewPasswordVisible = ref(false);
const isConfirmPasswordVisible = ref(false);

const currentPasswordAutocomplete = computed(() =>
  isCurrentPasswordVisible.value ? undefined : 'current-password'
);

const newPasswordAutocomplete = computed(() =>
  isNewPasswordVisible.value ? undefined : 'new-password'
);

const confirmPasswordAutocomplete = computed(() =>
  isConfirmPasswordVisible.value ? undefined : 'new-password'
);

const {
  strength: passwordStrength,
  strengthColor,
  strengthLabel,
  strengthPercentage,
} = usePasswordStrength(() => newPassword.value);

const passwordRules = [
  (v: string | null) => requiredValidator(v, t('password_required')),
  (v: string | null) => {
    if (!v) return true;
    const validation = validatePassword(v);
    if (validation.isValid) return true;
    return validation.errors.map((err) => t(err)).join(', ');
  },
];

const confirmPasswordRules = [
  (v: string | null) => !newPassword.value || !!v || t('confirm_password'),
  (v: string | null) =>
    !newPassword.value ||
    v === newPassword.value ||
    t('the_password_do_not_match'),
];

const resetForm = () => {
  currentPassword.value = null;
  newPassword.value = null;
  confirmPassword.value = null;
  refFormChangePassword.value?.resetValidation();
};

const handleChangePassword = async () => {
  const isValid = await refFormChangePassword.value?.validate();
  if (!isValid) {
    return;
  }

  if (!currentPassword.value || !newPassword.value || !confirmPassword.value) {
    return;
  }

  const validation = validatePassword(newPassword.value);
  if (!validation.isValid) {
    accountSettingsStore.showSnackbar(
      t('password_does_not_meet_requirements'),
      EColor.error
    );
    return;
  }

  const body: ChangePasswordRequest = {
    current_password: currentPassword.value,
    new_password: newPassword.value,
  };

  const result = await accountSettingsStore.changePassword(body);

  if (result) {
    resetForm();
  }
};
</script>

<template>
  <div>
    <VCard variant="elevated" class="account-settings-card">
      <VCardTitle class="text-h6 pa-6 pb-4">
        {{ $t('change_password') }}
      </VCardTitle>
      <VDivider />
      <VCardText>
        <template v-if="accountSettingsStore.loading && !currentPassword && !newPassword && !confirmPassword">
          <VRow>
            <VCol cols="12">
              <VSkeletonLoader
                type="text"
                width="140"
                height="20"
                class="mb-1"
              />
              <VSkeletonLoader type="text" height="48" />
            </VCol>
          </VRow>
          <VRow>
            <VCol cols="12" md="6">
              <VSkeletonLoader
                type="text"
                width="120"
                height="20"
                class="mb-1"
              />
              <VSkeletonLoader type="text" height="48" />
              <VSkeletonLoader
                type="text"
                width="100"
                height="20"
                class="mt-2"
              />
              <VSkeletonLoader type="text" width="100%" height="4" />
            </VCol>
            <VCol cols="12" md="6">
              <VSkeletonLoader
                type="text"
                width="160"
                height="20"
                class="mb-1"
              />
              <VSkeletonLoader type="text" height="48" />
            </VCol>
          </VRow>
          <VRow class="mt-2">
            <VCol cols="12">
              <VSkeletonLoader
                type="text"
                width="180"
                height="20"
                class="mb-2"
              />
              <VSkeletonLoader type="text" width="100%" height="20" />
              <VSkeletonLoader type="text" width="90%" height="20" />
              <VSkeletonLoader type="text" width="85%" height="20" />
            </VCol>
          </VRow>
          <VRow class="mt-4">
            <VCol cols="12" class="d-flex gap-3">
              <VSkeletonLoader type="button" width="100" height="36" />
              <VSkeletonLoader type="button" width="140" height="36" />
            </VCol>
          </VRow>
        </template>
        <VForm
          v-else
          ref="refFormChangePassword"
          @submit.prevent="handleChangePassword"
        >
          <VRow>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('current_password') }}:</VLabel
              >
              <AppTextField
                v-model="currentPassword"
                :placeholder="$t('current_password')"
                :type="isCurrentPasswordVisible ? 'text' : 'password'"
                :autocomplete="currentPasswordAutocomplete"
                autocapitalize="off"
                autocorrect="off"
                spellcheck="false"
                :append-inner-icon="
                  isCurrentPasswordVisible ? 'tabler-eye-off' : 'tabler-eye'
                "
                :rules="[
                  requiredValidator(
                    currentPassword,
                    $t('current_password_required')
                  ),
                ]"
                @click:append-inner="
                  isCurrentPasswordVisible = !isCurrentPasswordVisible
                "
              />
            </VCol>
          </VRow>

          <VRow>
            <VCol cols="12" md="6">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('new_password') }}:</VLabel
              >
              <AppTextField
                v-model="newPassword"
                :placeholder="$t('new_password')"
                :type="isNewPasswordVisible ? 'text' : 'password'"
                :autocomplete="newPasswordAutocomplete"
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
              <div v-if="newPassword" class="mt-2">
                <div class="d-flex align-center justify-space-between mb-1">
                  <span class="text-caption"
                    >{{ $t('password_strength') }}:</span
                  >
                  <span
                    class="text-caption font-weight-medium"
                    :class="`text-${strengthColor}`"
                  >
                    {{ strengthLabel }}
                  </span>
                </div>
                <VProgressLinear
                  :model-value="strengthPercentage"
                  :color="strengthColor"
                  height="4"
                  rounded
                />
              </div>
            </VCol>

            <VCol cols="12" md="6">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('confirm_new_password') }}:</VLabel
              >
              <AppTextField
                v-model="confirmPassword"
                :placeholder="$t('confirm_new_password')"
                :type="isConfirmPasswordVisible ? 'text' : 'password'"
                :autocomplete="confirmPasswordAutocomplete"
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
          </VRow>

          <VRow class="mt-2">
            <VCol cols="12">
              <div class="text-body-2 font-weight-medium mb-2">
                {{ $t('password_requirements') }}:
              </div>
              <ul class="text-body-2 pl-4" style="list-style-type: disc">
                <li>{{ $t('password_requirement_minimum_8_characters') }}</li>
                <li>{{ $t('password_requirement_lowercase') }}</li>
                <li>
                  {{ $t('password_requirement_number_symbol_or_whitespace') }}
                </li>
              </ul>
            </VCol>
          </VRow>

          <VRow class="mt-4">
            <VCol cols="12" class="d-flex gap-3">
              <VBtn variant="tonal" color="secondary" @click="resetForm">
                {{ $t('reset') }}
              </VBtn>
              <VBtn type="submit" :loading="accountSettingsStore.loading">
                {{ $t('save_changes') }}
              </VBtn>
            </VCol>
          </VRow>
        </VForm>
      </VCardText>
    </VCard>

    <VSnackbar
      v-model="accountSettingsStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="accountSettingsStore.snackbar.color"
    >
      {{ accountSettingsStore.snackbar.message }}
    </VSnackbar>
  </div>
</template>

<style scoped>
.account-settings-card {
  background-color: rgb(var(--v-theme-surface)) !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1) !important;
  border-radius: 8px;
}
</style>
