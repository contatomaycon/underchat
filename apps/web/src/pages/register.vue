<script setup lang="ts">
import { useGenerateImageVariant } from '@/@webcore/composable/useGenerateImageVariant';
import { useCountryCodes } from '@/composables/useCountryCodes';
import { useBrazilianDDDs } from '@/composables/useBrazilianDDDs';
import { useRegisterStatesAndCities } from '@/composables/useRegisterStatesAndCities';
import { usePasswordStrength } from '@/composables/usePasswordStrength';
import { requiredValidator } from '@/@webcore/utils/validators';
import { validatePassword } from '@/@webcore/utils/passwordStrength';
import { VForm } from 'vuetify/components/VForm';
import { useRegisterStore } from '@/@webcore/stores/register';
import { EUserDocumentType } from '@core/common/enums/EUserDocumentType';
import { ECountry } from '@core/common/enums/ECountry';
import { ViewRegisterZipcodeRequest } from '@core/schema/register/viewZipcode/request.schema';
import { ListRegisterPlanWithItemsResponse } from '@core/schema/register/listPlanWithItems/response.schema';
import { ListRegisterAvailableCrossSellResponse } from '@core/schema/register/listAvailableCrossSell/response.schema';
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
const {
  states,
  cities,
  filteredStates,
  filteredCities,
  loadStates,
  loadCities,
  clearCities,
} = useRegisterStatesAndCities();
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
  {
    title: t('data'),
    subtitle: t('data_subtitle'),
    icon: 'tabler-user',
  },
  {
    title: t('plans'),
    subtitle: t('plans_subtitle'),
    icon: 'tabler-package',
  },
  {
    title: t('payment'),
    subtitle: t('payment_subtitle'),
    icon: 'tabler-credit-card',
  },
];

const name = ref<string | null>(null);
const last_name = ref<string | null>(null);
const email = ref<string | null>(null);
const phone_ddi = ref<string | null>('55');
const phone_ddd = ref<string | null>(null);
const phone = ref<string | null>(null);
const verificationCode = ref<string>('');
const account_name = ref<string | null>(null);
const password = ref<string | null>(null);
const confirmPassword = ref<string | null>(null);
const user_document_type_id = ref<string | null>(null);
const document = ref<string | null>(null);
const birth_date = ref<string | null>(null);
const country_id = ref<number | null>(null);
const zip_code = ref<string | null>(null);
const address1 = ref<string | null>(null);
const address2 = ref<string | null>(null);
const city = ref<string | null>(null);
const state = ref<string | null>(null);
const state_id = ref<string | null>(null);
const city_id = ref<string | null>(null);
const district = ref<string | null>(null);
const isPasswordVisible = ref(false);
const isConfirmVisible = ref(false);
const isViewingZipcode = ref(false);

let timer: number | null = null;

const billingPeriod = ref<'monthly' | 'annual'>('monthly');
const plans = ref<ListRegisterPlanWithItemsResponse[]>([]);
const selectedPlanForCheckout = ref<ListRegisterPlanWithItemsResponse | null>(
  null
);
const availableCrossSells = ref<ListRegisterAvailableCrossSellResponse[]>([]);
const selectedAddons = ref<
  Array<{
    plan_cross_sell_id: string;
    plan_product_id: string;
    name: string;
    quantity: number;
    price: number;
  }>
>([]);
const selectedCrossSellByType = ref<Record<string, string | null>>({});
const loadingPlans = ref(false);
const loadingCrossSells = ref(false);

const showDDDField = computed(() => phone_ddi.value === '55');

const hasTriedToValidate = ref(false);

const isValidationStepValid = computed(() => {
  if (!name.value || name.value.trim().length === 0) return false;
  if (!last_name.value || last_name.value.trim().length === 0) return false;
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
    maxStepReached.value = 2;
    currentStep.value = 2;
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

const itemsDocuments = ref([
  { value: EUserDocumentType.CPF, title: t('cpf') },
  { value: EUserDocumentType.CNPJ, title: t('cnpj') },
]);

const itemsCountry = ref([{ value: ECountry.Brasil, title: t('brazil') }]);

const isCPF = computed(
  () => user_document_type_id.value === EUserDocumentType.CPF
);
const isCNPJ = computed(
  () => user_document_type_id.value === EUserDocumentType.CNPJ
);

const docConfig = {
  cpf: {
    mask: '###.###.###-##',
    label: t('cpf'),
    placeholder: '000.000.000-00',
  },
  cnpj: {
    mask: '##.###.###/####-##',
    label: t('cnpj'),
    placeholder: '00.000.000/0000-00',
  },
};

const currentType = computed<'cpf' | 'cnpj' | null>(
  () => (isCPF.value && 'cpf') || (isCNPJ.value && 'cnpj') || null
);

const docMask = computed(() =>
  currentType.value ? docConfig[currentType.value].mask : ''
);
const docLabel = computed(() =>
  currentType.value ? docConfig[currentType.value].label : ''
);
const docPlaceholder = computed(() =>
  currentType.value ? docConfig[currentType.value].placeholder : ''
);

const onlyDigits = (s: string) => s.replaceAll(/\D+/g, '');

const isValidCPF = (cpf: string): boolean => {
  const digits = onlyDigits(cpf);

  if (digits.length !== 11) return false;

  if (/^(\d)\1{10}$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number.parseInt(digits.charAt(i)) * (10 - i);
  }
  let remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== Number.parseInt(digits.charAt(9))) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += Number.parseInt(digits.charAt(i)) * (11 - i);
  }
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== Number.parseInt(digits.charAt(10))) return false;

  return true;
};

