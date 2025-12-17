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
import { ListCreditCardFeeResponse } from '@core/schema/config/listCreditCardFee/response.schema';
import { CreateRegisterOrderPaymentRequest } from '@core/schema/register/createOrderPayment/request.schema';
import { EColor } from '@core/common/enums/EColor';
import visaSvg from '@images/icons/payments/card/visa.svg?url';
import mastercardSvg from '@images/icons/payments/card/mastercard.svg?url';
import amexSvg from '@images/icons/payments/card/amex.svg?url';
import dinersSvg from '@images/icons/payments/card/diners.svg?url';
import discoverSvg from '@images/icons/payments/card/discover.svg?url';
import eloSvg from '@images/icons/payments/card/elo.svg?url';
import jcbSvg from '@images/icons/payments/card/jcb.svg?url';
import maestroSvg from '@images/icons/payments/card/maestro.svg?url';
import hipercardSvg from '@images/icons/payments/card/hipercard.svg?url';
import meliSvg from '@images/icons/payments/card/meli.svg?url';
import realSvg from '@images/icons/payments/card/real.svg?url';
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

const stepConfig = computed(() => {
  const hasAddons = !isTestPlan(selectedPlanForCheckout.value);

  const steps = [
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
  ];

  const addonsIndex = hasAddons ? steps.length : -1;

  if (hasAddons) {
    steps.push({
      title: t('addons'),
      subtitle: t('addons_subtitle'),
      icon: 'tabler-plus',
    });
  }

  steps.push({
    title: isTestPlan(selectedPlanForCheckout.value) ? t('test') : t('payment'),
    subtitle: isTestPlan(selectedPlanForCheckout.value)
      ? t('test_subtitle')
      : t('payment_subtitle'),
    icon: isTestPlan(selectedPlanForCheckout.value)
      ? 'tabler-flask'
      : 'tabler-credit-card',
  });

  return {
    items: steps,
    addonsIndex,
    lastIndex: steps.length - 1,
  };
});

const items = computed(() => stepConfig.value.items);
const ADDONS_STEP_INDEX = computed(() => stepConfig.value.addonsIndex);
const LAST_STEP_INDEX = computed(() => stepConfig.value.lastIndex);

const name = ref<string | null>(null);
const last_name = ref<string | null>(null);
const email = ref<string | null>(null);
const phone_ddi = ref<string | null>('55');
const phone_ddd = ref<string | null>(null);
const phone = ref<string | null>(null);
const verificationCode = ref<string>('');
const isVerificationValid = ref(false);
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
const state_fiscal_code = ref<string | null>(null);
const city_id = ref<string | null>(null);
const city_fiscal_code = ref<string | null>(null);
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
const creditCardFee = ref<ListCreditCardFeeResponse | null>(null);
const selectedPaymentMethod = ref<'boleto' | 'credit_card' | 'pix'>(
  'credit_card'
);
const cardForm = ref({
  cardholder_name: '',
  card_number: '',
  expiry: '',
  cvv: '',
});
const detectedBrand = ref<string | null>(null);
const pixModalOpen = ref(false);
const pixPaymentInitiated = ref(false);
const pixPaymentData = ref<{
  payment_id: string;
  qr_code: string;
  payload: string;
  expiration_date: string;
} | null>(null);
const boletoPaymentData = ref<{
  payment_id: string;
  identification_field: string;
  nosso_numero: string;
  qr_code?: string;
  payload?: string;
  expiration_date?: string;
  bank_slip_url: string;
  due_date: string;
} | null>(null);
const pixPaymentId = ref<string | null>(null);
const pixPaymentStatus = ref<
  'PENDING' | 'RECEIVED' | 'CONFIRMED' | 'OVERDUE' | 'REFUNDED' | null
>(null);
const pixPaymentConfirmed = ref(false);
const installments = ref<number>(1);
const recurringPayment = ref(false);
const nextButtonLabel = computed(() => {
  if (
    selectedPlanForCheckout.value &&
    isTestPlan(selectedPlanForCheckout.value)
  ) {
    if (currentStep.value === LAST_STEP_INDEX.value) return t('test_now');
    return t('next');
  }
  if (currentStep.value === LAST_STEP_INDEX.value)
    return t('finalize_purchase');
  return t('next');
});
const isNextButtonLoading = computed(() => {
  if (!registerStore.isLoading) return false;
  if (currentStep.value === 0) return true;
  if (currentStep.value === 1) return true;
  return currentStep.value === LAST_STEP_INDEX.value;
});

const paymentStatusAlert = computed(() => {
  if (pixPaymentConfirmed.value) {
    return {
      type: 'success' as const,
      message: t('payment_confirmed'),
      icon: 'tabler-circle-check',
    };
  }
  if (pixPaymentStatus.value === 'RECEIVED') {
    return {
      type: 'success' as const,
      message: t('payment_received'),
      icon: 'tabler-circle-check',
    };
  }
  return {
    type: 'info' as const,
    message: t('awaiting_payment'),
    icon: 'tabler-clock-hour-4',
  };
});

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
  isVerificationValid.value = false;
  if (newValue && newValue !== newValue.toUpperCase()) {
    verificationCode.value = newValue.toUpperCase();
  }

  if (newValue && newValue.length === 6) {
    handleVerifyCode();
  }
});

const handleVerifyCode = async (): Promise<boolean> => {
  if (!verificationCode.value || verificationCode.value.length !== 6) {
    return false;
  }

  const success =
    (await registerStore
      .verifyCode({
        code: verificationCode.value,
      })
      .catch(() => false)) || false;

  if (!success) {
    isVerificationValid.value = false;
    verificationCode.value = '';
    return false;
  }

  isVerificationValid.value = true;
  maxStepReached.value = 2;
  currentStep.value = 2;
  return true;
};

const canGoToStep = (step: number) => {
  if (step === ADDONS_STEP_INDEX.value && ADDONS_STEP_INDEX.value === -1) {
    return false;
  }
  return step <= maxStepReached.value;
};

watch(selectedPlanForCheckout, (plan) => {
  if (plan && isTestPlan(plan)) {
    selectedAddons.value = [];
    selectedCrossSellByType.value = {};
    availableCrossSells.value = [];

    if (currentStep.value >= ADDONS_STEP_INDEX.value) {
      currentStep.value = LAST_STEP_INDEX.value;
    }

    if (maxStepReached.value < currentStep.value) {
      maxStepReached.value = currentStep.value;
    }
  }
});

const loadCreditCardFee = async () => {
  if (creditCardFee.value) return;
  const result = await registerStore.getCreditCardFee();
  if (result) {
    creditCardFee.value = result;
  }
};

watch(selectedPaymentMethod, (method) => {
  if (method === 'credit_card' && billingPeriod.value === 'annual') {
    loadCreditCardFee();
  }
});

watch(state_id, (val) => {
  const found = states.value.find((s) => s.id_zipcode_state === val);
  state_fiscal_code.value = found?.fiscal_code || null;
  if (!val) {
    city_fiscal_code.value = null;
    city_id.value = null;
    city.value = null;
  }
});

watch(city_id, (val) => {
  const found = cities.value.find((c) => c.id_zipcode_city === val);
  city_fiscal_code.value = found?.fiscal_code || null;
  city.value = found?.city || '';
});

watch(billingPeriod, (period) => {
  if (period === 'annual' && selectedPaymentMethod.value === 'credit_card') {
    loadCreditCardFee();
  }
});

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

