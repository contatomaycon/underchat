<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EPlanPermissions } from '@core/common/enums/EPermissions/plan';
import { usePlanStore } from '@/@webcore/stores/plan';
import { useAccountSettingsStore } from '@/@webcore/stores/accountSettings';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { getUser } from '@/@webcore/localStorage/user';
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
import { ListPlanWithItemsResponse } from '@core/schema/plan/listPlanWithItems/response.schema';
import { ListPlanProductWithPriceResponse } from '@core/schema/plan/listPlanProductWithPrice/response.schema';
import { ViewUserInfoResponse } from '@core/schema/plan/viewUserInfo/response.schema';
import { ListUserCardResponse } from '@core/schema/plan/listUserCards/response.schema';
import { CalculateUpgradeDiscountResponse } from '@core/schema/plan/calculateUpgradeDiscount/response.schema';
import creditCardType from 'credit-card-type';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EPlanPermissions.plan_group,
      EPlanPermissions.plan_invoice,
    ],
  },
});

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const planStore = usePlanStore();
const accountSettingsStore = useAccountSettingsStore();
useSnackbarCleanup(planStore);

const currentStep = ref(1);
const loading = ref(false);
const billingPeriod = ref<'monthly' | 'annual'>('monthly');
const plans = ref<ListPlanWithItemsResponse[]>([]);
const selectedPlanForCheckout = ref<ListPlanWithItemsResponse | null>(null);
const currentPlanId = ref<string | null>(null);
const currentPlan = ref<ListPlanWithItemsResponse | null>(null);
const currentPlanBillingPeriod = ref<'monthly' | 'annual' | null>(null);
const availableProducts = ref<ListPlanProductWithPriceResponse[]>([]);
const selectedAddons = ref<
  Array<{
    plan_product_id: string;
    name: string;
    quantity: number;
    price?: number;
  }>
>([]);
const loadingProducts = ref(false);
const currentUser = ref<ViewUserInfoResponse | null>(null);
const loadingUser = ref(false);
const userCards = ref<ListUserCardResponse[]>([]);
const loadingCards = ref(false);
const upgradeDiscount = ref<CalculateUpgradeDiscountResponse | null>(null);
const loadingDiscount = ref(false);
const selectedPaymentMethod = ref<'boleto' | 'credit_card' | 'pix' | null>(
  null
);
const selectedCardId = ref<string | null>(null);
const showAddCardModal = ref(false);
const newCard = ref({
  number: '',
  holderName: '',
  expiryMonth: '',
  expiryYear: '',
  cvv: '',
});
const detectedBrand = ref<string | null>(null);
const showCvv = ref(false);
const step1Loaded = ref(false);
const step2Loaded = ref(false);
const step3Loaded = ref(false);
const step4Loaded = ref(false);
const expiryError = ref<string | null>(null);

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
  plan: ListPlanWithItemsResponse
): number => {
  return plan.price * 12;
};

const getAnnualPrice = (plan: ListPlanWithItemsResponse): number => {
  const annualPrice = getAnnualPriceWithoutDiscount(plan);
  if (plan.annual_discount) {
    const discount = Number.parseFloat(plan.annual_discount);
    return annualPrice * (1 - discount / 100);
  }
  return annualPrice;
};

const getPrice = (plan: ListPlanWithItemsResponse): number => {
  if (billingPeriod.value === 'annual') {
    return getAnnualPrice(plan);
  }
  return plan.price;
};

const loadStep1 = async () => {
  if (step1Loaded.value) return;

  loading.value = true;
  const planId = route.query.plan_id as string;
  const billing = (route.query.billing as 'monthly' | 'annual') || 'monthly';

  billingPeriod.value = billing;

  const [plansList, currentPlanIdValue, currentPlanInvoice] = await Promise.all(
    [
      planStore.listPlanWithItems(),
      planStore.getCurrentPlan(),
      accountSettingsStore.getCurrentPlanInvoice(),
    ]
  );

  if (plansList) {
    plans.value = plansList;
    currentPlanId.value = currentPlanIdValue;

    if (currentPlanIdValue) {
      currentPlan.value =
        plansList.find((p) => p.plan_id === currentPlanIdValue) || null;
    } else {
      currentPlan.value = null;
    }

    if (currentPlanInvoice?.billing_period) {
      currentPlanBillingPeriod.value = currentPlanInvoice.billing_period as
        | 'monthly'
        | 'annual';

      if (currentPlanBillingPeriod.value === 'annual') {
        billingPeriod.value = 'annual';
      }
    } else {
      currentPlanBillingPeriod.value = null;
    }

    if (planId) {
      const plan = plansList.find((p) => p.plan_id === planId);
      if (plan) {
        selectedPlanForCheckout.value = plan;
        currentStep.value = 2;

        loadUpgradeDiscount();
      }
    }
  }

  step1Loaded.value = true;
  loading.value = false;
};

const loadStep2 = async () => {
  if (step2Loaded.value) return;

  loadingProducts.value = true;
  const products = await planStore.listPlanProductWithPrice();
  if (products) {
    availableProducts.value = products;
  }
  loadingProducts.value = false;
  step2Loaded.value = true;
};

const loadStep3 = async () => {
  if (step3Loaded.value) return;

  await loadUserData();
  step3Loaded.value = true;
};

const loadStep4 = async () => {
  if (step4Loaded.value) return;

  await Promise.all([loadUserCards(), loadUpgradeDiscount()]);
  step4Loaded.value = true;
};

const loadUpgradeDiscount = async () => {
  if (!selectedPlanForCheckout.value) return;

  loadingDiscount.value = true;
  const discount = await planStore.calculateUpgradeDiscount(
    selectedPlanForCheckout.value.plan_id
  );
  if (discount) {
    upgradeDiscount.value = discount;
  }
  loadingDiscount.value = false;
};

const loadUserData = async () => {
  loadingUser.value = true;
  const userData = await planStore.viewUserInfo();
  if (userData) {
    currentUser.value = userData;
  }
  loadingUser.value = false;
};

const loadUserCards = async () => {
  const user = getUser();
  if (!user?.user_id) return;

  loadingCards.value = true;
  const cards = await planStore.listUserCards();
  if (cards) {
    userCards.value = cards;

    const defaultCard = cards.find((c) => c.default);
    if (defaultCard) {
      selectedCardId.value = defaultCard.user_card_id;
    }
  }
  loadingCards.value = false;
};