const isValidCNPJ = (cnpj: string): boolean => {
  const digits = onlyDigits(cnpj);

  if (digits.length !== 14) return false;

  if (/^(\d)\1{13}$/.test(digits)) return false;

  let length = digits.length - 2;
  let numbers = digits.substring(0, length);
  const multipliers = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;

  for (let i = 0; i < length; i++) {
    sum += Number.parseInt(numbers.charAt(i)) * multipliers[i];
  }

  let remainder = sum % 11;
  let digit = remainder < 2 ? 0 : 11 - remainder;

  if (digit !== Number.parseInt(digits.charAt(length))) return false;

  length = length + 1;
  numbers = digits.substring(0, length);
  const multipliers2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  sum = 0;

  for (let i = 0; i < length; i++) {
    sum += Number.parseInt(numbers.charAt(i)) * multipliers2[i];
  }

  remainder = sum % 11;
  digit = remainder < 2 ? 0 : 11 - remainder;

  if (digit !== Number.parseInt(digits.charAt(length))) return false;

  return true;
};

const docRules = computed(() => [
  (v: string | null) =>
    (!!v && onlyDigits(v).length > 0) || t('document_required'),
  (v: string | null) => {
    if (!v) return true;
    const digits = onlyDigits(v);
    if (isCPF.value) {
      if (digits.length !== 11) return t('cpf_invalid');
      return isValidCPF(v) || t('cpf_invalid');
    }
    if (isCNPJ.value) {
      if (digits.length !== 14) return t('cnpj_invalid');
      return isValidCNPJ(v) || t('cnpj_invalid');
    }
    return true;
  },
]);

const { strengthColor, strengthLabel, strengthPercentage } =
  usePasswordStrength(() => password.value);

const rules = {
  password: (v: string | null) => {
    if (!v) return t('password_required');
    const validation = validatePassword(v);
    if (validation.isValid) return true;
    return validation.errors.map((err) => t(err)).join(', ');
  },
  confirmRequiredIfPassword: (v: string | null) =>
    !password.value || !!v || t('confirm_password'),
  confirmMatches: (v: string | null) =>
    !password.value || v === password.value || t('the_password_do_not_match'),
};

const updateAddressFields = async (response: {
  address_1: string;
  address_2?: string | null;
  city: string;
  state: string;
  district: string;
}) => {
  address1.value = response.address_1;
  address2.value = response.address_2 ?? null;
  district.value = response.district;

  if (country_id.value) {
    await loadStates(country_id.value);

    const stateValue = response.state.trim();
    let stateName = stateValue;
    let stateAbbreviation: string | null = null;

    const lastOpenParen = stateValue.lastIndexOf('(');
    const lastCloseParen = stateValue.lastIndexOf(')');

    if (
      lastOpenParen > 0 &&
      lastCloseParen > lastOpenParen &&
      lastCloseParen === stateValue.length - 1
    ) {
      stateName = stateValue.slice(0, lastOpenParen).trim();
      stateAbbreviation = stateValue
        .slice(lastOpenParen + 1, lastCloseParen)
        .trim();
    }

    const foundState = states.value.find(
      (s) =>
        s.state.toLowerCase() === stateName.toLowerCase() ||
        (stateAbbreviation &&
          s.abbreviation?.toLowerCase() === stateAbbreviation.toLowerCase()) ||
        s.state.toLowerCase() === stateValue.toLowerCase() ||
        s.abbreviation?.toLowerCase() === stateValue.toLowerCase()
    );

    if (foundState) {
      state_id.value = foundState.id_zipcode_state;
      state.value = foundState.abbreviation
        ? `${foundState.state} (${foundState.abbreviation})`
        : foundState.state;
      await loadCities(foundState.id_zipcode_state);

      const foundCity = cities.value.find(
        (c) => c.city.toLowerCase() === response.city.toLowerCase()
      );

      if (foundCity) {
        city_id.value = foundCity.id_zipcode_city;
        city.value = foundCity.city;
      }
    }
  }
};