const buildRegisterPaymentData =
  (): CreateRegisterOrderPaymentRequest | null => {
    if (!selectedPlanForCheckout.value) return null;
    if (!account_name.value) return null;
    if (!password.value) return null;
    if (!user_document_type_id.value) return null;
    if (!document.value) return null;
    if (!country_id.value) return null;
    if (!zip_code.value) return null;
    if (!address1.value) return null;
    if (!district.value) return null;

    const addons =
      selectedAddons.value.length > 0
        ? selectedAddons.value.map((addon) => ({
            plan_cross_sell_id: addon.plan_cross_sell_id,
          }))
        : undefined;

    const paymentMethod = isTestPlan(selectedPlanForCheckout.value)
      ? 'pix'
      : selectedPaymentMethod.value;

    if (!paymentMethod) return null;

    const expiryClean = cardForm.value.expiry.replaceAll(/\s/g, '');
    const expiryParts = expiryClean.split('/');
    const expiryMonth = expiryParts[0] || '';
    const expiryYear =
      expiryParts.length > 1 ? expiryParts[1]?.slice(-2) || '' : '';

    const newCard =
      paymentMethod === 'credit_card' && cardForm.value.card_number
        ? {
            number: cardForm.value.card_number.replaceAll(/\s/g, ''),
            holder_name: cardForm.value.cardholder_name,
            expiry_month: expiryMonth,
            expiry_year: expiryYear,
            cvv: cardForm.value.cvv,
          }
        : undefined;

    if (
      paymentMethod === 'credit_card' &&
      (!newCard ||
        !newCard.number ||
        !newCard.holder_name ||
        !newCard.expiry_month ||
        !newCard.expiry_year ||
        !newCard.cvv)
    ) {
      return null;
    }

    const installmentsValue =
      paymentMethod === 'credit_card' && billingPeriod.value === 'annual'
        ? installments.value
        : undefined;

    return {
      account_name: account_name.value.trim(),
      user: {
        name: name.value?.trim() || '',
        last_name: last_name.value?.trim() || '',
        email: email.value?.trim() || '',
        password: password.value || '',
        phone_ddi: phone_ddi.value || '',
        phone_ddd: phone_ddd.value || undefined,
        phone: phone.value || '',
        document_type_id: user_document_type_id.value,
        document: document.value?.trim() || '',
        birth_date: birth_date.value || undefined,
        country_id: country_id.value,
        zip_code: zip_code.value?.trim() || '',
        address1: address1.value?.trim() || '',
        address2: address2.value || undefined,
        district: district.value?.trim() || '',
        state_fiscal_code: state_fiscal_code.value || undefined,
        city_fiscal_code: city_fiscal_code.value || undefined,
      },
      plan_id: selectedPlanForCheckout.value.plan_id,
      billing_period: billingPeriod.value,
      addons,
      payment_method: paymentMethod,
      credit_card_id: undefined,
      new_card: newCard?.number ? newCard : undefined,
      recurring_payment:
        paymentMethod === 'credit_card' ? recurringPayment.value : undefined,
      installments: installmentsValue,
    };
  };

const handleSubmitOrderPayment = async () => {
  const payload = buildRegisterPaymentData();
  if (!payload) return;
  const result = await registerStore.createOrderPayment(payload);
  if (!result) return;
  if (result.pix_payment) {
    await processPixPayment(result.pix_payment);
    return;
  }
  if (result.boleto_payment) {
    await processBoletoPayment(result.boleto_payment);
    return;
  }
  if (result.credit_card_payment) {
    await processCreditCardPayment(result.credit_card_payment);
    return;
  }
  registerStore.showSnackbar(
    t('order_payment_created_successfully'),
    EColor.success
  );
};

const handleNext = async () => {
  if (currentStep.value === LAST_STEP_INDEX.value) {
    await handleSubmitOrderPayment();
    return;
  }

  if (currentStep.value === 0) {
    handleRegister();
    return;
  }

  if (currentStep.value === 1) {
    const verified = await handleVerifyCode();
    if (!verified) return;
    return;
  }

  if (currentStep.value === 2) {
    const validation = await refFormData.value?.validate();
    if (!validation?.valid) {
      return;
    }
    maxStepReached.value = Math.max(maxStepReached.value, 3);
    const nextStep = Math.min(currentStep.value + 1, LAST_STEP_INDEX.value);
    currentStep.value = nextStep;
    return;
  }

  if (currentStep.value === 3) {
    if (!selectedPlanForCheckout.value) {
      return;
    }

    if (isTestPlan(selectedPlanForCheckout.value)) {
      maxStepReached.value = LAST_STEP_INDEX.value;
      currentStep.value = LAST_STEP_INDEX.value;
      return;
    }

    if (ADDONS_STEP_INDEX.value === -1) {
      maxStepReached.value = LAST_STEP_INDEX.value;
      currentStep.value = LAST_STEP_INDEX.value;
      return;
    }

    maxStepReached.value = Math.max(
      maxStepReached.value,
      ADDONS_STEP_INDEX.value
    );
    if (!loadingCrossSells.value) {
      await loadCrossSells();
    }
    currentStep.value = ADDONS_STEP_INDEX.value;
    return;
  }

  if (currentStep.value === ADDONS_STEP_INDEX.value) {
    maxStepReached.value = LAST_STEP_INDEX.value;
  }

  if (currentStep.value < LAST_STEP_INDEX.value) {
    currentStep.value = currentStep.value + 1;
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

const detectCardBrand = (value: string | null): string | null => {
  if (!value) return null;
  const cleaned = value.replaceAll(/\D/g, '');
  if (cleaned.match(/^4/)) return 'VISA';
  if (cleaned.match(/^(5[1-5]|2[2-7])/)) return 'MASTERCARD';
  if (cleaned.match(/^3[47]/)) return 'AMEX';
  if (cleaned.match(/^3(0[0-5]|[68])/)) return 'DINERS';
  if (cleaned.match(/^6(?:011|5)/)) return 'DISCOVER';
  if (cleaned.match(/^(636368|438935|504175|451416|636297)/)) return 'ELO';
  if (cleaned.match(/^(352[8-9]|35[3-8][0-9])/)) return 'JCB';
  if (cleaned.match(/^(50|56|57|58)/)) return 'MAESTRO';
  if (cleaned.match(/^606282|^3841(?:[0|4|6]{1})0/)) return 'HIPERCARD';
  if (cleaned.match(/^(5018|5020|5038|6304|6759|6761|6762|6763)/))
    return 'MELI';
  if (cleaned.match(/^(5090|5091|5092)/)) return 'REAL';
  return null;
};

const getBrandLogoUrl = (brand: string | null) => {
  if (!brand) return null;
  const logoPaths: Record<string, string | any> = {
    VISA: visaSvg,
    MASTERCARD: mastercardSvg,
    AMEX: amexSvg,
    DINERS: dinersSvg,
    DISCOVER: discoverSvg,
    ELO: eloSvg,
    JCB: jcbSvg,
    MAESTRO: maestroSvg,
    HIPERCARD: hipercardSvg,
    MELI: meliSvg,
    REAL: realSvg,
  };
  const logoPath = logoPaths[brand];
  if (!logoPath) return null;
  return logoPath;
};

const getBrandGradient = (brand: string | null) => {
  if (brand === 'VISA') return 'linear-gradient(135deg, #1a1f71, #3b5998)';
  if (brand === 'MASTERCARD')
    return 'linear-gradient(135deg, #ff5f6d, #ffc371)';
  if (brand === 'AMEX') return 'linear-gradient(135deg, #2bdeeb, #0077be)';
  if (brand === 'DINERS') return 'linear-gradient(135deg, #1f4037, #99f2c8)';
  if (brand === 'DISCOVER') return 'linear-gradient(135deg, #f46b45, #eea849)';
  if (brand === 'ELO') return 'linear-gradient(135deg, #000000, #434343)';
  if (brand === 'JCB') return 'linear-gradient(135deg, #1e3c72, #2a5298)';
  if (brand === 'MAESTRO') return 'linear-gradient(135deg, #1e3c72, #00a2ed)';
  if (brand === 'HIPERCARD') return 'linear-gradient(135deg, #8a0f0f, #c31432)';
  if (brand === 'MELI') return 'linear-gradient(135deg, #f5af19, #f12711)';
  if (brand === 'REAL') return 'linear-gradient(135deg, #243B55, #141E30)';
  return 'linear-gradient(135deg, #4b6cb7, #182848)';
};

const formatCardNumber = (value: string): string => {
  const cleaned = value.replaceAll(/\s/g, '').slice(0, 16);
  const chunks = cleaned.match(/.{1,4}/g);
  return chunks ? chunks.join(' ') : cleaned;
};

const onCardNumberInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const value = target.value.replaceAll(/\D/g, '');
  const formatted = formatCardNumber(value);
  cardForm.value.card_number = formatted;
  detectedBrand.value = detectCardBrand(value);
};

const formatExpiry = (value: string): string => {
  const cleaned = value.replaceAll(/\D/g, '').slice(0, 4);
  if (cleaned.length <= 2) return cleaned;
  const month = cleaned.slice(0, 2);
  const year = cleaned.slice(2, 4);
  return `${month}/${year}`;
};

const onExpiryInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const formatted = formatExpiry(target.value);
  cardForm.value.expiry = formatted;
  target.value = formatted;
};

const onCvvInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const value = target.value.replaceAll(/\D/g, '').slice(0, 4);
  cardForm.value.cvv = value;
  target.value = value;
};

const openPaymentModal = async () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  await nextTick();
  pixModalOpen.value = true;
};

const processPixPayment = async (pixData: {
  payment_id: string;
  qr_code: string;
  payload: string;
  expiration_date: string;
}) => {
  pixPaymentData.value = {
    payment_id: pixData.payment_id,
    qr_code: pixData.qr_code,
    payload: pixData.payload,
    expiration_date: pixData.expiration_date,
  };
  pixPaymentId.value = pixData.payment_id;
  pixPaymentStatus.value = 'PENDING';
  pixPaymentInitiated.value = true;
  await openPaymentModal();
};

const processBoletoPayment = async (boletoData: {
  payment_id: string;
  identification_field: string;
  nosso_numero: string;
  qr_code?: string;
  payload?: string;
  expiration_date?: string;
  bank_slip_url: string;
  due_date: string;
}) => {
  boletoPaymentData.value = {
    payment_id: boletoData.payment_id,
    identification_field: boletoData.identification_field,
    nosso_numero: boletoData.nosso_numero,
    qr_code: boletoData.qr_code,
    payload: boletoData.payload,
    expiration_date: boletoData.expiration_date,
    bank_slip_url: boletoData.bank_slip_url,
    due_date: boletoData.due_date,
  };
  pixPaymentId.value = boletoData.payment_id;
  pixPaymentStatus.value = 'PENDING';
  pixPaymentInitiated.value = true;
  await openPaymentModal();
};

const processCreditCardPayment = async (creditCardData: {
  payment_id: string;
  status: string;
  is_confirmed: boolean;
}) => {
  pixPaymentId.value = creditCardData.payment_id;
  pixPaymentStatus.value =
    (creditCardData.status as
      | 'PENDING'
      | 'RECEIVED'
      | 'CONFIRMED'
      | 'OVERDUE'
      | 'REFUNDED') || 'PENDING';
  pixPaymentInitiated.value = true;
  if (creditCardData.is_confirmed) {
    pixPaymentConfirmed.value = true;
  }
  await openPaymentModal();
};

const copyPixCode = async () => {
  if (!pixPaymentData.value?.payload) return;
  try {
    await navigator.clipboard.writeText(pixPaymentData.value.payload);
  } catch (error) {
    console.error('Erro ao copiar código PIX:', error);
  }
};

const closePixModal = async () => {
  pixModalOpen.value = false;
};

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
      state_fiscal_code.value = foundState.fiscal_code || null;
      state.value = foundState.abbreviation
        ? `${foundState.state} (${foundState.abbreviation})`
        : foundState.state;
      await loadCities(foundState.id_zipcode_state);

      const foundCity = cities.value.find(
        (c) => c.city.toLowerCase() === response.city.toLowerCase()
      );

      if (foundCity) {
        city_id.value = foundCity.id_zipcode_city;
        city_fiscal_code.value = foundCity.fiscal_code || null;
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
  state_fiscal_code.value = null;
  city_id.value = null;
  city_fiscal_code.value = null;
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
  state_fiscal_code.value = null;
  city_id.value = null;
  city_fiscal_code.value = null;
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

const applyCreditCardFee = (value: number, feeRate: number): number => {
  if (!value) return 0;
  if (!feeRate) return Math.round(value * 100) / 100;
  const multiplier = 1 + feeRate / 100;
  return Math.round(value * multiplier * 100) / 100;
};

const getCreditCardFeeRate = (installment: number): number => {
  if (!creditCardFee.value) return 0;
  const rates: Record<number, number> = {
    1: creditCardFee.value.installment_1_rate,
    2: creditCardFee.value.installment_2_rate,
    3: creditCardFee.value.installment_3_rate,
    4: creditCardFee.value.installment_4_rate,
    5: creditCardFee.value.installment_5_rate,
    6: creditCardFee.value.installment_6_rate,
    7: creditCardFee.value.installment_7_rate,
    8: creditCardFee.value.installment_8_rate,
    9: creditCardFee.value.installment_9_rate,
    10: creditCardFee.value.installment_10_rate,
    11: creditCardFee.value.installment_11_rate,
    12: creditCardFee.value.installment_12_rate,
  };
  return rates[installment] ?? 0;
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
  return {
    cols: '12',
    sm: '6',
    md: '4',
    lg: '4',
    xl: '4',
  };
});

