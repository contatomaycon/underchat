<script setup lang="ts">
import { useGenerateImageVariant } from '@/@webcore/composable/useGenerateImageVariant';
import type { CustomInputContent } from '@/@webcore/types';
import { useCountryCodes } from '@/composables/useCountryCodes';
import { useBrazilianDDDs } from '@/composables/useBrazilianDDDs';
import { requiredValidator } from '@/@webcore/utils/validators';
import { VForm } from 'vuetify/components/VForm';
import axios, { AxiosError } from 'axios';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { EColor } from '@core/common/enums/EColor';

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

const radioContent: CustomInputContent[] = [
  {
    title: 'Starter',
    desc: 'A simple start for everyone.',
    value: '0',
  },
  {
    title: 'Standard',
    desc: 'For small to medium businesses.',
    value: '99',
  },
  {
    title: 'Enterprise',
    desc: 'Solution for big organizations.',
    value: '499',
  },
];

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
  {
    title: 'Personal',
    subtitle: 'Enter Information',
    icon: 'tabler-users',
  },
  {
    title: 'Billing',
    subtitle: 'Payment Details',
    icon: 'tabler-file-text',
  },
];

const name = ref<string | null>(null);
const email = ref<string | null>(null);
const phone_ddi = ref<string | null>('55');
const phone_ddd = ref<string | null>(null);
const phone = ref<string | null>(null);
const verificationCode = ref<string>('');
const isLoading = ref(false);
const snackbar = ref({
  show: false,
  message: '',
  color: EColor.success,
});

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

const canGoToStep = (step: number) => {
  return step <= maxStepReached.value;
};

const showSnackbar = (message: string, color: EColor = EColor.success) => {
  snackbar.value = {
    show: true,
    message,
    color,
  };
};

const handleRegister = async () => {
  hasTriedToValidate.value = true;

  if (!isValidationStepValid.value) {
    return;
  }

  isLoading.value = true;

  try {
    const url = import.meta.env.VITE_BACKEND_URL;
    const currentLocale = useCookie('language').value || 'pt';

    const response = await axios.post<
      IApiResponse<{ success: boolean; message: string }>
    >(
      `${url}/v1/register/send-two-factor`,
      {
        name: name.value?.trim() || '',
        email: email.value?.trim() || '',
        phone_ddi: phone_ddi.value,
        phone_ddd: phone_ddd.value,
        phone: phone.value?.replaceAll(/\D/g, '') || '',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': currentLocale,
        },
      }
    );

    const data = response?.data;

    if (data?.status) {
      showSnackbar(t('register_code_sent'), EColor.success);
      maxStepReached.value = 1;
      currentStep.value = 1;
    } else {
      showSnackbar(data?.message || t('register_error'), EColor.error);
    }
  } catch (error) {
    let errorMessage = t('register_error');
    if (error instanceof AxiosError) {
      errorMessage = error?.response?.data?.message || errorMessage;
    }
    showSnackbar(errorMessage, EColor.error);
  } finally {
    isLoading.value = false;
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

const form = ref({
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
  link: '',
  firstName: '',
  lastName: '',
  mobile: '',
  pincode: '',
  address: '',
  landmark: '',
  city: '',
  state: null,
  selectedPlan: '0',
  cardNumber: '',
  cardName: '',
  expiryDate: '',
  cvv: '',
});

const refFormValidation = ref<VForm>();

const onSubmit = () => {
  alert('Submitted..!!');
};
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
                <VCol cols="12">
                  <VLabel class="text-body-2 mb-1"
                    >{{ $t('verification_code') }}:</VLabel
                  >
                  <VOtpInput
                    v-model="verificationCode"
                    length="6"
                    type="text"
                    :rules="[
                      requiredValidator(
                        verificationCode,
                        $t('verification_code_required')
                      ),
                    ]"
                  />
                </VCol>
              </VRow>
            </VWindowItem>

            <VWindowItem>
              <h5 class="text-h5 mb-1">Personal Information</h5>
              <p class="text-sm">Enter Your Personal Information</p>

              <VRow>
                <VCol cols="12" md="6">
                  <AppTextField v-model="form.firstName" label="First Name" />
                </VCol>

                <VCol cols="12" md="6">
                  <AppTextField v-model="form.lastName" label="Last Name" />
                </VCol>

                <VCol cols="12" md="6">
                  <AppTextField
                    v-model="form.mobile"
                    type="number"
                    label="Mobile"
                  />
                </VCol>

                <VCol cols="12" md="6">
                  <AppTextField
                    v-model="form.pincode"
                    type="number"
                    label="Pincode"
                  />
                </VCol>

                <VCol cols="12">
                  <AppTextField v-model="form.address" label="Address" />
                </VCol>

                <VCol cols="12">
                  <AppTextField v-model="form.landmark" label="Landmark" />
                </VCol>

                <VCol cols="12" md="6">
                  <AppTextField v-model="form.city" label="City" />
                </VCol>

                <VCol cols="12" md="6">
                  <AppSelect
                    v-model="form.state"
                    label="State"
                    :items="[
                      'New York',
                      'California',
                      'Florida',
                      'Washington',
                      'Texas',
                    ]"
                  />
                </VCol>
              </VRow>
            </VWindowItem>

            <VWindowItem>
              <h5 class="text-h5">Select Plan</h5>
              <p class="text-sm">Select plan as per your requirement</p>

              <CustomRadiosWithIcon
                v-model:selected-radio="form.selectedPlan"
                :radio-content="radioContent"
                :grid-column="{ sm: '4', cols: '12' }"
              >
                <template #default="{ item }">
                  <div class="text-center">
                    <h5 class="text-h5">
                      {{ item.title }}
                    </h5>
                    <p class="clamp-text">
                      {{ item.desc }}
                    </p>

                    <div class="d-flex align-center justify-center">
                      <span class="text-primary mb-2">$</span>
                      <span class="text-h4 text-primary">
                        {{ item.value }}
                      </span>
                      <span class="mt-2">/month</span>
                    </div>
                  </div>
                </template>
              </CustomRadiosWithIcon>

              <h5 class="text-h5 mt-10">Payment Information</h5>
              <p class="text-sm">Enter your card information</p>

              <VRow>
                <VCol cols="12">
                  <AppTextField
                    v-model="form.cardNumber"
                    type="number"
                    label="Card Number"
                  />
                </VCol>

                <VCol cols="12" md="6">
                  <AppTextField v-model="form.cardName" label="Name on Card" />
                </VCol>

                <VCol cols="6" md="3">
                  <AppTextField v-model="form.expiryDate" label="Expiry" />
                </VCol>

                <VCol cols="6" md="3">
                  <AppTextField v-model="form.cvv" type="number" label="CVV" />
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
            Previous
          </VBtn>

          <VBtn
            v-if="items.length - 1 === currentStep"
            color="success"
            append-icon="tabler-check"
            @click="onSubmit"
          >
            submit
          </VBtn>

          <VBtn
            v-else
            :disabled="
              (currentStep === 0 && !isValidationStepValid) || isLoading
            "
            :loading="isLoading && currentStep === 0"
            @click="handleNext"
          >
            Next

            <VIcon icon="tabler-arrow-right" end class="flip-in-rtl" />
          </VBtn>
        </div>
      </VCard>

      <VSnackbar
        v-model="snackbar.show"
        :color="snackbar.color"
        :timeout="5000"
        location="top"
      >
        {{ snackbar.message }}
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
</style>

<route lang="yaml">
meta:
  layout: 'blank'
  public: true
  unauthenticatedOnly: true
</route>