const viewZipcode = async () => {
  if (isViewingZipcode.value) return;

  if (!country_id.value || !zip_code.value) {
    return;
  }

  if (timer) {
    (globalThis as Window & typeof globalThis).clearTimeout(timer);
    timer = null;
  }

  isViewingZipcode.value = true;

  try {
    const params: ViewRegisterZipcodeRequest = {
      country_id: country_id.value,
      zipcode: zip_code.value,
    };

    const response = await registerStore.viewZipcode(params);
    if (response) {
      await updateAddressFields(response);
    }
  } finally {
    isViewingZipcode.value = false;
  }
};

const clearAddressFields = () => {
  address1.value = '';
  address2.value = '';
  city.value = '';
  state.value = '';
  state_id.value = null;
  city_id.value = null;
  district.value = '';
  clearCities();
};

const onCountryChange = async (val: number | null) => {
  country_id.value = val;
  clearAddressFields();

  if (country_id.value) {
    await loadStates(country_id.value);
  }

  if (country_id.value && zip_code.value) {
    await viewZipcode();
  }
};

const onStateChange = async (stateId: string | null) => {
  state_id.value = stateId;
  city_id.value = null;
  city.value = '';
  clearCities();

  if (stateId) {
    await loadCities(stateId);
  }
};

watch(zip_code, () => {
  if (!country_id.value || !zip_code.value || zip_code.value.length < 8) return;

  if (country_id.value === ECountry.Brasil) {
    if (timer) {
      (globalThis as Window & typeof globalThis).clearTimeout(timer);
    }

    timer = (globalThis as Window & typeof globalThis).setTimeout(() => {
      viewZipcode();
    }, 400);
  }
});

const refFormValidation = ref<VForm>();
const refFormData = ref<VForm>();

const { locale } = useI18n();

const getCurrencyConfig = () => {
  const localeMap: Record<string, { locale: string; currency: string }> = {
    pt: { locale: 'pt-BR', currency: 'BRL' },
    en: { locale: 'en-US', currency: 'USD' },
    es: { locale: 'es-ES', currency: 'EUR' },
  };

  return localeMap[locale.value] || localeMap.pt;
};

const formatCurrency = (value: number | null | undefined): string => {
  if (!value) return t('currency_zero');
  const config = getCurrencyConfig();
  return new Intl.NumberFormat(config.locale, {
    style: 'currency',
    currency: config.currency,
  }).format(value);
};

const getAnnualPriceWithoutDiscount = (
  plan: ListRegisterPlanWithItemsResponse
): number => {
  return plan.price * 12;
};

const getAnnualPrice = (plan: ListRegisterPlanWithItemsResponse): number => {
  const annualPrice = getAnnualPriceWithoutDiscount(plan);
  if (plan.annual_discount) {
    const discount = Number.parseFloat(plan.annual_discount);
    return annualPrice * (1 - discount / 100);
  }
  return annualPrice;
};

const getPrice = (plan: ListRegisterPlanWithItemsResponse): number => {
  if (billingPeriod.value === 'annual') {
    return getAnnualPrice(plan);
  }
  return plan.price;
};

const isTestPlan = (
  plan: ListRegisterPlanWithItemsResponse | null
): boolean => {
  if (!plan) return false;
  if (plan.is_test !== true) return false;

  return Boolean(plan.days_trial && plan.days_trial > 0);
};

const getBillingPeriodText = (
  plan: ListRegisterPlanWithItemsResponse | null
): string => {
  if (!plan) return billingPeriod.value === 'annual' ? t('year') : t('month');

  if (isTestPlan(plan) && plan.days_trial) {
    const days = plan.days_trial;
    return days === 1 ? `/1 ${t('day')}` : `/${days} ${t('days')}`;
  }
  return billingPeriod.value === 'annual' ? t('year') : t('month');
};

const formatItemName = (
  name: string | null | undefined,
  quantity: number
): string => {
  if (!name) return '';

  const pluralToSingular: Record<string, string> = {
    [t('product_channels')]: t('product_channel'),
    [t('product_roles')]: t('product_role'),
    [t('product_users')]: t('product_user'),
  };

  if (quantity === 1) {
    return pluralToSingular[name] || name;
  }

  return name;
};