const selectPlan = (plan: ListRegisterPlanWithItemsResponse) => {
  selectedPlanForCheckout.value = plan;
  selectedAddons.value = [];
  selectedCrossSellByType.value = {};
  availableCrossSells.value = [];
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
  if (
    billingPeriod.value === 'annual' &&
    selectedPaymentMethod.value === 'credit_card'
  ) {
    await loadCreditCardFee();
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
  const price = getAddonPriceValue(crossSell.price);
  return `${name} - ${formatCurrency(price)} (${crossSell.quantity}x)`;
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

const getAddonPriceValue = (price: number): number => {
  const factor = billingPeriod.value === 'annual' ? 12 : 1;
  return price * factor;
};

const addonsTotal = computed(() => {
  let total = 0;
  for (const addon of selectedAddons.value) {
    total += getAddonPriceValue(addon.price);
  }
  return total;
});

const totalPriceBase = computed(() => {
  if (!selectedPlanForCheckout.value) return 0;

  const planPrice = getPrice(selectedPlanForCheckout.value);
  const total = planPrice + addonsTotal.value;
  return Math.round(total * 100) / 100;
});

const shouldApplyCreditCardFee = computed(() => {
  return (
    selectedPaymentMethod.value === 'credit_card' &&
    billingPeriod.value === 'annual'
  );
});

const selectedInstallmentFeeRate = computed(() => {
  if (!shouldApplyCreditCardFee.value) return 0;
  return getCreditCardFeeRate(installments.value);
});

const totalPrice = computed(() => {
  const baseTotal = totalPriceBase.value;
  if (!shouldApplyCreditCardFee.value) return baseTotal;
  const feeRate = selectedInstallmentFeeRate.value;
  return applyCreditCardFee(baseTotal, feeRate);
});

const installmentOptions = computed(() => {
  const options: Array<{ title: string; value: number }> = [];
  if (billingPeriod.value !== 'annual') return options;
  if (!selectedPlanForCheckout.value) return options;
  if (!creditCardFee.value) return options;

  const baseTotal = totalPriceBase.value;
  const rates = [
    creditCardFee.value.installment_1_rate,
    creditCardFee.value.installment_2_rate,
    creditCardFee.value.installment_3_rate,
    creditCardFee.value.installment_4_rate,
    creditCardFee.value.installment_5_rate,
    creditCardFee.value.installment_6_rate,
    creditCardFee.value.installment_7_rate,
    creditCardFee.value.installment_8_rate,
    creditCardFee.value.installment_9_rate,
    creditCardFee.value.installment_10_rate,
    creditCardFee.value.installment_11_rate,
    creditCardFee.value.installment_12_rate,
  ];

  for (let i = 0; i < rates.length; i += 1) {
    const installmentNumber = i + 1;
    const rate = rates[i] || 0;
    const totalWithFee = applyCreditCardFee(baseTotal, rate);
    const installmentValue = totalWithFee / installmentNumber;
    const title = t('credit_card_installment_option', {
      number: installmentNumber,
      installmentValue: formatCurrency(installmentValue),
      totalWithFee: formatCurrency(totalWithFee),
    });
    options.push({ title, value: installmentNumber });
  }

  return options;
});

watch(currentStep, async (newStep) => {
  if (newStep === 3 && plans.value.length === 0) {
    await loadPlans();
  }
  if (
    newStep === ADDONS_STEP_INDEX.value &&
    ADDONS_STEP_INDEX.value !== -1 &&
    selectedPlanForCheckout.value &&
    !isTestPlan(selectedPlanForCheckout.value)
  ) {
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

        <VWindow v-model="currentStep" class="disable-tab-transition w-100">
          <VForm ref="refFormValidation" class="px-4">
            <VWindowItem>
              <div class="register-step-content">
                <h5 class="text-h5 mb-1">{{ $t('validation') }}</h5>
                <p class="text-sm mb-6">
                  {{ $t('validation_description') }}
                </p>

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

                  <VCol cols="12" md="6">
                    <VLabel class="text-body-2 mb-1">{{ $t('phone') }}:</VLabel>
                    <AppTextField
                      v-model="phoneFormatted"
                      type="tel"
                      :placeholder="$t('phone')"
                      :maxlength="showDDDField ? 10 : 15"
                      :rules="[requiredValidator(phone, $t('phone_required'))]"
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
                </VRow>
              </div>
            </VWindowItem>

            <VWindowItem>
              <div class="register-step-content">
                <h5 class="text-h5 mb-1">
                  {{ $t('verification_code') }}
                </h5>
                <p class="text-sm mb-6">
                  {{ $t('verification_code_description') }}
                </p>

                <VRow justify="center">
                  <VCol cols="12" md="8">
                    <VCard class="otp-card" variant="flat">
                      <div class="otp-card__header">
                        <div class="otp-card__badge">
                          <VIcon icon="tabler-shield-lock" size="18" />
                        </div>
                        <div class="d-flex flex-column">
                          <span class="text-body-1 font-weight-semibold">
                            {{ $t('verification_code_sent_whatsapp') }}
                          </span>
                          <span class="text-caption text-medium-emphasis">
                            {{ $t('verification_code_subtitle') }}
                          </span>
                        </div>
                        <VChip
                          color="primary"
                          size="small"
                          variant="tonal"
                          class="ms-auto"
                        >
                          {{ $t('whatsapp') }}
                        </VChip>
                      </div>

                      <VDivider class="my-4" />

                      <div class="otp-input-wrapper">
                        <VOtpInput
                          v-model="verificationCode"
                          length="6"
                          type="text"
                          variant="outlined"
                          density="compact"
                          class="otp-input-custom"
                          :rules="[
                            requiredValidator(
                              verificationCode,
                              $t('verification_code_required')
                            ),
                          ]"
                        />
                      </div>

                      <p class="otp-hint text-caption text-medium-emphasis">
                        {{ $t('verification_code_sent_whatsapp') }}
                      </p>
                    </VCard>
                  </VCol>
                </VRow>
              </div>
            </VWindowItem>

            <VWindowItem>
              <div class="register-step-content">
                <h5 class="text-h5 mb-1">{{ $t('data') }}</h5>
                <p class="text-sm mb-6">
                  {{ $t('data_description') }}
                </p>

                <VForm ref="refFormData">
                  <VRow>
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
                        :rules="[
                          requiredValidator(
                            user_document_type_id,
                            $t('user_document_type_id_required')
                          ),
                        ]"
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
                        :rules="[
                          requiredValidator(country_id, $t('country_required')),
                        ]"
                        @select="
                          (item) => onCountryChange(item.value as number | null)
                        "
                        @update:modelValue="
                          (val) => onCountryChange(val as number | null)
                        "
                      />
                    </VCol>

                    <VCol cols="12" md="6">
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

                    <VCol cols="12" md="6">
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
                        :rules="[
                          requiredValidator(state_id, $t('state_required')),
                        ]"
                        @select="
                          (item) => {
                            onStateChange(item.value as string | null);
                            state = item.title || '';
                          }
                        "
                      />
                    </VCol>

                    <VCol cols="12" md="6">
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
                        :rules="[
                          requiredValidator(city_id, $t('city_required')),
                        ]"
                        @select="
                          (item) => {
                            city = item.title || '';
                          }
                        "
                      />
                    </VCol>

                    <VCol cols="12" md="6">
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

                    <VCol cols="12" md="6">
                      <VLabel class="text-body-2 mb-1"
                        >{{ $t('address_secondary') }}:</VLabel
                      >
                      <AppTextField
                        v-model="address2"
                        :disabled="!country_id"
                        :placeholder="$t('address_secondary')"
                      />
                    </VCol>

                    <VCol cols="12" md="6">
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
              <div class="register-step-content register-step-plans">
                <h5 class="text-h5 mb-1">{{ $t('plans') }}</h5>
                <p class="text-sm mb-6">
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
                        <VCardText class="position-relative">
                          <div
                            v-if="
                              selectedPlanForCheckout?.plan_id === plan.plan_id
                            "
                            class="plan-selected-badge"
                          >
                            <VChip color="primary" size="small" variant="flat">
                              <VIcon icon="tabler-check" size="16" start />
                              {{ $t('selected') }}
                            </VChip>
                          </div>
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
                </div>
              </div>
            </VWindowItem>

            <VWindowItem v-if="ADDONS_STEP_INDEX !== -1">
              <div class="register-step-content">
                <h5 class="text-h5 mb-1">{{ $t('addons') }}</h5>
                <p class="text-sm mb-6">
                  {{ $t('addons_description') }}
                </p>

                <div v-if="loadingCrossSells" class="text-center py-8">
                  <VProgressCircular indeterminate color="primary" size="64" />
                </div>

                <div
                  v-if="!loadingCrossSells && groupedCrossSells.length === 0"
                  class="text-center py-8"
                >
                  <p class="text-body-1 text-medium-emphasis mb-0">
                    {{ $t('unavailable') }}
                  </p>
                </div>

                <div
                  v-if="!loadingCrossSells && groupedCrossSells.length > 0"
                  class="d-flex flex-column gap-6"
                >
                  <VRow>
                    <VCol
                      v-for="group in groupedCrossSells"
                      :key="group.product_id"
                      cols="12"
                      md="6"
                    >
                      <VCard variant="outlined" class="h-100">
                        <VCardText class="d-flex flex-column gap-4 h-100">
                          <div class="d-flex align-center gap-3">
                            <VAvatar color="primary" variant="tonal" size="36">
                              <VIcon
                                icon="tabler-plus"
                                size="20"
                                color="primary"
                              />
                            </VAvatar>
                            <div>
                              <h6 class="text-h6 mb-1">
                                {{ group.product_name }}
                              </h6>
                              <p
                                v-if="group.product_description"
                                class="text-body-2 text-medium-emphasis mb-0"
                              >
                                {{ group.product_description }}
                              </p>
                            </div>
                          </div>

                          <VSelect
                            v-model="selectedCrossSellByType[group.product_id]"
                            :items="group.options"
                            :label="$t('addons')"
                            :item-title="getCrossSellLabel"
                            item-value="plan_cross_sell_id"
                            density="compact"
                            variant="outlined"
                          />

                          <VBtn
                            block
                            color="primary"
                            :disabled="
                              !canAddCrossSell(group.product_id) ||
                              isAddonSelected(group.product_id)
                            "
                            @click="addAddon(group.product_id)"
                          >
                            {{ $t('add') }}
                          </VBtn>
                        </VCardText>
                      </VCard>
                    </VCol>
                  </VRow>

                  <VCard variant="outlined">
                    <VCardText class="d-flex flex-column gap-3">
                      <div class="d-flex align-center justify-space-between">
                        <h6 class="text-h6 mb-0">{{ $t('addons') }}</h6>
                        <span class="text-body-1 font-weight-medium">
                          {{ formatCurrency(addonsTotal) }}
                        </span>
                      </div>

                      <div
                        v-if="selectedAddons.length > 0"
                        class="d-flex flex-column gap-2"
                      >
                        <div
                          v-for="addon in selectedAddons"
                          :key="addon.plan_cross_sell_id"
                          class="d-flex justify-space-between align-center"
                        >
                          <div class="d-flex flex-column">
                            <span class="text-body-1 font-weight-medium">
                              {{ addon.name }}
                            </span>
                            <span class="text-caption text-medium-emphasis">
                              x{{ addon.quantity }}
                            </span>
                          </div>
                          <div class="d-flex align-center gap-3">
                            <span class="text-body-1 font-weight-medium">
                              {{
                                formatCurrency(getAddonPriceValue(addon.price))
                              }}
                            </span>
                            <VBtn
                              icon
                              variant="text"
                              color="error"
                              @click="removeAddon(addon.plan_product_id)"
                            >
                              <VIcon icon="tabler-trash" size="18" />
                            </VBtn>
                          </div>
                        </div>
                      </div>

                      <div
                        v-if="selectedAddons.length === 0"
                        class="text-body-2 text-medium-emphasis text-center"
                      >
                        {{ $t('addons_subtitle') }}
                      </div>
                    </VCardText>
                  </VCard>
                </div>
              </div>
            </VWindowItem>

            <VWindowItem>
              <div class="register-step-content">
                <h5 class="text-h5 mb-1">
                  {{
                    selectedPlanForCheckout &&
                    isTestPlan(selectedPlanForCheckout)
                      ? $t('test')
                      : $t('payment')
                  }}
                </h5>
                <p class="text-sm mb-6">
                  {{
                    selectedPlanForCheckout &&
                    isTestPlan(selectedPlanForCheckout)
                      ? $t('test_subtitle')
                      : $t('payment_subtitle')
                  }}
                </p>

                <div v-if="selectedPlanForCheckout">
                  <div v-if="isTestPlan(selectedPlanForCheckout)">
                    <VCard variant="outlined">
                      <VCardText>
                        <h4 class="text-h6 mb-4">
                          {{ $t('selected_plan') }}
                        </h4>

                        <div class="d-flex align-center gap-3 mb-3">
                          <VIcon
                            :icon="
                              selectedPlanForCheckout.icon || 'tabler-rocket'
                            "
                            size="32"
                            color="primary"
                          />
                          <div>
                            <h5 class="text-h6 mb-1">
                              {{ selectedPlanForCheckout.name }}
                            </h5>
                            <p
                              v-if="selectedPlanForCheckout.description"
                              class="text-body-2 text-medium-emphasis mb-0"
                            >
                              {{ selectedPlanForCheckout.description }}
                            </p>
                          </div>
                        </div>

                        <VDivider class="my-4" />

                        <div
                          class="d-flex align-center justify-space-between mb-4"
                        >
                          <span class="text-body-1 font-weight-medium">
                            {{ $t('subtotal') }}
                          </span>
                          <span class="text-body-1 font-weight-medium">
                            {{
                              formatCurrency(getPrice(selectedPlanForCheckout))
                            }}
                          </span>
                        </div>

                        <div class="mb-2">
                          <div
                            v-if="selectedAddons.length > 0"
                            class="d-flex flex-column gap-2 mb-2"
                          >
                            <div
                              v-for="addon in selectedAddons"
                              :key="addon.plan_cross_sell_id"
                              class="d-flex justify-space-between align-center"
                            >
                              <span class="text-body-2 text-medium-emphasis">
                                {{ addon.name }} (x{{ addon.quantity }})
                              </span>
                              <span class="text-body-2 font-weight-medium">
                                {{
                                  formatCurrency(
                                    getAddonPriceValue(addon.price)
                                  )
                                }}
                              </span>
                            </div>
                          </div>
                          <div v-if="selectedAddons.length === 0">
                            <span class="text-body-2 text-medium-emphasis">
                              {{ $t('addons') }}:
                            </span>
                            <span class="text-body-2 font-weight-medium ml-2">
                              {{ formatCurrency(0) }}
                            </span>
                          </div>
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

                  <div v-if="!isTestPlan(selectedPlanForCheckout)">
                    <h5 class="text-h6 mb-4">
                      {{ $t('select_payment_method') }}
                    </h5>

                    <VRow>
                      <VCol cols="12" md="4">
                        <VCard
                          :class="[
                            'payment-method-card',
                            selectedPaymentMethod === 'boleto'
                              ? 'payment-method-selected'
                              : '',
                          ]"
                          :variant="
                            selectedPaymentMethod === 'boleto'
                              ? 'elevated'
                              : 'outlined'
                          "
                          :elevation="
                            selectedPaymentMethod === 'boleto' ? 4 : 0
                          "
                          @click="selectedPaymentMethod = 'boleto'"
                          style="cursor: pointer"
                        >
                          <VCardText class="text-center">
                            <VIcon
                              icon="tabler-receipt"
                              size="48"
                              color="primary"
                              class="mb-3"
                            />
                            <h5 class="text-h6 mb-2">{{ $t('boleto') }}</h5>
                            <p class="text-body-2 text-medium-emphasis">
                              {{ $t('boleto_description') }}
                            </p>
                          </VCardText>
                        </VCard>
                      </VCol>

                      <VCol cols="12" md="4">
                        <VCard
                          :class="[
                            'payment-method-card',
                            selectedPaymentMethod === 'credit_card'
                              ? 'payment-method-selected'
                              : '',
                          ]"
                          :variant="
                            selectedPaymentMethod === 'credit_card'
                              ? 'elevated'
                              : 'outlined'
                          "
                          :elevation="
                            selectedPaymentMethod === 'credit_card' ? 4 : 0
                          "
                          @click="selectedPaymentMethod = 'credit_card'"
                          style="cursor: pointer"
                        >
                          <VCardText class="text-center">
                            <VIcon
                              icon="tabler-credit-card"
                              size="48"
                              color="primary"
                              class="mb-3"
                            />
                            <h5 class="text-h6 mb-2">
                              {{ $t('credit_card') }}
                            </h5>
                            <p class="text-body-2 text-medium-emphasis">
                              {{ $t('credit_card_description') }}
                            </p>
                          </VCardText>
                        </VCard>
                      </VCol>

                      <VCol cols="12" md="4">
                        <VCard
                          :class="[
                            'payment-method-card',
                            selectedPaymentMethod === 'pix'
                              ? 'payment-method-selected'
                              : '',
                          ]"
                          :variant="
                            selectedPaymentMethod === 'pix'
                              ? 'elevated'
                              : 'outlined'
                          "
                          :elevation="selectedPaymentMethod === 'pix' ? 4 : 0"
                          @click="selectedPaymentMethod = 'pix'"
                          style="cursor: pointer"
                        >
                          <VCardText class="text-center">
                            <VIcon
                              icon="tabler-qrcode"
                              size="48"
                              color="primary"
                              class="mb-3"
                            />
                            <h5 class="text-h6 mb-2">{{ $t('pix') }}</h5>
                            <p class="text-body-2 text-medium-emphasis">
                              {{ $t('pix_description') }}
                            </p>
                          </VCardText>
                        </VCard>
                      </VCol>
                    </VRow>

                    <VRow
                      class="mt-6"
                      v-if="selectedPaymentMethod === 'credit_card'"
                    >
                      <VCol cols="12" md="6">
                        <VCard variant="outlined" class="credit-card-form">
                          <VCardText class="d-flex flex-column gap-4">
                            <div
                              class="credit-card-preview"
                              :style="{
                                background: getBrandGradient(detectedBrand),
                              }"
                            >
                              <div class="brand-logo-wrapper">
                                <div
                                  v-if="getBrandLogoUrl(detectedBrand)"
                                  class="brand-logo"
                                >
                                  <img
                                    :src="getBrandLogoUrl(detectedBrand) || ''"
                                    :alt="detectedBrand || 'card brand'"
                                    class="brand-logo-img"
                                  />
                                </div>
                                <VIcon
                                  v-else
                                  icon="tabler-credit-card"
                                  size="32"
                                  color="white"
                                  class="brand-logo-icon"
                                />
                              </div>
                              <div
                                class="text-h5 text-white mb-4 font-weight-bold"
                              >
                                {{
                                  cardForm.card_number || '0000 0000 0000 0000'
                                }}
                              </div>
                              <div
                                class="d-flex justify-space-between align-end"
                              >
                                <div>
                                  <div
                                    class="text-body-2 text-white text-medium-emphasis mb-1"
                                  >
                                    {{ $t('cardholder_name') }}
                                  </div>
                                  <div
                                    class="text-body-1 text-white font-weight-medium"
                                  >
                                    {{
                                      cardForm.cardholder_name ||
                                      $t('cardholder_name_placeholder')
                                    }}
                                  </div>
                                </div>
                                <div>
                                  <div
                                    class="text-body-2 text-white text-medium-emphasis mb-1"
                                  >
                                    {{ $t('expiry') }}
                                  </div>
                                  <div
                                    class="text-body-1 text-white font-weight-medium"
                                  >
                                    {{
                                      cardForm.expiry &&
                                      cardForm.expiry.length === 5
                                        ? cardForm.expiry
                                        : 'MM/AA'
                                    }}
                                  </div>
                                </div>
                              </div>
                            </div>
                            <VTextField
                              v-model="cardForm.cardholder_name"
                              :label="$t('cardholder_name')"
                              variant="outlined"
                              autocomplete="cc-name"
                            />
                            <VTextField
                              :model-value="cardForm.card_number"
                              :label="$t('card_number')"
                              variant="outlined"
                              maxlength="19"
                              autocomplete="cc-number"
                              @input="onCardNumberInput"
                            >
                              <template #append-inner>
                                <div
                                  v-if="getBrandLogoUrl(detectedBrand)"
                                  class="brand-logo-small"
                                >
                                  <img
                                    :src="getBrandLogoUrl(detectedBrand) || ''"
                                    :alt="detectedBrand || 'card brand'"
                                    class="brand-logo-img"
                                  />
                                </div>
                              </template>
                            </VTextField>
                            <div class="d-flex gap-3">
                              <VTextField
                                :model-value="cardForm.expiry"
                                :label="$t('expiry_date')"
                                variant="outlined"
                                maxlength="5"
                                class="flex-grow-1"
                                autocomplete="cc-exp"
                                @input="onExpiryInput"
                              />
                              <VTextField
                                :model-value="cardForm.cvv"
                                :label="$t('cvv')"
                                variant="outlined"
                                maxlength="4"
                                class="flex-grow-1"
                                autocomplete="cc-csc"
                                @input="onCvvInput"
                              />
                            </div>

                            <VCard variant="outlined">
                              <VCardText class="d-flex flex-column gap-3">
                                <div v-if="billingPeriod === 'annual'">
                                  <VLabel class="text-body-2 mb-1">
                                    {{ $t('select_installments') }}:
                                  </VLabel>
                                  <VSelect
                                    v-model="installments"
                                    :items="installmentOptions"
                                    variant="outlined"
                                    density="compact"
                                    item-title="title"
                                    item-value="value"
                                  />
                                </div>

                                <div>
                                  <VCheckbox
                                    v-model="recurringPayment"
                                    :label="$t('recurring_payment')"
                                    color="primary"
                                    hide-details
                                  />
                                  <p
                                    class="text-body-2 text-medium-emphasis mt-2"
                                  >
                                    {{ $t('recurring_payment_description') }}
                                  </p>
                                </div>
                              </VCardText>
                            </VCard>
                          </VCardText>
                        </VCard>
                      </VCol>

                      <VCol cols="12" md="6">
                        <VCard variant="outlined">
                          <VCardText>
                            <h4 class="text-h6 mb-4">
                              {{ $t('selected_plan') }}
                            </h4>

                            <div v-if="selectedPlanForCheckout" class="mb-4">
                              <div class="d-flex align-center gap-3 mb-3">
                                <VIcon
                                  :icon="
                                    selectedPlanForCheckout.icon ||
                                    'tabler-rocket'
                                  "
                                  size="32"
                                  color="primary"
                                />
                                <div>
                                  <h5 class="text-h6 mb-1">
                                    {{ selectedPlanForCheckout.name }}
                                  </h5>
                                  <p
                                    v-if="selectedPlanForCheckout.description"
                                    class="text-body-2 text-medium-emphasis mb-0"
                                  >
                                    {{ selectedPlanForCheckout.description }}
                                  </p>
                                </div>
                              </div>
                            </div>

                            <VDivider class="my-4" />

                            <div
                              class="d-flex align-center justify-space-between mb-4"
                            >
                              <span class="text-body-1 font-weight-medium">
                                {{ $t('subtotal') }}
                              </span>
                              <span class="text-body-1 font-weight-medium">
                                {{
                                  formatCurrency(
                                    getPrice(selectedPlanForCheckout)
                                  )
                                }}
                              </span>
                            </div>

                            <div class="mb-2">
                              <div
                                v-if="selectedAddons.length > 0"
                                class="d-flex flex-column gap-2 mb-2"
                              >
                                <div
                                  v-for="addon in selectedAddons"
                                  :key="addon.plan_cross_sell_id"
                                  class="d-flex justify-space-between align-center"
                                >
                                  <span
                                    class="text-body-2 text-medium-emphasis"
                                  >
                                    {{ addon.name }} (x{{ addon.quantity }})
                                  </span>
                                  <span class="text-body-2 font-weight-medium">
                                    {{
                                      formatCurrency(
                                        getAddonPriceValue(addon.price)
                                      )
                                    }}
                                  </span>
                                </div>
                              </div>
                              <div v-if="selectedAddons.length === 0">
                                <span class="text-body-2 text-medium-emphasis">
                                  {{ $t('addons') }}:
                                </span>
                                <span
                                  class="text-body-2 font-weight-medium ml-2"
                                >
                                  {{ formatCurrency(0) }}
                                </span>
                              </div>
                            </div>

                            <VDivider class="my-4" />

                            <div
                              class="d-flex align-center justify-space-between"
                            >
                              <span class="text-h6 font-weight-bold">
                                {{ $t('total') }}:
                              </span>
                              <span
                                class="text-h5 font-weight-bold text-primary"
                              >
                                {{ formatCurrency(totalPrice) }}
                              </span>
                            </div>
                          </VCardText>
                        </VCard>
                      </VCol>
                    </VRow>

                    <VRow
                      class="mt-6"
                      v-if="selectedPaymentMethod === 'boleto'"
                    >
                      <VCol cols="12" md="6">
                        <VCard variant="outlined">
                          <VCardText>
                            <h5 class="text-h6 mb-2">
                              {{ $t('boleto_summary') }}
                            </h5>
                            <p class="text-body-2 text-medium-emphasis">
                              {{ $t('boleto_instructions') }}
                            </p>
                          </VCardText>
                        </VCard>
                      </VCol>
                      <VCol cols="12" md="6">
                        <VCard variant="outlined">
                          <VCardText>
                            <h4 class="text-h6 mb-4">
                              {{ $t('selected_plan') }}
                            </h4>

                            <div v-if="selectedPlanForCheckout" class="mb-4">
                              <div class="d-flex align-center gap-3 mb-3">
                                <VIcon
                                  :icon="
                                    selectedPlanForCheckout.icon ||
                                    'tabler-rocket'
                                  "
                                  size="32"
                                  color="primary"
                                />
                                <div>
                                  <h5 class="text-h6 mb-1">
                                    {{ selectedPlanForCheckout.name }}
                                  </h5>
                                  <p
                                    v-if="selectedPlanForCheckout.description"
                                    class="text-body-2 text-medium-emphasis mb-0"
                                  >
                                    {{ selectedPlanForCheckout.description }}
                                  </p>
                                </div>
                              </div>
                            </div>

                            <VDivider class="my-4" />

                            <div
                              class="d-flex align-center justify-space-between mb-4"
                            >
                              <span class="text-body-1 font-weight-medium">
                                {{ $t('subtotal') }}
                              </span>
                              <span class="text-body-1 font-weight-medium">
                                {{
                                  formatCurrency(
                                    getPrice(selectedPlanForCheckout)
                                  )
                                }}
                              </span>
                            </div>

                            <div class="mb-2">
                              <div
                                v-if="selectedAddons.length > 0"
                                class="d-flex flex-column gap-2 mb-2"
                              >
                                <div
                                  v-for="addon in selectedAddons"
                                  :key="addon.plan_cross_sell_id"
                                  class="d-flex justify-space-between align-center"
                                >
                                  <span
                                    class="text-body-2 text-medium-emphasis"
                                  >
                                    {{ addon.name }} (x{{ addon.quantity }})
                                  </span>
                                  <span class="text-body-2 font-weight-medium">
                                    {{
                                      formatCurrency(
                                        getAddonPriceValue(addon.price)
                                      )
                                    }}
                                  </span>
                                </div>
                              </div>
                              <div v-if="selectedAddons.length === 0">
                                <span class="text-body-2 text-medium-emphasis">
                                  {{ $t('addons') }}:
                                </span>
                                <span
                                  class="text-body-2 font-weight-medium ml-2"
                                >
                                  {{ formatCurrency(0) }}
                                </span>
                              </div>
                            </div>

                            <VDivider class="my-4" />

                            <div
                              class="d-flex align-center justify-space-between"
                            >
                              <span class="text-h6 font-weight-bold">
                                {{ $t('total') }}:
                              </span>
                              <span
                                class="text-h5 font-weight-bold text-primary"
                              >
                                {{ formatCurrency(totalPrice) }}
                              </span>
                            </div>
                          </VCardText>
                        </VCard>
                      </VCol>
                    </VRow>

                    <VRow class="mt-6" v-if="selectedPaymentMethod === 'pix'">
                      <VCol cols="12" md="6">
                        <VCard variant="outlined">
                          <VCardText>
                            <h5 class="text-h6 mb-2">{{ $t('pix') }}</h5>
                            <p class="text-body-2 text-medium-emphasis">
                              {{ $t('pix_description') }}
                            </p>
                          </VCardText>
                        </VCard>
                      </VCol>
                      <VCol cols="12" md="6">
                        <VCard variant="outlined">
                          <VCardText>
                            <h4 class="text-h6 mb-4">
                              {{ $t('selected_plan') }}
                            </h4>

                            <div v-if="selectedPlanForCheckout" class="mb-4">
                              <div class="d-flex align-center gap-3 mb-3">
                                <VIcon
                                  :icon="
                                    selectedPlanForCheckout.icon ||
                                    'tabler-rocket'
                                  "
                                  size="32"
                                  color="primary"
                                />
                                <div>
                                  <h5 class="text-h6 mb-1">
                                    {{ selectedPlanForCheckout.name }}
                                  </h5>
                                  <p
                                    v-if="selectedPlanForCheckout.description"
                                    class="text-body-2 text-medium-emphasis mb-0"
                                  >
                                    {{ selectedPlanForCheckout.description }}
                                  </p>
                                </div>
                              </div>
                            </div>

                            <VDivider class="my-4" />

                            <div
                              class="d-flex align-center justify-space-between mb-4"
                            >
                              <span class="text-body-1 font-weight-medium">
                                {{ $t('subtotal') }}
                              </span>
                              <span class="text-body-1 font-weight-medium">
                                {{
                                  formatCurrency(
                                    getPrice(selectedPlanForCheckout)
                                  )
                                }}
                              </span>
                            </div>

                            <div class="mb-2">
                              <div
                                v-if="selectedAddons.length > 0"
                                class="d-flex flex-column gap-2 mb-2"
                              >
                                <div
                                  v-for="addon in selectedAddons"
                                  :key="addon.plan_cross_sell_id"
                                  class="d-flex justify-space-between align-center"
                                >
                                  <span
                                    class="text-body-2 text-medium-emphasis"
                                  >
                                    {{ addon.name }} (x{{ addon.quantity }})
                                  </span>
                                  <span class="text-body-2 font-weight-medium">
                                    {{
                                      formatCurrency(
                                        getAddonPriceValue(addon.price)
                                      )
                                    }}
                                  </span>
                                </div>
                              </div>
                              <div v-if="selectedAddons.length === 0">
                                <span class="text-body-2 text-medium-emphasis">
                                  {{ $t('addons') }}:
                                </span>
                                <span
                                  class="text-body-2 font-weight-medium ml-2"
                                >
                                  {{ formatCurrency(0) }}
                                </span>
                              </div>
                            </div>

                            <VDivider class="my-4" />

                            <div
                              class="d-flex align-center justify-space-between"
                            >
                              <span class="text-h6 font-weight-bold">
                                {{ $t('total') }}:
                              </span>
                              <span
                                class="text-h5 font-weight-bold text-primary"
                              >
                                {{ formatCurrency(totalPrice) }}
                              </span>
                            </div>
                          </VCardText>
                        </VCard>
                      </VCol>
                    </VRow>
                  </div>
                </div>
              </div>
            </VWindowItem>
          </VForm>
        </VWindow>

        <div class="d-flex justify-space-between mt-8 px-4">
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
              (currentStep === 3 && !selectedPlanForCheckout) ||
              registerStore.isLoading
            "
            :loading="isNextButtonLoading"
            @click="handleNext"
          >
            {{ nextButtonLabel }}

            <VIcon icon="tabler-arrow-right" end class="flip-in-rtl" />
          </VBtn>
        </div>
      </VCard>

      <VDialog v-model="pixModalOpen" max-width="500" persistent>
        <VCard>
          <VCardTitle class="d-flex align-center justify-space-between">
            <span>{{ $t('payment') }}</span>
            <VBtn icon variant="text" @click="closePixModal">
              <VIcon icon="tabler-x" />
            </VBtn>
          </VCardTitle>
          <VCardText>
            <VAlert
              :type="paymentStatusAlert.type"
              :icon="paymentStatusAlert.icon"
              variant="tonal"
              class="mb-4"
            >
              {{ paymentStatusAlert.message }}
            </VAlert>

            <div v-if="pixPaymentData && selectedPaymentMethod === 'pix'">
              <div class="text-center mb-4">
                <img
                  :src="pixPaymentData.qr_code"
                  alt="QR Code"
                  class="pix-qr-code mb-2"
                />
                <div class="d-flex justify-center gap-2">
                  <VBtn color="primary" variant="tonal" @click="copyPixCode">
                    {{ $t('copy_pix_code') }}
                  </VBtn>
                </div>
              </div>
              <p class="text-body-2 text-medium-emphasis text-center">
                {{ $t('pix_instructions') }}
              </p>
            </div>

            <div v-if="boletoPaymentData && selectedPaymentMethod === 'boleto'">
              <p class="text-body-1 font-weight-medium mb-2">
                {{ $t('boleto') }}
              </p>
              <p class="text-body-2 text-medium-emphasis mb-1">
                {{ boletoPaymentData.identification_field }}
              </p>
              <p class="text-body-2 text-medium-emphasis mb-2">
                {{ boletoPaymentData.nosso_numero }}
              </p>
              <div class="d-flex gap-2">
                <VBtn
                  color="primary"
                  variant="tonal"
                  :href="boletoPaymentData.bank_slip_url"
                  target="_blank"
                >
                  {{ $t('download') }}
                </VBtn>
              </div>
            </div>

            <div
              v-if="
                pixPaymentInitiated && selectedPaymentMethod === 'credit_card'
              "
              class="text-center"
            >
              <VIcon
                :icon="
                  paymentStatusAlert.type === 'success'
                    ? 'tabler-circle-check'
                    : 'tabler-clock-hour-4'
                "
                size="48"
                :color="
                  paymentStatusAlert.type === 'success' ? 'success' : 'info'
                "
                class="mb-2"
              />
              <p class="text-body-2 text-medium-emphasis">
                {{ paymentStatusAlert.message }}
              </p>
            </div>
          </VCardText>
          <VCardActions class="d-flex justify-end">
            <VBtn color="primary" @click="closePixModal">
              {{ $t('close') }}
            </VBtn>
          </VCardActions>
        </VCard>
      </VDialog>

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
  width: 100%;
  max-width: 100%;
}