const isCurrentPlan = (planId: string): boolean => {
  return currentPlanId.value === planId;
};

const getCurrentPlanPrice = (): number | null => {
  if (!currentPlan.value) return null;
  return getPrice(currentPlan.value);
};

const isDowngrade = (plan: ListPlanWithItemsResponse): boolean => {
  const currentPrice = getCurrentPlanPrice();
  if (currentPrice === null) return false;

  const planPrice = getPrice(plan);
  return planPrice < currentPrice;
};

const isInvalidBillingPeriodChange = (
  plan: ListPlanWithItemsResponse
): boolean => {
  if (!currentPlanBillingPeriod.value) return false;

  if (
    currentPlanBillingPeriod.value === 'annual' &&
    billingPeriod.value === 'monthly'
  ) {
    return true;
  }

  return false;
};

watch(billingPeriod, (newValue) => {
  if (currentPlanBillingPeriod.value === 'annual' && newValue === 'monthly') {
    billingPeriod.value = 'annual';
  }
});

const isPlanDisabled = (plan: ListPlanWithItemsResponse): boolean => {
  return (
    isCurrentPlan(plan.plan_id) ||
    isDowngrade(plan) ||
    isInvalidBillingPeriodChange(plan)
  );
};

const getButtonText = (planId: string): string => {
  if (isCurrentPlan(planId)) {
    return t('your_current_plan');
  }
  return t('upgrade');
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

const getColClasses = computed(() => {
  const count = plans.value.length;

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

const selectPlan = (plan: ListPlanWithItemsResponse) => {
  if (isPlanDisabled(plan)) return;
  selectedPlanForCheckout.value = plan;
  currentStep.value = 2;

  loadUpgradeDiscount();
};

const nextStep = () => {
  if (currentStep.value < 4) {
    currentStep.value += 1;
  }
};

const prevStep = () => {
  if (currentStep.value > 1) {
    currentStep.value -= 1;
  }
};

const addAddon = (product: ListPlanProductWithPriceResponse) => {
  const existingAddon = selectedAddons.value.find(
    (a) => a.plan_product_id === product.plan_product_id
  );

  if (existingAddon) {
    existingAddon.quantity += 1;
  } else {
    selectedAddons.value.push({
      plan_product_id: product.plan_product_id,
      name: product.name || '',
      quantity: 1,
      price: product.price ?? undefined,
    });
  }
};

const removeAddon = (productId: string) => {
  const index = selectedAddons.value.findIndex(
    (a) => a.plan_product_id === productId
  );

  if (index !== -1) {
    if (selectedAddons.value[index].quantity > 1) {
      selectedAddons.value[index].quantity -= 1;
    } else {
      selectedAddons.value.splice(index, 1);
    }
  }
};

const getAddonQuantity = (productId: string): number => {
  const addon = selectedAddons.value.find(
    (a) => a.plan_product_id === productId
  );
  return addon?.quantity || 0;
};

const getAddonPrice = (addon: {
  plan_product_id: string;
  name: string;
  quantity: number;
  price?: number;
}): number => {
  const addonPrice = addon.price || 0;
  const multiplier = billingPeriod.value === 'annual' ? 12 : 1;
  return addonPrice * addon.quantity * multiplier;
};

const getAddonsTotal = computed(() => {
  return selectedAddons.value.reduce((total, addon) => {
    return total + getAddonPrice(addon);
  }, 0);
});

const getCheckoutTotal = computed(() => {
  if (!selectedPlanForCheckout.value) return 0;

  const planPrice = getPrice(selectedPlanForCheckout.value);
  const addonsTotal = getAddonsTotal.value;
  return planPrice + addonsTotal;
});

const goBack = () => {
  router.push({ name: 'plans' });
};

const detectCardBrand = (cardNumber: string): string | null => {
  const cleaned = cardNumber.replace(/\s/g, '');

  if (cleaned.length < 4) return null;

  try {
    const cardTypes = creditCardType(cleaned);

    if (cardTypes && cardTypes.length > 0) {
      const type = cardTypes[0].type?.toUpperCase();

      const typeMap: Record<string, string> = {
        VISA: 'VISA',
        MASTERCARD: 'MASTERCARD',
        'AMERICAN-EXPRESS': 'AMEX',
        'DINERS-CLUB': 'DINERS',
        DISCOVER: 'DISCOVER',
        JCB: 'JCB',
        UNIONPAY: 'UNIONPAY',
        MAESTRO: 'MAESTRO',
        MIR: 'MIR',
        ELO: 'ELO',
      };

      const mappedType = typeMap[type || ''];

      if (mappedType) {
        return mappedType;
      }
    }

    if (cleaned.match(/^(606282|3841)/)) {
      return 'HIPERCARD';
    }

    if (cleaned.match(/^(5018|5020|5038|6304|6759|6761|6762|6763)/)) {
      return 'MELI';
    }

    if (cleaned.match(/^(5090|5091|5092)/)) {
      return 'REAL';
    }
  } catch (error) {
    return null;
  }

  return null;
};

const formatCardNumber = (value: string): string => {
  const cleaned = value.replace(/\s/g, '');
  const chunks = cleaned.match(/.{1,4}/g);
  return chunks ? chunks.join(' ') : cleaned;
};

const onCardNumberInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const value = target.value.replace(/\D/g, '');
  newCard.value.number = formatCardNumber(value);
  detectedBrand.value = detectCardBrand(value);
};

const formatExpiry = (value: string): string => {
  const cleaned = value.replace(/\D/g, '');

  if (cleaned.length === 0) {
    return '';
  }

  if (cleaned.length === 1) {
    const firstDigit = parseInt(cleaned[0], 10);
    if (firstDigit > 1) {
      return `0${firstDigit}`;
    }
    return cleaned;
  }

  if (cleaned.length >= 2) {
    const month = cleaned.slice(0, 2);
    const monthNum = parseInt(month, 10);

    if (monthNum > 12) {
      return `12/${cleaned.slice(2, 4)}`;
    }

    if (cleaned.length === 2) {
      return month;
    }

    return `${month}/${cleaned.slice(2, 4)}`;
  }

  return cleaned;
};

const validateExpiry = (month: string, year: string): string | null => {
  if (!month || month.length !== 2) {
    return null;
  }

  const monthNum = parseInt(month, 10);

  if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
    return t('invalid_month');
  }

  if (!year || year.length !== 2) {
    return null;
  }

  const yearNum = parseInt(year, 10);

  if (isNaN(yearNum)) {
    return t('invalid_year');
  }

  const currentDate = new Date();
  const currentYear = currentDate.getFullYear() % 100;
  const currentMonth = currentDate.getMonth() + 1;
  const fullYear = 2000 + yearNum;

  if (fullYear < currentDate.getFullYear()) {
    return t('card_expired');
  }

  if (fullYear === currentDate.getFullYear() && monthNum < currentMonth) {
    return t('card_expired');
  }

  return null;
};

const onExpiryInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  let value = target.value.replace(/\D/g, '');

  if (value.length > 4) {
    value = value.slice(0, 4);
  }

  const formatted = formatExpiry(value);
  const parts = formatted.split('/');
  const month = parts[0] || '';
  const year = parts[1] || '';

  newCard.value.expiryMonth = month;
  newCard.value.expiryYear = year;

  if (month.length === 2) {
    if (year.length === 2) {
      expiryError.value = validateExpiry(month, year);
    } else {
      expiryError.value = null;
    }
  } else {
    expiryError.value = null;
  }

  target.value = formatted;
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

  const url =
    typeof logoPath === 'string'
      ? logoPath
      : (logoPath as any)?.default || logoPath;

  return url;
};