const filteredPlans = computed(() => {
  if (billingPeriod.value === 'annual') {
    return plans.value.filter((plan) => !isTestPlan(plan));
  }
  return plans.value;
});

const getColClasses = computed(() => {
  const count = filteredPlans.value.length;

  if (count === 1) {
    return { cols: '12', sm: '12', md: '4', offset: '4' };
  }

  if (count === 2) {
    return { cols: '12', sm: '6', md: '6', offset: '' };
  }

  if (count === 3) {
    return { cols: '12', sm: '6', md: '4', offset: '' };
  }

  if (count === 4) {
    return { cols: '12', sm: '6', md: '3', offset: '' };
  }

  if (count % 2 === 0) {
    return { cols: '12', sm: '6', md: '6', offset: '' };
  }

  if (count === 5) {
    return { cols: '12', sm: '6', md: '4', offset: '' };
  }

  return { cols: '12', sm: '6', md: '4', offset: '' };
});

const selectPlan = (plan: ListRegisterPlanWithItemsResponse) => {
  selectedPlanForCheckout.value = plan;
  if (currentStep.value === 3) {
    loadCrossSells();
  }
};

const loadPlans = async () => {
  loadingPlans.value = true;
  const result = await registerStore.listPlanWithItems();
  if (result) {
    plans.value = result;
    if (result.length > 0 && !selectedPlanForCheckout.value) {
      selectedPlanForCheckout.value = result[0];
    }
  }
  loadingPlans.value = false;
};

const loadCrossSells = async () => {
  if (!selectedPlanForCheckout.value) return;

  loadingCrossSells.value = true;
  const result = await registerStore.listAvailableCrossSell();
  if (result) {
    availableCrossSells.value = result;
    selectedCrossSellByType.value = {};
  }
  loadingCrossSells.value = false;
};

const groupedCrossSells = computed(() => {
  const groups: Record<
    string,
    {
      product_id: string;
      product_name: string;
      product_description: string | null;
      options: ListRegisterAvailableCrossSellResponse[];
    }
  > = {};

  for (const crossSell of availableCrossSells.value) {
    const productId = crossSell.plan_product_id;
    if (!groups[productId]) {
      groups[productId] = {
        product_id: productId,
        product_name: crossSell.plan_product?.name || '',
        product_description: crossSell.plan_product?.description || null,
        options: [],
      };
    }
    groups[productId].options.push(crossSell);
  }

  return Object.values(groups);
});

const getCrossSellLabel = (
  crossSell: ListRegisterAvailableCrossSellResponse
): string => {
  const name = crossSell.plan_product?.name || '';
  return `${name} - ${formatCurrency(crossSell.price)} (${crossSell.quantity}x)`;
};

const isAddonSelected = (productId: string): boolean => {
  return selectedAddons.value.some(
    (addon) => addon.plan_product_id === productId
  );
};

const canAddCrossSell = (productId: string): boolean => {
  return !!selectedCrossSellByType.value[productId];
};

const addAddon = (productId: string) => {
  const crossSellId = selectedCrossSellByType.value[productId];
  if (!crossSellId) return;

  const crossSell = availableCrossSells.value.find(
    (cs) => cs.plan_cross_sell_id === crossSellId
  );
  if (!crossSell) return;

  selectedAddons.value.push({
    plan_cross_sell_id: crossSell.plan_cross_sell_id,
    plan_product_id: crossSell.plan_product_id,
    name: crossSell.plan_product?.name || '',
    quantity: crossSell.quantity,
    price: crossSell.price,
  });

  selectedCrossSellByType.value[productId] = null;
};

const removeAddon = (productId: string) => {
  selectedAddons.value = selectedAddons.value.filter(
    (addon) => addon.plan_product_id !== productId
  );
};

const totalPrice = computed(() => {
  if (!selectedPlanForCheckout.value) return 0;

  const planPrice = getPrice(selectedPlanForCheckout.value);
  const addonsPrice = selectedAddons.value.reduce(
    (sum, addon) => sum + addon.price,
    0
  );

  return planPrice + addonsPrice;
});

