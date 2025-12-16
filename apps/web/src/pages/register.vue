<script setup lang="ts">
import { useGenerateImageVariant } from '@/@webcore/composable/useGenerateImageVariant';
import { useCountryCodes } from '@/composables/useCountryCodes';
import { useBrazilianDDDs } from '@/composables/useBrazilianDDDs';
import { requiredValidator } from '@/@webcore/utils/validators';
import { VForm } from 'vuetify/components/VForm';
import { useRegisterStore } from '@/@webcore/stores/register';
import registerMultistepIllustrationDark from '@images/illustrations/register-multi-step-illustration-dark.png';
import registerMultistepIllustrationLight from '@images/illustrations/register-multi-step-illustration-light.png';
import registerMultistepBgDark from '@images/pages/register-multi-step-bg-dark.png';
import registerMultistepBgLight from '@images/pages/register-multi-step-bg-light.png';

const registerMultistepBg = useGenerateImageVariant(
  registerMultistepBgLight,
  registerMultistepBgDark
);

const { t } = useI18n();
const { items: countryCodes } = useCountryCodes();
const { items: brazilianDDDs } = useBrazilianDDDs();
const registerStore = useRegisterStore();

const currentStepInternal = ref(0);

const currentStep = computed({
  get: () => currentStepInternal.value,
  set: (value: number) => {
    if (canGoToStep(value)) {
      currentStepInternal.value = value;
      if (value > maxStepReached.value) {
        maxStepReached.value = value;
      }
    } else {
      currentStepInternal.value = maxStepReached.value;
    }
  },
});

const registerMultistepIllustration = useGenerateImageVariant(
  registerMultistepIllustrationLight,
  registerMultistepIllustrationDark
);

const items = [
  {
    title: t('validation'),
    subtitle: t('validation_subtitle'),
    icon: 'tabler-device-mobile',
  },
  {
    title: t('verification_code'),
    subtitle: t('verification_code_subtitle'),
    icon: 'tabler-key',
  },
];

const name = ref<string | null>(null);
const email = ref<string | null>(null);
const phone_ddi = ref<string | null>('55');
const phone_ddd = ref<string | null>(null);
const phone = ref<string | null>(null);
const verificationCode = ref<string>('');

const showDDDField = computed(() => phone_ddi.value === '55');

const hasTriedToValidate = ref(false);

const isValidationStepValid = computed(() => {
  if (!name.value || name.value.trim().length === 0) return false;
  if (!email.value || email.value.trim().length === 0) return false;
  if (!phone_ddi.value) return false;
  if (!phone.value || phone.value.trim().length === 0) return false;
  if (showDDDField.value && !phone_ddd.value) return false;
  const emailValidationResult = emailValidator(email.value);
  if (emailValidationResult !== true) return false;
  return true;
});

const shouldShowValidationError = computed(() => {
  if (!hasTriedToValidate.value) return undefined;
  return isValidationStepValid.value;
});

const maxStepReached = ref(0);

watch(phone_ddi, (newValue) => {
  if (newValue !== '55') {
    phone_ddd.value = null;
  }
});

watch(isValidationStepValid, (isValid) => {
  if (isValid && maxStepReached.value === 0) {
    maxStepReached.value = 1;
  }
});

watch(verificationCode, (newValue) => {
  if (newValue && newValue !== newValue.toUpperCase()) {
    verificationCode.value = newValue.toUpperCase();
  }

  if (newValue && newValue.length === 6) {
    handleVerifyCode();
  }
});

const handleVerifyCode = async () => {
  if (!verificationCode.value || verificationCode.value.length !== 6) {
    return;
  }

  const success = await registerStore.verifyCode({
    code: verificationCode.value,
  });

  if (success) {
    maxStepReached.value = 1;
  } else {
    verificationCode.value = '';
  }
};

const canGoToStep = (step: number) => {
  return step <= maxStepReached.value;
};