const getBrandGradient = (brand: string | null): string => {
  const neutralGradient = 'linear-gradient(135deg, #3e475a 0%, #515c73 100%)';

  if (!brand) return neutralGradient;

  const brandGradients: Record<string, string> = {
    VISA: 'linear-gradient(135deg, #55627a 0%, #6a7893 100%)',
    MASTERCARD: 'linear-gradient(135deg, #6b3b3b 0%, #7e4d4a 100%)',
    AMEX: 'linear-gradient(135deg, #4f6a87 0%, #6380a0 100%)',
    ELO: 'linear-gradient(135deg, #73643a 0%, #86784e 100%)',
    DINERS: 'linear-gradient(135deg, #4d6478 0%, #607b90 100%)',
    DISCOVER: 'linear-gradient(135deg, #775634 0%, #8b6947 100%)',
    JCB: 'linear-gradient(135deg, #4e6688 0%, #637ca0 100%)',
    MAESTRO: 'linear-gradient(135deg, #6f4141 0%, #835454 100%)',
    HIPERCARD: 'linear-gradient(135deg, #6f3f3d 0%, #834f4c 100%)',
    MELI: 'linear-gradient(135deg, #736a3a 0%, #877d4e 100%)',
    REAL: 'linear-gradient(135deg, #7a5638 0%, #8e684a 100%)',
    UNIONPAY: 'linear-gradient(135deg, #4a5268 0%, #5d6780 100%)',
    MIR: 'linear-gradient(135deg, #4a5268 0%, #5d6780 100%)',
  };

  return brandGradients[brand] || neutralGradient;
};

watch(currentStep, async (newStep) => {
  if (newStep === 1 && !step1Loaded.value) {
    await loadStep1();
  } else if (newStep === 2 && !step2Loaded.value) {
    await loadStep2();
  } else if (newStep === 3 && !step3Loaded.value) {
    await loadStep3();
  } else if (newStep === 4 && !step4Loaded.value) {
    await loadStep4();
  }
});

watch(selectedPaymentMethod, (newMethod) => {
  if (newMethod !== 'credit_card' && showAddCardModal.value) {
    showAddCardModal.value = false;
  }
});

onMounted(async () => {
  await loadStep1();
});
</script>