watch(currentStep, async (newStep) => {
  if (newStep === 3 && plans.value.length === 0) {
    await loadPlans();
  }
  if (newStep === 3 && selectedPlanForCheckout.value) {
    await loadCrossSells();
  }
});
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
          class="disable-tab-transition d-flex justify-center"
          style="max-width: 681px; margin: 0 auto"
        >
          <VForm ref="refFormValidation">
            <VWindowItem>
              <div class="register-step-content">
                <h5 class="text-h5 mb-1 text-center">{{ $t('validation') }}</h5>
                <p class="text-sm mb-6 text-center">
                  {{ $t('validation_description') }}
                </p>

                <VRow class="justify-center">
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
                    <VLabel class="text-body-2 mb-1"
                      >{{ $t('last_name') }}:</VLabel
                    >
                    <AppTextField
                      v-model="last_name"
                      type="text"
                      :placeholder="$t('last_name')"
                      :rules="[
                        requiredValidator(last_name, $t('last_name_required')),
                      ]"
                    />
                  </VCol>

                  <VCol cols="12">
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
              </div>
            </VWindowItem>

            <VWindowItem>
              <div class="register-step-content">
                <h5 class="text-h5 mb-1 text-center">
                  {{ $t('verification_code') }}
                </h5>
                <p class="text-sm mb-6 text-center">
                  {{ $t('verification_code_description') }}
                </p>

                <VRow class="justify-center">
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
              </div>
            </VWindowItem>

            <VWindowItem>
              <div class="register-step-content">
                <h5 class="text-h5 mb-1 text-center">{{ $t('data') }}</h5>
                <p class="text-sm mb-6 text-center">
                  {{ $t('data_description') }}
                </p>

                <VForm ref="refFormData">
                  <VRow class="justify-center">
                    <VCol cols="12">
                      <VLabel class="text-body-2 mb-1"
                        >{{ $t('account_name') }}:</VLabel
                      >
                      <p class="text-caption text-medium-emphasis mb-2">
                        {{ $t('account_name_description') }}
                      </p>
                      <AppTextField
                        v-model="account_name"
                        type="text"
                        :placeholder="$t('account_name')"
                        :maxlength="10"
                        :rules="[
                          requiredValidator(
                            account_name,
                            $t('account_name_required')
                          ),
                        ]"
                      />
                    </VCol>
                  </VRow>

                  <VDivider class="my-4" />

                  <VRow>
                    <VCol cols="12" md="6">
                      <VLabel class="text-body-2 mb-1"
                        >{{ $t('password') }}:</VLabel
                      >
                      <AppTextField
                        id="new-password"
                        name="new-password"
                        v-model="password"
                        :placeholder="$t('password')"
                        :type="isPasswordVisible ? 'text' : 'password'"
                        :autocomplete="
                          isPasswordVisible ? 'off' : 'new-password'
                        "
                        autocapitalize="off"
                        autocorrect="off"
                        spellcheck="false"
                        :append-inner-icon="
                          isPasswordVisible ? 'tabler-eye-off' : 'tabler-eye'
                        "
                        :rules="[rules.password]"
                        @click:append-inner="
                          isPasswordVisible = !isPasswordVisible
                        "
                      />
                      <div v-if="password" class="mt-2">
                        <div
                          class="d-flex align-center justify-space-between mb-1"
                        >
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
                      <div class="mt-2">
                        <div class="text-body-2 font-weight-medium mb-1">
                          {{ $t('password_requirements') }}:
                        </div>
                        <ul
                          class="text-body-2 pl-4"
                          style="list-style-type: disc"
                        >
                          <li>
                            {{
                              $t('password_requirement_minimum_8_characters')
                            }}
                          </li>
                          <li>{{ $t('password_requirement_lowercase') }}</li>
                          <li>
                            {{
                              $t(
                                'password_requirement_number_symbol_or_whitespace'
                              )
                            }}
                          </li>
                        </ul>
                      </div>
                    </VCol>

                    <VCol cols="12" md="6">
                      <VLabel class="text-body-2 mb-1"
                        >{{ $t('confirm_password') }}:</VLabel
                      >
                      <AppTextField
                        id="confirm-new-password"
                        name="confirm-new-password"
                        v-model="confirmPassword"
                        :placeholder="$t('confirm_password')"
                        :type="isConfirmVisible ? 'text' : 'password'"
                        :autocomplete="
                          isConfirmVisible ? 'off' : 'new-password'
                        "
                        autocapitalize="off"
                        autocorrect="off"
                        spellcheck="false"
                        :append-inner-icon="
                          isConfirmVisible ? 'tabler-eye-off' : 'tabler-eye'
                        "
                        :rules="[
                          rules.confirmRequiredIfPassword,
                          rules.confirmMatches,
                        ]"
                        @click:append-inner="
                          isConfirmVisible = !isConfirmVisible
                        "
                      />
                    </VCol>

                    <VCol cols="12" md="6">
                      <VLabel class="text-body-2 mb-1"
                        >{{ $t('document_type') }}:</VLabel
                      >
                      <AppSelectSearch
                        v-model="user_document_type_id"
                        :items="itemsDocuments"
                        :placeholder="$t('document_type')"
                        :clearable="true"
                        item-value="value"
                        item-title="title"
                        @select="document = null"
                        @clear="document = null"
                      />
                    </VCol>

                    <VCol v-if="isCPF || isCNPJ" cols="12" md="6">
                      <AppTextField
                        v-model="document"
                        :label="docLabel + ':'"
                        :placeholder="docPlaceholder"
                        v-maska="docMask"
                        inputmode="numeric"
                        :rules="docRules"
                      />
                    </VCol>

                    <VCol cols="12" md="6">
                      <VLabel class="text-body-2 mb-1"
                        >{{ $t('birth_date') }}:</VLabel
                      >
                      <AppDateTimePicker
                        v-model="birth_date"
                        :placeholder="$t('birth_date')"
                        :rules="[
                          requiredValidator(
                            birth_date,
                            $t('birth_date_required')
                          ),
                        ]"
                      />
                    </VCol>

                    <VCol cols="12">
                      <VDivider class="my-4" />
                    </VCol>

                    <VCol cols="12" md="6">
                      <VLabel class="text-body-2 mb-1"
                        >{{ $t('country') }}:</VLabel
                      >
                      <AppSelectSearch
                        v-model="country_id"
                        :items="itemsCountry"
                        :placeholder="$t('country')"
                        :clearable="true"
                        item-value="value"
                        item-title="title"
                        @select="
                          (item) => onCountryChange(item.value as number | null)
                        "
                        @update:modelValue="
                          (val) => onCountryChange(val as number | null)
                        "
                      />
                    </VCol>

                    <VCol v-if="country_id" cols="12" md="6">
                      <VLabel class="text-body-2 mb-1"
                        >{{ $t('zip_code') }}:</VLabel
                      >
                      <AppTextField
                        v-model="zip_code"
                        :placeholder="$t('zip_code')"
                        :rules="[
                          requiredValidator(zip_code, $t('zip_code_required')),
                        ]"
                        :disabled="!country_id"
                        @keydown.enter.prevent="viewZipcode"
                        maxlength="8"
                      />
                    </VCol>

                    <VCol v-if="country_id" cols="12" md="6">
                      <VLabel class="text-body-2 mb-1"
                        >{{ $t('state') }}:</VLabel
                      >
                      <AppSelectSearch
                        v-model="state_id"
                        :items="filteredStates"
                        :placeholder="$t('state')"
                        :disabled="!country_id"
                        item-value="value"
                        item-title="title"
                        @select="
                          (item) => {
                            onStateChange(item.value as string | null);
                            state = item.title || '';
                          }
                        "
                      />
                    </VCol>

                    <VCol v-if="country_id" cols="12" md="6">
                      <VLabel class="text-body-2 mb-1"
                        >{{ $t('city') }}:</VLabel
                      >
                      <AppSelectSearch
                        v-model="city_id"
                        :items="filteredCities"
                        :placeholder="$t('city')"
                        :disabled="!state_id || !country_id"
                        item-value="value"
                        item-title="title"
                        @select="
                          (item) => {
                            city = item.title || '';
                          }
                        "
                      />
                    </VCol>

                    <VCol v-if="country_id" cols="12" md="6">
                      <VLabel class="text-body-2 mb-1"
                        >{{ $t('address') }}:</VLabel
                      >
                      <AppTextField
                        v-model="address1"
                        :disabled="!country_id"
                        :placeholder="$t('address')"
                        :rules="[
                          requiredValidator(address1, $t('address_required')),
                        ]"
                      />
                    </VCol>

                    <VCol v-if="country_id" cols="12" md="6">
                      <VLabel class="text-body-2 mb-1"
                        >{{ $t('address_secondary') }}:</VLabel
                      >
                      <AppTextField
                        v-model="address2"
                        :disabled="!country_id"
                        :placeholder="$t('address_secondary')"
                      />
                    </VCol>

                    <VCol v-if="country_id" cols="12" md="6">
                      <VLabel class="text-body-2 mb-1"
                        >{{ $t('district') }}:</VLabel
                      >
                      <AppTextField
                        v-model="district"
                        :disabled="!country_id"
                        :placeholder="$t('district')"
                        :rules="[
                          requiredValidator(district, $t('district_required')),
                        ]"
                      />
                    </VCol>
                  </VRow>
                </VForm>
              </div>
            </VWindowItem>

            <VWindowItem>
              <div class="register-step-content">
                <h5 class="text-h5 mb-1 text-center">{{ $t('plans') }}</h5>
                <p class="text-sm mb-6 text-center">
                  {{ $t('plans_subtitle') }}
                </p>

                <div v-if="loadingPlans" class="text-center py-8">
                  <VProgressCircular indeterminate color="primary" size="64" />
                </div>

                <div v-else>
                  <div class="d-flex flex-column align-center mb-8">
                    <div class="d-flex align-center gap-4 mt-6">
                      <span
                        :class="[
                          'text-body-1',
                          billingPeriod === 'monthly'
                            ? 'text-primary'
                            : 'text-disabled',
                        ]"
                      >
                        {{ $t('monthly') }}
                      </span>
                      <VSwitch
                        v-model="billingPeriod"
                        true-value="annual"
                        false-value="monthly"
                        color="primary"
                        hide-details
                      />
                      <span
                        :class="[
                          'text-body-1',
                          billingPeriod === 'annual'
                            ? 'text-primary'
                            : 'text-disabled',
                        ]"
                      >
                        {{ $t('annual') }}
                      </span>
                      <span
                        v-if="billingPeriod === 'annual'"
                        class="text-body-2 text-medium-emphasis ms-2"
                      >
                        {{ $t('save_with_annual_plans') }}
                      </span>
                    </div>
                  </div>

                  <VRow
                    v-if="filteredPlans.length > 0"
                    class="plans-row"
                    justify="center"
                  >
                    <VCol
                      v-for="(plan, index) in filteredPlans"
                      :key="plan.plan_id"
                      :cols="getColClasses.cols"
                      :sm="getColClasses.sm"
                      :md="getColClasses.md"
                      :offset-md="getColClasses.offset || undefined"
                      class="plan-col"
                    >
                      <VCard
                        :class="[
                          'plan-card',
                          selectedPlanForCheckout?.plan_id === plan.plan_id
                            ? 'plan-card-popular'
                            : '',
                        ]"
                        :variant="
                          selectedPlanForCheckout?.plan_id === plan.plan_id
                            ? 'elevated'
                            : 'outlined'
                        "
                        :elevation="
                          selectedPlanForCheckout?.plan_id === plan.plan_id
                            ? 4
                            : 0
                        "
                        @click="selectPlan(plan)"
                        style="cursor: pointer"
                      >
                        <VCardText>
                          <div class="text-center mb-4">
                            <VAvatar
                              :color="
                                index === 0
                                  ? 'pink'
                                  : index === 1
                                    ? 'blue'
                                    : 'primary'
                              "
                              size="80"
                              variant="tonal"
                              class="mb-4"
                            >
                              <VIcon
                                :icon="plan.icon || 'tabler-rocket'"
                                size="40"
                              />
                            </VAvatar>
                            <h3 class="text-h5 mb-2">{{ plan.name }}</h3>
                            <VChip
                              v-if="
                                billingPeriod === 'annual' &&
                                plan.annual_discount &&
                                Number.parseFloat(plan.annual_discount) > 0
                              "
                              color="primary"
                              size="small"
                              variant="tonal"
                              class="mb-2"
                            >
                              {{ $t('save_up_to') }}
                              {{ Number.parseFloat(plan.annual_discount) }}%
                            </VChip>
                            <p
                              v-if="plan.description"
                              class="text-body-2 text-medium-emphasis mb-4"
                            >
                              {{ plan.description }}
                            </p>
                          </div>

                          <div class="text-center mb-6">
                            <div
                              class="d-flex align-center justify-center gap-2 mb-2"
                            >
                              <span
                                class="text-h3 font-weight-bold text-primary"
                              >
                                {{ formatCurrency(getPrice(plan)) }}
                              </span>
                              <span class="text-body-2 text-medium-emphasis">
                                {{ getBillingPeriodText(plan) }}
                              </span>
                            </div>
                          </div>

                          <VDivider class="mb-4" />

                          <div class="d-flex flex-column gap-3 mb-6">
                            <div
                              v-for="item in plan.plan_items"
                              :key="item.plan_item_id"
                              class="d-flex align-center gap-2"
                            >
                              <VIcon
                                icon="tabler-circle-check"
                                size="20"
                                color="success"
                              />
                              <span class="text-body-2">
                                {{ item.quantity }}x
                                {{
                                  formatItemName(
                                    item.plan_product?.name,
                                    item.quantity
                                  ) || $t('plan_item')
                                }}
                              </span>
                            </div>
                          </div>
                        </VCardText>
                      </VCard>
                    </VCol>
                  </VRow>

                  <VRow v-else>
                    <VCol cols="12" class="text-center">
                      <p class="text-body-1 text-medium-emphasis">
                        {{ $t('no_plans_available') }}
                      </p>
                    </VCol>
                  </VRow>

                  <div v-if="selectedPlanForCheckout" class="mt-8">
                    <VDivider class="mb-4" />
                    <h6 class="text-h6 mb-4">{{ $t('addons') }}</h6>

                    <div v-if="loadingCrossSells" class="text-center py-4">
                      <VProgressCircular
                        indeterminate
                        color="primary"
                        size="32"
                      />
                    </div>

                    <div v-else-if="groupedCrossSells.length > 0">
                      <VCard
                        v-for="group in groupedCrossSells"
                        :key="group.product_id"
                        variant="outlined"
                        class="mb-4"
                        :class="{
                          'border-primary': isAddonSelected(group.product_id),
                        }"
                      >
                        <VCardText>
                          <div class="d-flex flex-column gap-3">
                            <div>
                              <div class="font-weight-medium mb-1">
                                {{ group.product_name }}
                              </div>
                              <div
                                v-if="group.product_description"
                                class="text-body-2 text-medium-emphasis"
                              >
                                {{ group.product_description }}
                              </div>
                            </div>

                            <div
                              v-if="isAddonSelected(group.product_id)"
                              class="d-flex align-center justify-space-between"
                            >
                              <VChip color="success" variant="tonal">
                                {{ $t('added') }}
                              </VChip>
                              <VBtn
                                color="error"
                                variant="outlined"
                                size="small"
                                :disabled="isTestPlan(selectedPlanForCheckout)"
                                @click="removeAddon(group.product_id)"
                              >
                                {{ $t('remove') }}
                              </VBtn>
                            </div>

                            <div v-else class="d-flex align-center gap-2">
                              <VSelect
                                v-model="
                                  selectedCrossSellByType[group.product_id]
                                "
                                :items="
                                  group.options.map((opt) => ({
                                    title: getCrossSellLabel(opt),
                                    value: opt.plan_cross_sell_id,
                                  }))
                                "
                                item-title="title"
                                item-value="value"
                                :label="`${$t('select')} ${group.product_name}`"
                                variant="outlined"
                                density="compact"
                                class="flex-grow-1"
                                :disabled="isTestPlan(selectedPlanForCheckout)"
                              />
                              <VBtn
                                color="primary"
                                variant="outlined"
                                :disabled="
                                  isTestPlan(selectedPlanForCheckout) ||
                                  !canAddCrossSell(group.product_id)
                                "
                                @click="addAddon(group.product_id)"
                              >
                                {{ $t('add') }}
                              </VBtn>
                            </div>
                          </div>
                        </VCardText>
                      </VCard>
                    </div>

                    <div v-else class="text-center py-4">
                      <p class="text-body-2 text-medium-emphasis">
                        {{ $t('no_addons_available') }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </VWindowItem>

            <VWindowItem>
              <div class="register-step-content">
                <h5 class="text-h5 mb-1 text-center">
                  {{
                    selectedPlanForCheckout &&
                    isTestPlan(selectedPlanForCheckout)
                      ? $t('test')
                      : $t('payment')
                  }}
                </h5>
                <p class="text-sm mb-6 text-center">
                  {{
                    selectedPlanForCheckout &&
                    isTestPlan(selectedPlanForCheckout)
                      ? $t('test_subtitle')
                      : $t('payment_subtitle')
                  }}
                </p>

                <div v-if="selectedPlanForCheckout">
                  <VCard variant="outlined">
                    <VCardText>
                      <div
                        class="d-flex align-center justify-space-between mb-4"
                      >
                        <span class="text-body-1 font-weight-medium">
                          {{ selectedPlanForCheckout.name }}
                        </span>
                        <span class="text-h6 font-weight-bold text-primary">
                          {{
                            formatCurrency(getPrice(selectedPlanForCheckout))
                          }}
                        </span>
                      </div>

                      <div
                        v-for="addon in selectedAddons"
                        :key="addon.plan_cross_sell_id"
                        class="d-flex align-center justify-space-between mb-2"
                      >
                        <span class="text-body-2">
                          {{ addon.name }} ({{ addon.quantity }}x)
                        </span>
                        <span class="text-body-2 font-weight-medium">
                          {{ formatCurrency(addon.price) }}
                        </span>
                      </div>

                      <VDivider class="my-4" />

                      <div class="d-flex align-center justify-space-between">
                        <span class="text-h6 font-weight-bold">
                          {{ $t('total') }}:
                        </span>
                        <span class="text-h5 font-weight-bold text-primary">
                          {{ formatCurrency(totalPrice) }}
                        </span>
                      </div>
                    </VCardText>
                  </VCard>
                </div>
              </div>
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

.register-step-content {
  max-width: 681px;
  margin: 0 auto;
  width: 100%;
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