.register-step-plans {
  max-width: 100%;
}

.credit-card-form {
  animation: slideDown 0.3s ease-out;
}

.credit-card-preview {
  border-radius: 16px;
  padding: 24px;
  color: white;
  min-height: 200px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
  position: relative;
  overflow: hidden;
}

.credit-card-preview::before {
  content: '';
  position: absolute;
  top: -50%;
  right: -50%;
  width: 200%;
  height: 200%;
  background: radial-gradient(
    circle,
    rgba(255, 255, 255, 0.1) 0%,
    transparent 70%
  );
  pointer-events: none;
}

.brand-logo-wrapper {
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.brand-logo {
  width: 48px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.brand-logo-img {
  max-width: 48px;
  max-height: 32px;
  object-fit: contain;
}

.brand-logo-icon {
  opacity: 0.9;
}

.brand-logo-small {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 24px;
}
.plans-row {
  margin-top: 16px;
  justify-content: center;
}

.plan-col {
  margin-bottom: 24px;
  display: flex;
}

.plan-card {
  height: 100%;
  transition:
    transform 0.2s ease-in-out,
    box-shadow 0.2s ease-in-out;
  overflow: visible;
  position: relative;
  width: 100%;

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.1);
  }
}

.plan-card-popular {
  border: 2px solid rgb(var(--v-theme-primary));
  position: relative;
}