const handleRegister = async () => {
  hasTriedToValidate.value = true;

  if (!isValidationStepValid.value) {
    return;
  }

  const success = await registerStore.sendTwoFactor({
    name: name.value?.trim() || '',
    email: email.value?.trim() || '',
    phone_ddi: phone_ddi.value || '',
    phone_ddd: phone_ddd.value || undefined,
    phone: phone.value?.replaceAll(/\D/g, '') || '',
  });

  if (success) {
    maxStepReached.value = 1;
    currentStep.value = 1;
  }
};

const handleNext = () => {
  if (currentStep.value === 0) {
    handleRegister();
    return;
  }
  if (currentStep.value < items.length - 1) {
    const nextStep = currentStep.value + 1;
    currentStep.value = nextStep;
  }
};

function formatPhone(value: string | null | undefined): string {
  if (!value) return '';

  const numbers = value.replaceAll(/\D/g, '');
  const isBrazil = phone_ddi.value === '55';

  if (isBrazil) {
    const maxLength = 9;
    const digits = numbers.slice(0, maxLength);

    if (digits.length <= 4) {
      return digits;
    }
    if (digits.length <= 8) {
      return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    }
    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }

  const maxLength = 15;
  const digits = numbers.slice(0, maxLength);

  if (digits.length <= 4) {
    return digits;
  }
  if (digits.length <= 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  }
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

const phoneFormatted = computed({
  get: () => formatPhone(phone.value),
  set: (value: string) => {
    phone.value = value.replaceAll(/\D/g, '');
  },
});

const emailValidator = (v: string | null | undefined) => {
  const s = (v ?? '').trim();
  if (!s) return true;
  const re = /^[^\s@]+@(?:[^\s@.]+\.)+[^\s@.]{2,}$/;
  return re.test(s) || t('email_invalid');
};

const refFormValidation = ref<VForm>();
</script>

<template>
  <VRow no-gutters class="auth-wrapper">
    <VCol md="4" class="d-none d-md-flex">
      <!-- here your illustration -->
      <div class="d-flex justify-center align-center w-100 position-relative">
        <VImg :src="registerMultistepIllustration" class="illustration-image" />
        <VImg
          :src="registerMultistepBg"
          class="bg-image position-absolute w-100"
        />
      </div>
    </VCol>

    <VCol
      cols="12"
      md="8"
      class="auth-card-v2 d-flex align-center justify-center pa-10"
      style="background-color: rgb(var(--v-theme-surface))"
    >
      <VCard flat class="mt-12 mt-sm-0">
        <AppStepper
          v-model:current-step="currentStep"
          :items="items"
          :direction="$vuetify.display.smAndUp ? 'horizontal' : 'vertical'"
          icon-size="24"
          :is-active-step-valid="
            currentStep === 0 ? shouldShowValidationError : undefined
          "
          class="stepper-icon-step-bg mb-8"
        />

        <VWindow
          v-model="currentStep"
          class="disable-tab-transition"
          style="max-width: 681px"
        >
          <VForm ref="refFormValidation">
            <VWindowItem>
              <h5 class="text-h5 mb-1">{{ $t('validation') }}</h5>
              <p class="text-sm mb-6">{{ $t('validation_description') }}</p>

              <VRow>
                <VCol cols="12" md="6">
                  <VLabel class="text-body-2 mb-1">{{ $t('name') }}:</VLabel>
                  <AppTextField
                    v-model="name"
                    type="text"
                    :placeholder="$t('name')"
                    :rules="[requiredValidator(name, $t('name_required'))]"
                  />
                </VCol>

                <VCol cols="12" md="6">
                  <VLabel class="text-body-2 mb-1">{{ $t('email') }}:</VLabel>
                  <AppTextField
                    v-model="email"
                    type="email"
                    :placeholder="$t('email')"
                    :rules="[
                      requiredValidator(email, $t('email_required')),
                      emailValidator,
                    ]"
                  />
                </VCol>

                <VCol cols="12" md="6">
                  <VLabel class="text-body-2 mb-1"
                    >{{ $t('phone_ddi') }}:</VLabel
                  >
                  <AppSelectSearch
                    v-model="phone_ddi"
                    :items="countryCodes"
                    :placeholder="$t('select_phone_ddi')"
                    item-value="value"
                    item-title="title"
                  />
                </VCol>

                <VCol v-if="showDDDField" cols="12" md="6">
                  <VLabel class="text-body-2 mb-1"
                    >{{ $t('phone_ddd') }}:</VLabel
                  >
                  <AppSelectSearch
                    v-model="phone_ddd"
                    :items="brazilianDDDs"
                    :placeholder="$t('select_phone_ddd')"
                    item-value="value"
                    item-title="title"
                  />
                </VCol>

                <VCol cols="12" :md="showDDDField ? 12 : 6">
                  <VLabel class="text-body-2 mb-1">{{ $t('phone') }}:</VLabel>
                  <AppTextField
                    v-model="phoneFormatted"
                    type="tel"
                    :placeholder="$t('phone')"
                    :maxlength="showDDDField ? 10 : 15"
                    :rules="[requiredValidator(phone, $t('phone_required'))]"
                  />
                </VCol>
              </VRow>
            </VWindowItem>

            <VWindowItem>
              <h5 class="text-h5 mb-1">{{ $t('verification_code') }}</h5>
              <p class="text-sm mb-6">
                {{ $t('verification_code_description') }}
              </p>

              <VRow>
                <VCol cols="12" class="d-flex flex-column align-center">
                  <VLabel class="text-body-2 mb-4 text-center">{{
                    $t('verification_code')
                  }}</VLabel>
                  <div class="otp-input-wrapper">
                    <VOtpInput
                      v-model="verificationCode"
                      length="6"
                      type="text"
                      variant="outlined"
                      density="comfortable"
                      class="otp-input-custom"
                      :rules="[
                        requiredValidator(
                          verificationCode,
                          $t('verification_code_required')
                        ),
                      ]"
                    />
                  </div>
                </VCol>
              </VRow>
            </VWindowItem>
          </VForm>
        </VWindow>

        <div class="d-flex justify-space-between mt-8">
          <VBtn
            color="secondary"
            :disabled="currentStep === 0"
            variant="tonal"
            @click="currentStep--"
          >
            <VIcon icon="tabler-arrow-left" start class="flip-in-rtl" />
            {{ $t('previous') }}
          </VBtn>

          <VBtn
            :disabled="
              (currentStep === 0 && !isValidationStepValid) ||
              registerStore.isLoading
            "
            :loading="registerStore.isLoading && currentStep === 0"
            @click="handleNext"
          >
            {{ $t('next') }}

            <VIcon icon="tabler-arrow-right" end class="flip-in-rtl" />
          </VBtn>
        </div>
      </VCard>

      <VSnackbar
        v-model="registerStore.snackbar.status"
        :color="registerStore.snackbar.color"
        :timeout="5000"
        location="top"
        @update:model-value="registerStore.hideSnackbar"
      >
        {{ registerStore.snackbar.message }}
      </VSnackbar>
    </VCol>
  </VRow>
</template>

<style lang="scss">
@use '@webcore/scss/template/pages/page-auth';

.illustration-image {
  block-size: 550px;
  inline-size: 248px;
}

.bg-image {
  inset-block-end: 0;
}

.otp-input-wrapper {
  width: 100%;
  display: flex;
  justify-content: center;
  margin-bottom: 1rem;
}

.otp-input-custom {
  .v-otp-input {
    gap: 0.75rem;
  }

  .v-field {
    border-radius: 8px;
    font-size: 1.25rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    min-width: 56px;
    height: 64px;

    .v-field__input {
      text-align: center;
      text-transform: uppercase;
    }

    &.v-field--focused {
      .v-field__outline {
        border-width: 2px;
        border-color: rgb(var(--v-theme-primary)) !important;
      }
    }
  }
}
</style>

<route lang="yaml">
meta:
  layout: 'blank'
  public: true
  unauthenticatedOnly: true
</route>