<template>
  <div>
    <VCard :title="$t('checkout')" no-padding>
      <VCardText>
        <div v-if="loading" class="text-center py-8">
          <VProgressCircular indeterminate color="primary" size="64" />
        </div>

        <div v-else>
          <div class="d-flex align-center gap-3 mb-4">
            <VBtn icon variant="text" @click="goBack">
              <VIcon>tabler-arrow-left</VIcon>
            </VBtn>
          </div>

          <VStepper v-model="currentStep" alt-labels>
            <!-- Step 1: Seleção de Planos -->
            <VStepperHeader>
              <VStepperItem :value="1" :title="$t('select_plan')" />
              <VDivider />
              <VStepperItem :value="2" :title="$t('plan_and_addons')" />
              <VDivider />
              <VStepperItem :value="3" :title="$t('user_information')" />
              <VDivider />
              <VStepperItem :value="4" :title="$t('payment')" />
            </VStepperHeader>

            <VStepperWindow>
              <!-- Step 1: Seleção de Planos -->
              <VStepperWindowItem :value="1">
                <div class="mb-6">
                  <div class="d-flex flex-column align-center mb-8">
                    <h2 class="text-h4 mb-2">{{ $t('pricing_plans') }}</h2>
                    <p class="text-body-1 text-medium-emphasis text-center">
                      {{ $t('pricing_plans_subtitle') }}
                    </p>

                    <div class="d-flex align-center gap-4 mt-6">
                      <span
                        :class="[
                          'text-body-1',
                          billingPeriod === 'monthly'
                            ? 'text-primary'
                            : 'text-disabled',
                          currentPlanBillingPeriod === 'annual'
                            ? 'text-disabled'
                            : '',
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
                        :disabled="currentPlanBillingPeriod === 'annual'"
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
                    v-if="plans.length > 0"
                    class="plans-row"
                    justify="center"
                  >
                    <VCol
                      v-for="(plan, index) in plans"
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
                          isCurrentPlan(plan.plan_id)
                            ? 'plan-card-current'
                            : '',
                          selectedPlanForCheckout?.plan_id === plan.plan_id &&
                          !isPlanDisabled(plan)
                            ? 'plan-card-popular'
                            : '',
                          isDowngrade(plan) ? 'plan-card-disabled' : '',
                        ]"
                        :variant="
                          isCurrentPlan(plan.plan_id)
                            ? 'elevated'
                            : selectedPlanForCheckout?.plan_id ===
                                  plan.plan_id && !isPlanDisabled(plan)
                              ? 'elevated'
                              : 'outlined'
                        "
                        :elevation="
                          isCurrentPlan(plan.plan_id)
                            ? 4
                            : selectedPlanForCheckout?.plan_id ===
                                  plan.plan_id && !isPlanDisabled(plan)
                              ? 4
                              : 0
                        "
                        @click="!isPlanDisabled(plan) && selectPlan(plan)"
                        :style="
                          isPlanDisabled(plan)
                            ? 'cursor: not-allowed'
                            : 'cursor: pointer'
                        "
                      >
                        <VCardText class="position-relative">
                          <div
                            v-if="isDowngrade(plan)"
                            class="plan-disabled-overlay"
                          >
                            <VChip color="error" size="small" variant="tonal">
                              {{ $t('unavailable') }}
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
                              :class="{ 'opacity-50': isDowngrade(plan) }"
                            >
                              <VIcon
                                :icon="plan.icon || 'tabler-rocket'"
                                size="40"
                              />
                            </VAvatar>
                            <h3
                              class="text-h5 mb-2"
                              :class="{ 'text-disabled': isDowngrade(plan) }"
                            >
                              {{ plan.name }}
                            </h3>
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
                                /{{
                                  billingPeriod === 'annual'
                                    ? $t('year')
                                    : $t('month')
                                }}
                              </span>
                            </div>
                            <div
                              v-if="
                                billingPeriod === 'annual' &&
                                plan.annual_discount &&
                                Number.parseFloat(plan.annual_discount) > 0
                              "
                              class="text-body-2 text-medium-emphasis"
                            >
                              <s>
                                {{
                                  formatCurrency(
                                    getAnnualPriceWithoutDiscount(plan)
                                  )
                                }}/{{ $t('year') }}
                              </s>
                            </div>
                            <div
                              v-if="
                                billingPeriod === 'monthly' && plan.price === 0
                              "
                              class="text-body-2 text-medium-emphasis"
                            >
                              {{ $t('free') }}
                            </div>
                            <div
                              v-if="
                                billingPeriod === 'monthly' &&
                                plan.price_old > plan.price
                              "
                              class="text-body-2"
                            >
                              <s class="text-medium-emphasis">
                                {{ formatCurrency(plan.price_old) }}
                              </s>
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
                            <div
                              v-if="plan.plan_items.length === 0"
                              class="text-body-2 text-medium-emphasis"
                            >
                              {{ $t('no_items_available') }}
                            </div>
                          </div>

                          <VBtn
                            block
                            :color="
                              isCurrentPlan(plan.plan_id)
                                ? 'success'
                                : selectedPlanForCheckout?.plan_id ===
                                    plan.plan_id
                                  ? 'primary'
                                  : 'default'
                            "
                            :variant="
                              isCurrentPlan(plan.plan_id)
                                ? 'flat'
                                : selectedPlanForCheckout?.plan_id ===
                                    plan.plan_id
                                  ? 'flat'
                                  : 'outlined'
                            "
                            :disabled="isPlanDisabled(plan)"
                            @click.stop="
                              !isPlanDisabled(plan) && selectPlan(plan)
                            "
                          >
                            {{
                              isDowngrade(plan)
                                ? $t('unavailable')
                                : getButtonText(plan.plan_id)
                            }}
                          </VBtn>
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
              </VStepperWindowItem>

              <!-- Step 2: Plano e Adicionais -->
              <VStepperWindowItem :value="2">
                <div v-if="selectedPlanForCheckout">
                  <VRow>
                    <!-- Plano Selecionado - Esquerda -->
                    <VCol cols="12" md="6">
                      <h4 class="text-h6 mb-4">{{ $t('selected_plan') }}</h4>
                      <VCard variant="outlined">
                        <VCardText>
                          <div class="text-center mb-4">
                            <VAvatar
                              color="primary"
                              size="80"
                              variant="tonal"
                              class="mb-4"
                            >
                              <VIcon
                                :icon="
                                  selectedPlanForCheckout.icon ||
                                  'tabler-rocket'
                                "
                                size="40"
                              />
                            </VAvatar>
                            <h4 class="text-h6 mb-2">
                              {{ selectedPlanForCheckout.name }}
                            </h4>
                            <p
                              v-if="selectedPlanForCheckout.description"
                              class="text-body-2 text-medium-emphasis mb-4"
                            >
                              {{ selectedPlanForCheckout.description }}
                            </p>
                          </div>
                          <VDivider class="mb-4" />
                          <div
                            class="d-flex align-center justify-space-between"
                          >
                            <span class="text-body-1 font-weight-medium"
                              >{{ $t('price') }}:</span
                            >
                            <div class="text-right">
                              <div
                                class="text-h5 font-weight-bold text-primary"
                              >
                                {{
                                  formatCurrency(
                                    getPrice(selectedPlanForCheckout)
                                  )
                                }}
                              </div>
                              <div class="text-body-2 text-medium-emphasis">
                                /{{
                                  billingPeriod === 'annual'
                                    ? $t('year')
                                    : $t('month')
                                }}
                              </div>
                            </div>
                          </div>
                        </VCardText>
                      </VCard>
                    </VCol>

                    <!-- Adicionais - Direita -->
                    <VCol cols="12" md="6">
                      <h4 class="text-h6 mb-4">{{ $t('addons') }}</h4>

                      <VCard v-if="loadingProducts" variant="outlined">
                        <VCardText class="text-center py-4">
                          <VProgressCircular
                            indeterminate
                            color="primary"
                            size="32"
                          />
                        </VCardText>
                      </VCard>

                      <div
                        v-else-if="availableProducts.length > 0"
                        class="d-flex flex-column gap-3"
                      >
                        <VCard
                          v-for="product in availableProducts"
                          :key="product.plan_product_id"
                          variant="outlined"
                        >
                          <VCardText>
                            <div
                              class="d-flex align-center justify-space-between"
                            >
                              <div class="flex-grow-1">
                                <div class="font-weight-medium mb-1">
                                  {{ product.name }}
                                </div>
                                <div
                                  v-if="product.description"
                                  class="text-body-2 text-medium-emphasis"
                                >
                                  {{ product.description }}
                                </div>
                                <div
                                  v-if="product.price"
                                  class="text-body-2 text-primary mt-1"
                                >
                                  {{ formatCurrency(product.price) }}
                                </div>
                              </div>
                              <div class="d-flex align-center gap-3">
                                <div class="d-flex align-center gap-2">
                                  <VBtn
                                    icon
                                    size="small"
                                    variant="outlined"
                                    :disabled="
                                      getAddonQuantity(
                                        product.plan_product_id
                                      ) === 0
                                    "
                                    @click="
                                      removeAddon(product.plan_product_id)
                                    "
                                  >
                                    <VIcon size="20">tabler-minus</VIcon>
                                  </VBtn>
                                  <span
                                    class="text-body-1 font-weight-medium"
                                    style="min-width: 24px; text-align: center"
                                  >
                                    {{
                                      getAddonQuantity(product.plan_product_id)
                                    }}
                                  </span>
                                  <VBtn
                                    icon
                                    size="small"
                                    variant="outlined"
                                    @click="addAddon(product)"
                                  >
                                    <VIcon size="20">tabler-plus</VIcon>
                                  </VBtn>
                                </div>
                              </div>
                            </div>
                          </VCardText>
                        </VCard>
                      </div>

                      <VCard v-else variant="outlined">
                        <VCardText class="text-center py-4">
                          <div class="text-body-2 text-medium-emphasis">
                            {{ $t('no_addons_available') }}
                          </div>
                        </VCardText>
                      </VCard>
                    </VCol>
                  </VRow>

                  <!-- Resumo -->
                  <VDivider class="my-6" />

                  <VCard variant="outlined" class="mb-4">
                    <VCardText>
                      <div
                        class="d-flex align-center justify-space-between mb-2"
                      >
                        <span class="text-body-1">{{ $t('plan') }}:</span>
                        <span class="text-body-1 font-weight-medium">
                          {{
                            formatCurrency(
                              selectedPlanForCheckout
                                ? getPrice(selectedPlanForCheckout)
                                : 0
                            )
                          }}
                        </span>
                      </div>
                      <div
                        v-if="selectedAddons.length > 0"
                        class="d-flex align-center justify-space-between mb-2"
                      >
                        <span class="text-body-1">{{ $t('addons') }}:</span>
                        <span class="text-body-1 font-weight-medium">
                          {{ formatCurrency(getAddonsTotal) }}
                        </span>
                      </div>
                      <VDivider class="my-2" />
                      <div class="d-flex align-center justify-space-between">
                        <span class="text-h6">{{ $t('total') }}:</span>
                        <span class="text-h5 font-weight-bold text-primary">
                          {{ formatCurrency(getCheckoutTotal) }}
                        </span>
                      </div>
                    </VCardText>
                  </VCard>
                </div>
              </VStepperWindowItem>

              <!-- Step 3: Informações do Usuário -->
              <VStepperWindowItem :value="3">
                <div v-if="currentUser">
                  <VRow>
                    <!-- Informações Pessoais - Esquerda -->
                    <VCol cols="12" md="6">
                      <h4 class="text-h6 mb-4">
                        {{ $t('personal_information') }}
                      </h4>
                      <VCard variant="outlined">
                        <VCardText>
                          <div class="d-flex flex-column gap-3">
                            <div>
                              <span class="text-body-2 text-medium-emphasis">{{
                                $t('name')
                              }}</span>
                              <div class="text-body-1 font-weight-medium">
                                {{
                                  currentUser.user_info?.name &&
                                  currentUser.user_info?.last_name
                                    ? `${currentUser.user_info.name} ${currentUser.user_info.last_name}`
                                    : '-'
                                }}
                              </div>
                            </div>
                            <VDivider />
                            <div>
                              <span class="text-body-2 text-medium-emphasis">{{
                                $t('whatsapp')
                              }}</span>
                              <div class="text-body-1 font-weight-medium">
                                {{
                                  currentUser.user_info?.phone_ddi &&
                                  currentUser.user_info?.phone_partial
                                    ? `${currentUser.user_info.phone_ddi} ${currentUser.user_info.phone_partial}`
                                    : '-'
                                }}
                              </div>
                            </div>
                            <VDivider />
                            <div>
                              <span class="text-body-2 text-medium-emphasis">{{
                                $t('cpf_or_cnpj')
                              }}</span>
                              <div class="text-body-1 font-weight-medium">
                                {{
                                  currentUser.user_document?.document_partial
                                    ? currentUser.user_document.document_partial
                                    : '-'
                                }}
                              </div>
                            </div>
                            <VDivider />
                            <div>
                              <span class="text-body-2 text-medium-emphasis">{{
                                $t('email')
                              }}</span>
                              <div class="text-body-1 font-weight-medium">
                                {{ currentUser.email_partial || '-' }}
                              </div>
                            </div>
                          </div>
                        </VCardText>
                      </VCard>
                    </VCol>

                    <!-- Endereço - Direita -->
                    <VCol cols="12" md="6">
                      <h4 class="text-h6 mb-4">{{ $t('address') }}</h4>
                      <VCard variant="outlined">
                        <VCardText>
                          <div
                            v-if="currentUser.user_address"
                            class="d-flex flex-column gap-3"
                          >
                            <div>
                              <span class="text-body-2 text-medium-emphasis">{{
                                $t('street')
                              }}</span>
                              <div class="text-body-1 font-weight-medium">
                                {{
                                  currentUser.user_address.address1_partial ||
                                  '-'
                                }}
                              </div>
                              <div
                                v-if="currentUser.user_address.address2_partial"
                                class="text-body-1 font-weight-medium"
                              >
                                {{ currentUser.user_address.address2_partial }}
                              </div>
                            </div>
                            <VDivider />
                            <div>
                              <span class="text-body-2 text-medium-emphasis">{{
                                $t('district')
                              }}</span>
                              <div class="text-body-1 font-weight-medium">
                                {{ currentUser.user_address.district || '-' }}
                              </div>
                            </div>
                            <VDivider />
                            <div>
                              <span class="text-body-2 text-medium-emphasis">{{
                                $t('city')
                              }}</span>
                              <div class="text-body-1 font-weight-medium">
                                {{ currentUser.user_address.city || '-' }}
                              </div>
                            </div>
                            <VDivider />
                            <div>
                              <span class="text-body-2 text-medium-emphasis">{{
                                $t('state')
                              }}</span>
                              <div class="text-body-1 font-weight-medium">
                                {{ currentUser.user_address.state || '-' }}
                              </div>
                            </div>
                            <VDivider />
                            <div>
                              <span class="text-body-2 text-medium-emphasis">{{
                                $t('zip_code')
                              }}</span>
                              <div class="text-body-1 font-weight-medium">
                                {{ currentUser.user_address.zip_code || '-' }}
                              </div>
                            </div>
                          </div>
                          <div v-else class="text-center py-4">
                            <div class="text-body-2 text-medium-emphasis">
                              {{ $t('no_address_registered') }}
                            </div>
                          </div>
                        </VCardText>
                      </VCard>
                    </VCol>
                  </VRow>
                </div>
                <div v-else-if="loadingUser" class="text-center py-8">
                  <VProgressCircular indeterminate color="primary" size="64" />
                </div>
              </VStepperWindowItem>

              <!-- Step 4: Pagamento -->
              <VStepperWindowItem :value="4">
                <div>
                  <h4 class="text-h6 mb-4">
                    {{ $t('select_payment_method') }}
                  </h4>

                  <VRow>
                    <!-- Boleto -->
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
                        :elevation="selectedPaymentMethod === 'boleto' ? 4 : 0"
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

                    <!-- Cartão de Crédito -->
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

                    <!-- PIX -->
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

                  <!-- Resumo do Boleto -->
                  <VRow v-if="selectedPaymentMethod === 'boleto'" class="mt-6">
                    <VCol cols="12" md="6">
                      <VCard variant="outlined">
                        <VCardText>
                          <h5 class="text-h6 mb-4">
                            {{ $t('boleto_summary') }}
                          </h5>
                          <div class="d-flex flex-column gap-2">
                            <div class="d-flex justify-space-between">
                              <span class="text-body-2 text-medium-emphasis">{{
                                $t('payment_due_date')
                              }}</span>
                              <span class="text-body-1 font-weight-medium">{{
                                $t('boleto_due_date_info')
                              }}</span>
                            </div>
                            <VDivider />
                            <p class="text-body-2 text-medium-emphasis mt-2">
                              {{ $t('boleto_instructions') }}
                            </p>
                          </div>
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
                            class="d-flex justify-space-between align-center mb-2"
                          >
                            <span class="text-body-1"
                              >{{ $t('subtotal') }}:</span
                            >
                            <span class="text-body-1 font-weight-medium">
                              {{
                                formatCurrency(
                                  selectedPlanForCheckout
                                    ? getPrice(selectedPlanForCheckout)
                                    : 0
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
                                :key="addon.plan_product_id"
                                class="d-flex justify-space-between align-center"
                              >
                                <span class="text-body-2 text-medium-emphasis">
                                  {{ addon.name }}
                                  <span v-if="addon.quantity > 1"
                                    >(x{{ addon.quantity }})</span
                                  >:
                                </span>
                                <span class="text-body-2 font-weight-medium">
                                  {{ formatCurrency(getAddonPrice(addon)) }}
                                </span>
                              </div>
                            </div>
                            <div
                              v-else
                              class="d-flex justify-space-between align-center"
                            >
                              <span class="text-body-1"
                                >{{ $t('addons') }}:</span
                              >
                              <span class="text-body-1 font-weight-medium">
                                {{ formatCurrency(0) }}
                              </span>
                            </div>
                          </div>

                          <div
                            v-if="
                              upgradeDiscount?.is_upgrade &&
                              upgradeDiscount.discount > 0
                            "
                            class="d-flex justify-space-between align-center mb-2"
                          >
                            <span class="text-body-1 text-success">
                              {{ $t('upgrade_discount') }}:
                            </span>
                            <span
                              class="text-body-1 font-weight-medium text-success"
                            >
                              -{{ formatCurrency(upgradeDiscount.discount) }}
                            </span>
                          </div>

                          <VDivider class="my-4" />

                          <div
                            class="d-flex justify-space-between align-center"
                          >
                            <span class="text-h6 font-weight-bold">
                              {{ $t('payment_amount') }}:
                            </span>
                            <span class="text-h6 font-weight-bold text-primary">
                              {{ formatCurrency(getCheckoutTotal) }}
                            </span>
                          </div>
                        </VCardText>
                      </VCard>
                    </VCol>
                  </VRow>

                  <!-- Seleção de Cartão de Crédito -->
                  <VRow
                    v-if="
                      selectedPaymentMethod === 'credit_card' &&
                      !showAddCardModal
                    "
                    class="mt-6"
                  >
                    <VCol cols="12" md="6">
                      <h5 class="text-h6 mb-4">
                        {{ $t('select_credit_card') }}
                      </h5>

                      <VProgressCircular
                        v-if="loadingCards"
                        indeterminate
                        color="primary"
                        size="32"
                        class="mb-4"
                      />

                      <div
                        v-else-if="userCards.length > 0"
                        class="d-flex flex-column gap-3"
                      >
                        <VCard
                          v-for="card in userCards"
                          :key="card.user_card_id"
                          :class="[
                            'credit-card-item',
                            selectedCardId === card.user_card_id
                              ? 'credit-card-selected'
                              : '',
                          ]"
                          :variant="
                            selectedCardId === card.user_card_id
                              ? 'elevated'
                              : 'outlined'
                          "
                          :elevation="
                            selectedCardId === card.user_card_id ? 4 : 0
                          "
                          @click="selectedCardId = card.user_card_id"
                          style="cursor: pointer"
                        >
                          <VCardText>
                            <div
                              class="d-flex align-center justify-space-between"
                            >
                              <div class="d-flex align-center gap-3">
                                <VIcon
                                  icon="tabler-credit-card"
                                  size="32"
                                  color="primary"
                                />
                                <div>
                                  <div class="text-body-1 font-weight-medium">
                                    {{ card.holder_name }}
                                  </div>
                                  <div class="text-body-2 text-medium-emphasis">
                                    {{ $t('ending_in') }} {{ card.last_number }}
                                  </div>
                                  <div class="text-body-2 text-medium-emphasis">
                                    {{ card.brand }}
                                  </div>
                                </div>
                              </div>
                              <div>
                                <VChip
                                  v-if="card.default"
                                  color="primary"
                                  size="small"
                                  variant="tonal"
                                >
                                  {{ $t('default') }}
                                </VChip>
                              </div>
                            </div>
                          </VCardText>
                        </VCard>
                      </div>

                      <VCard v-else variant="outlined" class="mb-4">
                        <VCardText class="text-center py-4">
                          <div class="text-body-2 text-medium-emphasis mb-3">
                            {{ $t('no_cards_registered') }}
                          </div>
                        </VCardText>
                      </VCard>

                      <VBtn
                        color="primary"
                        variant="outlined"
                        prepend-icon="tabler-plus"
                        @click="showAddCardModal = !showAddCardModal"
                        class="mb-4"
                      >
                        {{ $t('add_new_card') }}
                      </VBtn>
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
                            class="d-flex justify-space-between align-center mb-2"
                          >
                            <span class="text-body-1"
                              >{{ $t('subtotal') }}:</span
                            >
                            <span class="text-body-1 font-weight-medium">
                              {{
                                formatCurrency(
                                  selectedPlanForCheckout
                                    ? getPrice(selectedPlanForCheckout)
                                    : 0
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
                                :key="addon.plan_product_id"
                                class="d-flex justify-space-between align-center"
                              >
                                <span class="text-body-2 text-medium-emphasis">
                                  {{ addon.name }}
                                  <span v-if="addon.quantity > 1"
                                    >(x{{ addon.quantity }})</span
                                  >:
                                </span>
                                <span class="text-body-2 font-weight-medium">
                                  {{ formatCurrency(getAddonPrice(addon)) }}
                                </span>
                              </div>
                            </div>
                            <div
                              v-else
                              class="d-flex justify-space-between align-center"
                            >
                              <span class="text-body-1"
                                >{{ $t('addons') }}:</span
                              >
                              <span class="text-body-1 font-weight-medium">
                                {{ formatCurrency(0) }}
                              </span>
                            </div>
                          </div>

                          <div
                            v-if="
                              upgradeDiscount?.is_upgrade &&
                              upgradeDiscount.discount > 0
                            "
                            class="d-flex justify-space-between align-center mb-2"
                          >
                            <span class="text-body-1 text-success">
                              {{ $t('upgrade_discount') }}:
                            </span>
                            <span
                              class="text-body-1 font-weight-medium text-success"
                            >
                              -{{ formatCurrency(upgradeDiscount.discount) }}
                            </span>
                          </div>

                          <VDivider class="my-4" />

                          <div
                            class="d-flex justify-space-between align-center"
                          >
                            <span class="text-h6 font-weight-bold">
                              {{ $t('payment_amount') }}:
                            </span>
                            <span class="text-h6 font-weight-bold text-primary">
                              {{ formatCurrency(getCheckoutTotal) }}
                            </span>
                          </div>
                        </VCardText>
                      </VCard>
                    </VCol>
                  </VRow>

                  <!-- Formulário de Adicionar Cartão -->
                  <VRow v-if="showAddCardModal" class="mt-6">
                    <!-- Esquerda: Formulário de Cartão (6 colunas) -->
                    <VCol cols="12" md="6">
                      <VCard variant="outlined" class="credit-card-form">
                        <VCardText>
                          <!-- Visual do Cartão -->
                          <div
                            class="credit-card-preview mb-6"
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
                              {{ newCard.number || '0000 0000 0000 0000' }}
                            </div>
                            <div class="d-flex justify-space-between align-end">
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
                                    newCard.holderName ||
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
                                    newCard.expiryMonth && newCard.expiryYear
                                      ? `${newCard.expiryMonth}/${newCard.expiryYear}`
                                      : 'MM/AA'
                                  }}
                                </div>
                              </div>
                            </div>
                          </div>

                          <!-- Formulário -->
                          <VForm>
                            <VRow>
                              <VCol cols="12">
                                <VTextField
                                  v-model="newCard.number"
                                  :label="$t('card_number')"
                                  placeholder="0000 0000 0000 0000"
                                  @input="onCardNumberInput"
                                  :maxlength="19"
                                >
                                  <template #append-inner>
                                    <div
                                      v-if="
                                        detectedBrand &&
                                        getBrandLogoUrl(detectedBrand)
                                      "
                                      class="brand-logo-small"
                                    >
                                      <img
                                        :src="
                                          getBrandLogoUrl(detectedBrand) || ''
                                        "
                                        :alt="detectedBrand || 'card brand'"
                                        class="brand-logo-img"
                                      />
                                    </div>
                                  </template>
                                </VTextField>
                              </VCol>
                              <VCol cols="12">
                                <VTextField
                                  v-model="newCard.holderName"
                                  :label="$t('cardholder_name')"
                                  placeholder="Nome como está no cartão"
                                  :maxlength="100"
                                />
                              </VCol>
                              <VCol cols="6">
                                <VTextField
                                  :model-value="
                                    newCard.expiryMonth && newCard.expiryYear
                                      ? `${newCard.expiryMonth}/${newCard.expiryYear}`
                                      : ''
                                  "
                                  :label="$t('expiry_date')"
                                  placeholder="MM/AA"
                                  @input="onExpiryInput"
                                  :maxlength="5"
                                  :error="!!expiryError"
                                  :error-messages="expiryError"
                                />
                              </VCol>
                              <VCol cols="6">
                                <VTextField
                                  v-model="newCard.cvv"
                                  :label="$t('cvv')"
                                  placeholder="000"
                                  :type="showCvv ? 'text' : 'password'"
                                  :maxlength="4"
                                >
                                  <template #append-inner>
                                    <VIcon
                                      :icon="
                                        showCvv
                                          ? 'tabler-eye-off'
                                          : 'tabler-eye'
                                      "
                                      @click="showCvv = !showCvv"
                                      style="cursor: pointer"
                                    />
                                  </template>
                                </VTextField>
                              </VCol>
                            </VRow>
                            <div class="d-flex gap-3 mt-4">
                              <VBtn
                                variant="outlined"
                                color="secondary"
                                @click="showAddCardModal = false"
                              >
                                {{ $t('cancel') }}
                              </VBtn>
                            </div>
                          </VForm>
                        </VCardText>
                      </VCard>
                    </VCol>

                    <!-- Direita: Informações do Plano (6 colunas) -->
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
                            class="d-flex justify-space-between align-center mb-2"
                          >
                            <span class="text-body-1"
                              >{{ $t('subtotal') }}:</span
                            >
                            <span class="text-body-1 font-weight-medium">
                              {{
                                formatCurrency(
                                  selectedPlanForCheckout
                                    ? getPrice(selectedPlanForCheckout)
                                    : 0
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
                                :key="addon.plan_product_id"
                                class="d-flex justify-space-between align-center"
                              >
                                <span class="text-body-2 text-medium-emphasis">
                                  {{ addon.name }}
                                  <span v-if="addon.quantity > 1"
                                    >(x{{ addon.quantity }})</span
                                  >:
                                </span>
                                <span class="text-body-2 font-weight-medium">
                                  {{ formatCurrency(getAddonPrice(addon)) }}
                                </span>
                              </div>
                            </div>
                            <div
                              v-else
                              class="d-flex justify-space-between align-center"
                            >
                              <span class="text-body-1"
                                >{{ $t('addons') }}:</span
                              >
                              <span class="text-body-1 font-weight-medium">
                                {{ formatCurrency(0) }}
                              </span>
                            </div>
                          </div>

                          <div
                            v-if="
                              upgradeDiscount?.is_upgrade &&
                              upgradeDiscount.discount > 0
                            "
                            class="d-flex justify-space-between align-center mb-2"
                          >
                            <span class="text-body-1 text-success">
                              {{ $t('upgrade_discount') }}:
                            </span>
                            <span
                              class="text-body-1 font-weight-medium text-success"
                            >
                              -{{ formatCurrency(upgradeDiscount.discount) }}
                            </span>
                          </div>

                          <VDivider class="my-4" />

                          <div
                            class="d-flex justify-space-between align-center"
                          >
                            <span class="text-h6 font-weight-bold">
                              {{ $t('payment_amount') }}:
                            </span>
                            <span class="text-h6 font-weight-bold text-primary">
                              {{ formatCurrency(getCheckoutTotal) }}
                            </span>
                          </div>
                        </VCardText>
                      </VCard>
                    </VCol>
                  </VRow>

                  <!-- Resumo do PIX -->
                  <VRow v-if="selectedPaymentMethod === 'pix'" class="mt-6">
                    <VCol cols="12" md="6">
                      <VCard variant="outlined">
                        <VCardText>
                          <h5 class="text-h6 mb-4">{{ $t('pix_summary') }}</h5>
                          <div class="d-flex flex-column gap-2">
                            <p class="text-body-2 text-medium-emphasis mt-2">
                              {{ $t('pix_instructions') }}
                            </p>
                          </div>
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
                            class="d-flex justify-space-between align-center mb-2"
                          >
                            <span class="text-body-1"
                              >{{ $t('subtotal') }}:</span
                            >
                            <span class="text-body-1 font-weight-medium">
                              {{
                                formatCurrency(
                                  selectedPlanForCheckout
                                    ? getPrice(selectedPlanForCheckout)
                                    : 0
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
                                :key="addon.plan_product_id"
                                class="d-flex justify-space-between align-center"
                              >
                                <span class="text-body-2 text-medium-emphasis">
                                  {{ addon.name }}
                                  <span v-if="addon.quantity > 1"
                                    >(x{{ addon.quantity }})</span
                                  >:
                                </span>
                                <span class="text-body-2 font-weight-medium">
                                  {{ formatCurrency(getAddonPrice(addon)) }}
                                </span>
                              </div>
                            </div>
                            <div
                              v-else
                              class="d-flex justify-space-between align-center"
                            >
                              <span class="text-body-1"
                                >{{ $t('addons') }}:</span
                              >
                              <span class="text-body-1 font-weight-medium">
                                {{ formatCurrency(0) }}
                              </span>
                            </div>
                          </div>

                          <VDivider class="my-4" />

                          <div
                            class="d-flex justify-space-between align-center"
                          >
                            <span class="text-h6 font-weight-bold">
                              {{ $t('payment_amount') }}:
                            </span>
                            <span class="text-h6 font-weight-bold text-primary">
                              {{ formatCurrency(getCheckoutTotal) }}
                            </span>
                          </div>
                        </VCardText>
                      </VCard>
                    </VCol>
                  </VRow>
                </div>
              </VStepperWindowItem>
            </VStepperWindow>

            <!-- Botões de Navegação -->
            <VCardText class="d-flex justify-space-between flex-wrap gap-3">
              <VBtn
                v-if="currentStep > 1"
                variant="tonal"
                color="secondary"
                @click="prevStep"
              >
                {{ $t('back') }}
              </VBtn>
              <VSpacer v-if="currentStep === 1" />
              <div class="d-flex gap-3">
                <VBtn variant="tonal" color="secondary" @click="goBack">
                  {{ $t('cancel') }}
                </VBtn>
                <VBtn
                  v-if="currentStep < 4"
                  color="primary"
                  :disabled="
                    (currentStep === 1 && !selectedPlanForCheckout) ||
                    (currentStep === 4 && !selectedPaymentMethod) ||
                    (currentStep === 4 &&
                      selectedPaymentMethod === 'credit_card' &&
                      !selectedCardId &&
                      userCards.length > 0)
                  "
                  @click="nextStep"
                >
                  {{ $t('next') }}
                </VBtn>
                <VBtn
                  v-else
                  color="primary"
                  :disabled="
                    !selectedPlanForCheckout ||
                    !selectedPaymentMethod ||
                    (selectedPaymentMethod === 'credit_card' &&
                      !selectedCardId &&
                      userCards.length > 0)
                  "
                >
                  {{ $t('finalize_purchase') }}
                </VBtn>
              </div>
            </VCardText>
          </VStepper>
        </div>
      </VCardText>
    </VCard>

    <VSnackbar
      v-model="planStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="planStore.snackbar.color"
    >
      {{ planStore.snackbar.message }}
    </VSnackbar>
  </div>
</template>

<style lang="scss" scoped>
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

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.1);
  }
}

.plan-card-popular {
  border: 2px solid rgb(var(--v-theme-primary));
  position: relative;
}

.plan-card-current {
  border: 2px solid rgb(var(--v-theme-success));
  position: relative;
}

.plan-card-disabled {
  opacity: 0.6;
  position: relative;
}

.plan-disabled-overlay {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  pointer-events: none;
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

.credit-card-item {
  transition:
    transform 0.2s ease-in-out,
    box-shadow 0.2s ease-in-out;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
  }
}

.credit-card-selected {
  border: 2px solid rgb(var(--v-theme-primary));
}

.credit-card-form {
  animation: slideDown 0.3s ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
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
  justify-content: flex-end;
  z-index: 1;
}

.brand-logo {
  width: 90px;
  height: 55px;
  max-width: 90px;
  max-height: 55px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  overflow: hidden;
  flex-shrink: 0;
}

.brand-logo img,
.brand-logo .brand-logo-img {
  width: 90px !important;
  height: 55px !important;
  max-width: 90px !important;
  max-height: 55px !important;
  min-width: 0 !important;
  min-height: 0 !important;
  object-fit: contain;
  display: block;
}

.brand-logo-icon {
  color: white;
}

.brand-logo-small {
  width: 32px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.brand-logo-small .brand-logo-img {
  max-width: 32px;
  max-height: 20px;
}
</style>