.plan-selected-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  pointer-events: none;
}

.otp-input-wrapper {
  width: 100%;
  display: flex;
  justify-content: center;
  margin-bottom: 1.25rem;
}

.otp-input-custom {
  .v-otp-input {
    gap: 0.75rem;
  }

  .v-field {
    border-radius: 12px;
    font-size: 1.1rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    min-width: 56px;
    height: 64px;
    background-color: rgb(var(--v-theme-surface));
    border: 1px solid rgb(var(--v-theme-primary) / 0.18);
    box-shadow: 0 10px 30px -18px rgb(var(--v-theme-on-surface) / 0.5);
    transition:
      transform 0.15s ease,
      box-shadow 0.2s ease,
      border-color 0.2s ease;

    .v-field__input {
      text-align: center;
      text-transform: uppercase;
      padding-block: 10px;
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
  padding: 20px;
  background:
    linear-gradient(135deg, rgb(var(--v-theme-primary) / 0.1), transparent 60%),
    rgb(var(--v-theme-surface-variant));
  border-radius: 16px;
  border: 1px solid rgb(var(--v-theme-primary) / 0.14);
  box-shadow: 0 18px 60px -26px rgb(var(--v-theme-on-surface) / 0.4);
  position: relative;
  overflow: hidden;

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
  display: grid;
  place-items: center;
  border-radius: 12px;
  background-color: rgb(var(--v-theme-primary) / 0.12);
  color: rgb(var(--v-theme-primary));
}

.otp-hint {
  text-align: center;
  margin: 0;
  position: relative;
  z-index: 1;
}

.payment-method-card {
  transition:
    transform 0.2s ease-in-out,
    box-shadow 0.2s ease-in-out;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
  }
}

.payment-method-selected {
  border: 2px solid rgb(var(--v-theme-primary));
}

.credit-card-form {
  animation: slideDown 0.2s ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>

<route lang="yaml">
meta:
  layout: 'blank'
  public: true
  unauthenticatedOnly: true
</route>
