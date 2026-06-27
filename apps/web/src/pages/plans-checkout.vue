<script setup lang="ts">
import {
  ref,
  onMounted,
  onBeforeUnmount,
  computed,
  watch,
  nextTick,
} from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EPlanPermissions } from '@core/common/enums/EPermissions/plan';
import { EColor } from '@core/common/enums/EColor';
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
import { ListAvailableCrossSellResponse } from '@core/schema/plan/listAvailableCrossSell/response.schema';
import { ViewUserInfoResponse } from '@core/schema/plan/viewUserInfo/response.schema';
import { ListUserCardResponse } from '@core/schema/plan/listUserCards/response.schema';
import { CalculateUpgradeDiscountResponse } from '@core/schema/plan/calculateUpgradeDiscount/response.schema';
import { CreateOrderPaymentRequest } from '@core/schema/plan/createOrderPayment/request.schema';
import { CreateOrderPaymentResponse } from '@core/schema/plan/createOrderPayment/response.schema';
import { ViewCurrentPlanInvoiceResponse } from '@core/schema/accountSettings/viewCurrentPlanInvoice/response.schema';
import { ListCreditCardFeeResponse } from '@core/schema/config/listCreditCardFee/response.schema';
import { ListMethodPaymentsResponse } from '@core/schema/plan/listMethodPayments/response.schema';
import { EMethodPayment } from '@core/common/enums/EMethodPayment';
import creditCardType from 'credit-card-type';
import DialogCloseBtn from '@/@webcore/components/DialogCloseBtn.vue';
import { onMessage, unsubscribe } from '@/@webcore/centrifugo';
import { paymentAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import type { Subscription } from 'centrifuge';

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
const currentPlanInvoiceData = ref<{
  next_payment_date: string | null;
} | null>(null);
const availableCrossSells = ref<ListAvailableCrossSellResponse[]>([]);
type SelectedAddon = {
  plan_cross_sell_id: string;
  plan_product_id: string;
  name: string;
  quantity: number;
  price: number;
  price_per_cycle: number;
  price_proportional: number;
  is_single_use: boolean;
  can_purchase: boolean;
};
const selectedAddons = ref<SelectedAddon[]>([]);
const selectedCrossSellByType = ref<Record<string, string | null>>({});
const loadingProducts = ref(false);
const creditCardFee = ref<ListCreditCardFeeResponse | null>(null);
const enabledPaymentMethods = ref<ListMethodPaymentsResponse>([]);
const loadingPaymentMethods = ref(false);
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
const installments = ref<number>(1);
const recurringPayment = ref<boolean>(true);
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
const pixModalOpen = ref(false);
const pixPaymentInitiated = ref(false);
const paymentInitiated = ref(false);
const processingPayment = ref(false);
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
const paymentSubscription = ref<Subscription | null>(null);
const testPlanAlreadyUsed = ref(false);

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

const MONTHLY_CREDIT_CARD_FEE_INSTALLMENT = 3;

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

const isTestPlan = (plan: ListPlanWithItemsResponse | null): boolean => {
  if (!plan) return false;
  if (plan.is_test !== true) return false;

  return Boolean(plan.days_trial && plan.days_trial > 0);
};

const getBillingPeriodText = (
  plan: ListPlanWithItemsResponse | null
): string => {
  if (!plan) return billingPeriod.value === 'annual' ? t('year') : t('month');

  if (isTestPlan(plan) && plan.days_trial) {
    const days = plan.days_trial;
    return days === 1 ? `/1 ${t('day')}` : `/${days} ${t('days')}`;
  }
  return billingPeriod.value === 'annual' ? t('year') : t('month');
};

const processCurrentPlan = (
  plansList: ListPlanWithItemsResponse[],
  currentPlanIdValue: string | null
) => {
  currentPlanId.value = currentPlanIdValue;

  if (currentPlanIdValue) {
    currentPlan.value =
      plansList.find((p) => p.plan_id === currentPlanIdValue) || null;
    return;
  }

  currentPlan.value = null;
};

const processCurrentPlanInvoice = (
  currentPlanInvoice: ViewCurrentPlanInvoiceResponse | null
) => {
  recurringPayment.value =
    typeof currentPlanInvoice?.recurring_payment === 'boolean'
      ? currentPlanInvoice.recurring_payment
      : true;

  if (!currentPlanInvoice) {
    currentPlanInvoiceData.value = null;
    currentPlanBillingPeriod.value = null;
    return;
  }

  currentPlanInvoiceData.value = currentPlanInvoice;

  if (!currentPlanInvoice.billing_period) {
    currentPlanBillingPeriod.value = null;
    return;
  }

  currentPlanBillingPeriod.value = currentPlanInvoice.billing_period as
    | 'monthly'
    | 'annual';
};

const processPlanIdFromQuery = (
  plansList: ListPlanWithItemsResponse[],
  planId: string | undefined
) => {
  if (!planId) {
    return;
  }

  const plan = plansList.find((p) => p.plan_id === planId);
  if (plan) {
    selectedPlanForCheckout.value = plan;
    currentStep.value = 2;
  }
};

const loadStep1 = async () => {
  if (step1Loaded.value) return;

  loading.value = true;
  const planId = route.query.plan_id as string;
  const billing = (route.query.billing as 'monthly' | 'annual') || 'monthly';

  const [plansList, currentPlanIdValue, currentPlanInvoice, alreadyUsed] =
    await Promise.all([
      planStore.listPlanWithItems(),
      planStore.getCurrentPlan(),
      accountSettingsStore.getCurrentPlanInvoice(),
      planStore.checkTestPlanAlreadyUsed(),
    ]);

  testPlanAlreadyUsed.value = alreadyUsed;

  if (!plansList) {
    step1Loaded.value = true;
    loading.value = false;
    return;
  }

  plans.value = plansList;
  processCurrentPlan(plansList, currentPlanIdValue);
  processCurrentPlanInvoice(currentPlanInvoice);

  const isActive = currentPlanInvoice?.next_payment_date
    ? new Date(currentPlanInvoice.next_payment_date) > new Date()
    : false;

  if (
    currentPlanBillingPeriod.value === 'annual' &&
    isActive &&
    billing === 'monthly'
  ) {
    billingPeriod.value = 'annual';
  } else {
    billingPeriod.value = billing;
  }

  processPlanIdFromQuery(plansList, planId);

  step1Loaded.value = true;
  loading.value = false;
};

const loadStep2 = async () => {
  if (step2Loaded.value) return;

  loadingProducts.value = true;
  const [crossSells] = await Promise.all([
    planStore.listAvailableCrossSell({ pricing_mode: 'full' }),
    loadUpgradeDiscount(),
  ]);
  if (crossSells) {
    availableCrossSells.value = crossSells;
    selectedCrossSellByType.value = {};

    if (selectedAddons.value.length === 0) {
      prefillRenewalAddons();
    }
  }
  loadingProducts.value = false;
  step2Loaded.value = true;
};

const loadStep3 = async () => {
  if (step3Loaded.value) return;

  await loadUserData();
  step3Loaded.value = true;
};

const loadCreditCardFee = async () => {
  if (creditCardFee.value) return;
  const result = await planStore.getCreditCardFee();
  if (result) {
    creditCardFee.value = result;
  }
};

const loadMethodPayments = async () => {
  if (loadingPaymentMethods.value) return;
  loadingPaymentMethods.value = true;
  const result = await planStore.getMethodPayments();
  if (result) {
    enabledPaymentMethods.value = result;
  }
  loadingPaymentMethods.value = false;
};

const loadStep4 = async () => {
  if (step4Loaded.value) return;

  await Promise.all([
    loadUserCards(),
    loadUpgradeDiscount(),
    loadCreditCardFee(),
    loadMethodPayments(),
  ]);
  step4Loaded.value = true;
};

const isPaymentMethodEnabled = (
  method: 'boleto' | 'credit_card' | 'pix'
): boolean => {
  return enabledPaymentMethods.value.some(
    (mp) => mp.type === method && mp.status === true
  );
};

const enabledPaymentMethodsCount = computed(() => {
  return enabledPaymentMethods.value.filter((mp) => mp.status === true).length;
});

const getPaymentMethodColClasses = computed(() => {
  const count = enabledPaymentMethodsCount.value;
  if (count === 1) {
    return { cols: '12', md: '12' };
  }
  if (count === 2) {
    return { cols: '12', md: '6' };
  }
  return { cols: '12', md: '4' };
});

const isPlanExpired = computed(() => {
  if (!currentPlanInvoiceData.value?.next_payment_date) {
    return false;
  }

  const now = new Date();
  const nextPaymentDate = new Date(
    currentPlanInvoiceData.value.next_payment_date
  );
  return nextPaymentDate <= now;
});

const isPlanActive = computed(() => {
  if (!currentPlanInvoiceData.value?.next_payment_date) {
    return false;
  }

  const now = new Date();
  const nextPaymentDate = new Date(
    currentPlanInvoiceData.value.next_payment_date
  );
  return nextPaymentDate > now;
});

const loadUpgradeDiscount = async () => {
  if (!selectedPlanForCheckout.value) {
    return;
  }

  if (!currentPlanId.value) {
    upgradeDiscount.value = null;
    return;
  }

  if (isPlanExpired.value) {
    upgradeDiscount.value = null;
    return;
  }

  loadingDiscount.value = true;
  const discount = await planStore.calculateUpgradeDiscount(
    selectedPlanForCheckout.value.plan_id,
    billingPeriod.value
  );
  if (discount) {
    upgradeDiscount.value = discount;
  } else {
    upgradeDiscount.value = null;
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
  if (currentPlanId.value !== planId) return false;
  if (!currentPlanBillingPeriod.value) return false;
  return currentPlanBillingPeriod.value === billingPeriod.value;
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
    isPlanActive.value &&
    billingPeriod.value === 'monthly'
  ) {
    return true;
  }

  return false;
};

watch(billingPeriod, (newValue) => {
  if (
    currentPlanBillingPeriod.value === 'annual' &&
    isPlanActive.value &&
    newValue === 'monthly'
  ) {
    billingPeriod.value = 'annual';
  } else {
    loadUpgradeDiscount();
  }
});

const isPlanDisabled = (plan: ListPlanWithItemsResponse): boolean => {
  return isDowngrade(plan) || isInvalidBillingPeriodChange(plan);
};

const getButtonText = (planId: string): string => {
  if (isCurrentPlan(planId)) {
    return t('your_current_plan');
  }
  if (!currentPlanId.value) {
    return t('buy');
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

const canProceedToNextStep = computed(() => {
  if (!selectedPlanForCheckout.value) return false;
  if (isTestPlan(selectedPlanForCheckout.value) && testPlanAlreadyUsed.value) {
    return false;
  }
  return true;
});

const nextStep = () => {
  if (!canProceedToNextStep.value) return;
  if (currentStep.value < 4) {
    currentStep.value += 1;
  }
};

const prevStep = () => {
  if (currentStep.value > 1) {
    currentStep.value -= 1;
  }
};

const groupedCrossSells = computed(() => {
  const grouped: Record<
    string,
    {
      product_id: string;
      product_name: string;
      product_description: string | null;
      options: ListAvailableCrossSellResponse[];
    }
  > = {};

  for (const crossSell of availableCrossSells.value) {
    if (!crossSell.can_purchase && !crossSell.renewable_instances) {
      continue;
    }

    const productId = crossSell.plan_product_id;
    if (!grouped[productId]) {
      grouped[productId] = {
        product_id: productId,
        product_name: crossSell.plan_product?.name || '',
        product_description: crossSell.plan_product?.description || null,
        options: [],
      };
    }
    grouped[productId].options.push(crossSell);
  }

  return Object.values(grouped);
});

const buildSelectedAddon = (
  crossSell: ListAvailableCrossSellResponse
): SelectedAddon => {
  const fallbackMultiplier = billingPeriod.value === 'annual' ? 12 : 1;
  const cyclePrice =
    Math.round(Number(crossSell.price) * fallbackMultiplier * 100) / 100;
  const proportionalPrice = cyclePrice;

  return {
    plan_cross_sell_id: crossSell.plan_cross_sell_id,
    plan_product_id: crossSell.plan_product_id,
    name: crossSell.plan_product?.name || '',
    quantity: crossSell.quantity,
    price: Number(crossSell.price),
    price_per_cycle: cyclePrice,
    price_proportional: proportionalPrice,
    is_single_use: crossSell.is_single_use === true,
    can_purchase: crossSell.can_purchase !== false,
  };
};

const getSelectedAddonsCountByProduct = (planProductId: string): number => {
  return selectedAddons.value.filter((a) => a.plan_product_id === planProductId)
    .length;
};

const prefillRenewalAddons = () => {
  if (
    !selectedPlanForCheckout.value ||
    !currentPlanId.value ||
    selectedPlanForCheckout.value.plan_id !== currentPlanId.value ||
    isPlanExpired.value
  ) {
    return;
  }

  const prefills: SelectedAddon[] = [];

  for (const crossSell of availableCrossSells.value) {
    const renewableInstances = Math.max(
      0,
      Number(crossSell.renewable_instances || 0)
    );

    if (renewableInstances === 0) {
      continue;
    }

    for (let i = 0; i < renewableInstances; i += 1) {
      prefills.push(buildSelectedAddon(crossSell));
    }
  }

  if (prefills.length > 0) {
    selectedAddons.value = prefills;
  }
};

const addAddon = (planProductId: string) => {
  const selectedCrossSellId = selectedCrossSellByType.value[planProductId];
  if (!selectedCrossSellId) {
    return;
  }

  const crossSell = availableCrossSells.value.find(
    (cs) => cs.plan_cross_sell_id === selectedCrossSellId
  );

  if (!crossSell) {
    return;
  }

  if (crossSell.can_purchase === false) {
    return;
  }

  if (
    crossSell.is_single_use &&
    getSelectedAddonsCountByProduct(crossSell.plan_product_id) >= 1
  ) {
    return;
  }

  selectedAddons.value.push(buildSelectedAddon(crossSell));
};

const removeAddon = (planProductId: string) => {
  let index = -1;
  for (let i = selectedAddons.value.length - 1; i >= 0; i -= 1) {
    if (selectedAddons.value[i].plan_product_id === planProductId) {
      index = i;
      break;
    }
  }

  if (index !== -1) {
    selectedAddons.value.splice(index, 1);
  }
};

const canRemoveAddonSelection = (planProductId: string): boolean => {
  const selectedOption = getSelectedOptionForProduct(planProductId);
  if (!selectedOption) {
    return true;
  }

  if (selectedOption.is_single_use && selectedOption.can_purchase === false) {
    return false;
  }

  return true;
};

const getAddonQuantity = (planProductId: string): number => {
  return getSelectedAddonsCountByProduct(planProductId);
};

const isAddonSelected = (planProductId: string): boolean => {
  return getAddonQuantity(planProductId) > 0;
};

const getSelectedOptionForProduct = (
  planProductId: string
): ListAvailableCrossSellResponse | null => {
  const selectedId = selectedCrossSellByType.value[planProductId];
  if (!selectedId) {
    return null;
  }

  return (
    availableCrossSells.value.find(
      (crossSell) => crossSell.plan_cross_sell_id === selectedId
    ) || null
  );
};

const canAddCrossSell = (planProductId: string): boolean => {
  const selectedId = selectedCrossSellByType.value[planProductId];
  if (!selectedId) {
    return false;
  }

  const selectedCrossSell = availableCrossSells.value.find(
    (crossSell) => crossSell.plan_cross_sell_id === selectedId
  );
  if (!selectedCrossSell) {
    return false;
  }

  if (selectedCrossSell.can_purchase === false) {
    return false;
  }

  if (
    selectedCrossSell.is_single_use &&
    getSelectedAddonsCountByProduct(planProductId) >= 1
  ) {
    return false;
  }

  return true;
};

const getCrossSellLabel = (
  crossSell: ListAvailableCrossSellResponse
): string => {
  const quantity = crossSell.quantity;
  const fallbackMultiplier = billingPeriod.value === 'annual' ? 12 : 1;
  const cyclePrice =
    Math.round(Number(crossSell.price) * fallbackMultiplier * 100) / 100;
  const price = formatCurrency(cyclePrice);
  return `${quantity}x - ${price}`;
};

const getAddonPrice = (addon: SelectedAddon): number => {
  return addon.price_per_cycle;
};

const selectedAddonsSummary = computed(() => {
  const grouped = new Map<
    string,
    {
      addon: SelectedAddon;
      occurrences: number;
      totalQuantity: number;
      totalPrice: number;
    }
  >();

  for (const addon of selectedAddons.value) {
    const existing = grouped.get(addon.plan_cross_sell_id);
    if (existing) {
      existing.occurrences += 1;
      existing.totalQuantity += addon.quantity;
      existing.totalPrice =
        Math.round((existing.totalPrice + getAddonPrice(addon)) * 100) / 100;
      continue;
    }

    grouped.set(addon.plan_cross_sell_id, {
      addon,
      occurrences: 1,
      totalQuantity: addon.quantity,
      totalPrice: getAddonPrice(addon),
    });
  }

  return Array.from(grouped.values());
});

const cardSelectItems = computed(() => {
  const items: Array<{
    title: string;
    value: string | null;
    brand: string | null;
  }> = [
    {
      title: t('select_option'),
      value: null,
      brand: null,
    },
  ];

  for (const card of userCards.value) {
    const defaultLabel = card.default ? ` (${t('default')})` : '';
    items.push({
      title: `${card.holder_name} - ${t('ending_in')} ${card.last_number}${defaultLabel}`,
      value: card.user_card_id,
      brand: card.brand,
    });
  }

  return items;
});

const getAddonsTotal = computed(() => {
  return selectedAddons.value.reduce((total, addon) => {
    return total + getAddonPrice(addon);
  }, 0);
});

const getCheckoutTotalBase = computed(() => {
  if (!selectedPlanForCheckout.value) return 0;
  const planPrice = getPrice(selectedPlanForCheckout.value);
  const addonsTotal = getAddonsTotal.value;
  const discount = upgradeDiscount.value?.discount || 0;
  const total = Math.max(0, planPrice + addonsTotal - discount);
  return Math.round(total * 100) / 100;
});

const shouldApplyCreditCardFee = computed(() => {
  return selectedPaymentMethod.value === 'credit_card';
});

const selectedInstallmentFeeRate = computed(() => {
  if (!shouldApplyCreditCardFee.value) return 0;

  if (billingPeriod.value === 'monthly') {
    return getCreditCardFeeRate(MONTHLY_CREDIT_CARD_FEE_INSTALLMENT);
  }

  return getCreditCardFeeRate(installments.value);
});

const getCheckoutTotal = computed(() => {
  const baseTotal = getCheckoutTotalBase.value;
  if (!shouldApplyCreditCardFee.value) return baseTotal;
  const feeRate = selectedInstallmentFeeRate.value;
  return applyCreditCardFee(baseTotal, feeRate);
});

const creditCardFeeAmount = computed(() => {
  if (!shouldApplyCreditCardFee.value) return 0;

  const feeAmount = getCheckoutTotal.value - getCheckoutTotalBase.value;
  return Math.max(0, Math.round(feeAmount * 100) / 100);
});

const installmentOptions = computed(() => {
  const options: Array<{ title: string; value: number }> = [];
  if (billingPeriod.value !== 'annual') return options;
  if (!selectedPlanForCheckout.value) return options;
  if (!creditCardFee.value) return options;
  const baseTotal = getCheckoutTotalBase.value;
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

const isDiscountGreaterThanTotal = computed(() => {
  if (!selectedPlanForCheckout.value) return false;
  if (!upgradeDiscount.value?.is_upgrade) return false;

  const planPrice = getPrice(selectedPlanForCheckout.value);
  const addonsTotal = getAddonsTotal.value;
  const totalBeforeDiscount = planPrice + addonsTotal;
  const discount = upgradeDiscount.value.discount || 0;

  return discount >= totalBeforeDiscount;
});

const isUpgradeBlocked = computed(() => {
  if (!upgradeDiscount.value) {
    return false;
  }

  if (!currentPlanId.value) {
    return false;
  }

  if (isPlanExpired.value) {
    return false;
  }

  const isSamePlan =
    selectedPlanForCheckout.value?.plan_id === currentPlanId.value;

  if (isSamePlan) {
    return false;
  }

  if (
    currentPlanBillingPeriod.value &&
    currentPlanBillingPeriod.value !== billingPeriod.value
  ) {
    return false;
  }

  return upgradeDiscount.value.is_upgrade === false;
});

const isTotalZero = computed(() => {
  return (
    getCheckoutTotal.value <= 0 && upgradeDiscount.value?.is_upgrade === true
  );
});

const isNewCardValid = computed(() => {
  if (!showAddCardModal.value) return false;

  const card = newCard.value;
  const hasNumber = card.number.replaceAll(/\s/g, '').length >= 13;
  const hasHolderName = card.holderName.trim().length > 0;
  const hasExpiryMonth = card.expiryMonth.length === 2;
  const hasExpiryYear = card.expiryYear.length === 2;
  const hasCvv = card.cvv.length >= 3;
  const hasNoExpiryError = !expiryError.value;

  return (
    hasNumber &&
    hasHolderName &&
    hasExpiryMonth &&
    hasExpiryYear &&
    hasCvv &&
    hasNoExpiryError
  );
});

const goBack = () => {
  router.push({ name: 'plans' });
};

const getPixQrCodeImageSrc = (qrCode: string): string => {
  if (!qrCode) return '';
  if (qrCode.startsWith('data:image')) {
    return qrCode;
  }
  return `data:image/png;base64,${qrCode}`;
};

const getPaymentStatusText = (status: string | null): string => {
  if (!status) return t('payment_status_pending');
  const statusMap: Record<string, string> = {
    PENDING: t('payment_status_pending'),
    RECEIVED: t('payment_status_received'),
    CONFIRMED: t('payment_status_confirmed'),
    OVERDUE: t('payment_status_overdue'),
    REFUNDED: t('payment_status_refunded'),
  };
  return statusMap[status] || status;
};

const getPaymentStatusColor = (status: string | null): string => {
  if (!status) return 'info';
  const colorMap: Record<string, string> = {
    PENDING: 'info',
    RECEIVED: 'success',
    CONFIRMED: 'success',
    OVERDUE: 'error',
    REFUNDED: 'error',
  };
  return colorMap[status] || 'info';
};

const isPaymentReceived = computed(() => {
  return pixPaymentStatus.value === 'RECEIVED';
});

const shouldShowCloseButton = computed(() => {
  if (
    pixPaymentConfirmed.value &&
    selectedPaymentMethod.value === 'credit_card'
  ) {
    return true;
  }
  if (isPaymentReceived.value && selectedPaymentMethod.value === 'pix') {
    return true;
  }
  if (isPaymentReceived.value && selectedPaymentMethod.value === 'boleto') {
    return true;
  }
  return !pixPaymentConfirmed.value && !isPaymentReceived.value;
});

const paymentStatusAlert = computed(() => {
  if (pixPaymentConfirmed.value) {
    return {
      type: 'success' as const,
      message: t('payment_confirmed'),
      icon: 'tabler-circle-check',
    };
  }
  if (isPaymentReceived.value) {
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

const initPaymentSubscription = async () => {
  const user = getUser();
  if (!user?.account_id || !pixPaymentId.value) {
    return;
  }

  try {
    const channel = paymentAccountCentrifugo(user.account_id);
    const sub = await onMessage(channel, (data: any) => {
      if (data?.payment_id === pixPaymentId.value) {
        pixPaymentStatus.value = data.status || null;
        if (data.is_confirmed) {
          pixPaymentConfirmed.value = true;

          setTimeout(() => {
            pixModalOpen.value = false;
          }, 3000);
        }
      }
    });
    paymentSubscription.value = sub;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error('Erro ao conectar ao Centrifugo:', error);
    }
  }
};

const cleanupPaymentSubscription = async () => {
  if (paymentSubscription.value) {
    const user = getUser();
    if (user?.account_id) {
      const channel = paymentAccountCentrifugo(user.account_id);
      await unsubscribe(channel);
      paymentSubscription.value = null;
    }
  }
};

watch(pixModalOpen, async (isOpen) => {
  if (!isOpen) {
    await cleanupPaymentSubscription();
    pixPaymentStatus.value = null;
    pixPaymentConfirmed.value = false;
  }
});

onBeforeUnmount(async () => {
  await cleanupPaymentSubscription();
});

const copyBoletoCode = async () => {
  if (boletoPaymentData.value?.identification_field) {
    try {
      await navigator.clipboard.writeText(
        boletoPaymentData.value.identification_field
      );
      planStore.snackbar.status = true;
      planStore.snackbar.message = t('boleto_code_copied');
      planStore.snackbar.color = EColor.success;
    } catch (error) {
      console.error('Erro ao copiar código do boleto:', error);
    }
  }
};

const copyBoletoPixPayload = async () => {
  if (boletoPaymentData.value?.payload) {
    try {
      await navigator.clipboard.writeText(boletoPaymentData.value.payload);
      planStore.snackbar.status = true;
      planStore.snackbar.message = t('pix_code_copied');
      planStore.snackbar.color = EColor.success;
    } catch (error) {
      console.error('Erro ao copiar código PIX do boleto:', error);
    }
  }
};

const downloadBoleto = () => {
  if (boletoPaymentData.value?.bank_slip_url) {
    window.open(boletoPaymentData.value.bank_slip_url, '_blank');
  }
};

const copyPixCode = async () => {
  if (pixPaymentData.value?.payload) {
    try {
      await navigator.clipboard.writeText(pixPaymentData.value.payload);
    } catch (error) {
      console.error('Erro ao copiar código PIX:', error);
    }
  }
};

const closePixModal = async () => {
  const wasReceived = isPaymentReceived.value;
  const wasCreditCardConfirmed =
    pixPaymentConfirmed.value && selectedPaymentMethod.value === 'credit_card';
  const wasBoletoReceived =
    isPaymentReceived.value && selectedPaymentMethod.value === 'boleto';
  await cleanupPaymentSubscription();
  pixModalOpen.value = false;
  if (wasReceived || wasCreditCardConfirmed || wasBoletoReceived) {
    router.push({ name: 'account-settings', query: { tab: 'plans' } });
  }
};

const buildPaymentData = (): CreateOrderPaymentRequest => {
  const addons =
    selectedAddons.value.length > 0
      ? selectedAddons.value.map((addon) => ({
          plan_cross_sell_id: addon.plan_cross_sell_id,
        }))
      : undefined;

  const isTest = isTestPlan(selectedPlanForCheckout.value);
  const isCreditCard = selectedPaymentMethod.value === 'credit_card';

  return {
    order_type: 'plan',
    plan_id: selectedPlanForCheckout.value!.plan_id,
    billing_period: billingPeriod.value,
    addons: addons,
    payment_method: isTest ? 'pix' : selectedPaymentMethod.value!,
    credit_card_id:
      isCreditCard && selectedCardId.value ? selectedCardId.value : undefined,
    new_card:
      isCreditCard && showAddCardModal.value && newCard.value.number
        ? {
            number: newCard.value.number.replaceAll(/\s/g, ''),
            holder_name: newCard.value.holderName,
            expiry_month: newCard.value.expiryMonth,
            expiry_year: newCard.value.expiryYear,
            cvv: newCard.value.cvv,
          }
        : undefined,
    recurring_payment: isCreditCard ? recurringPayment.value : undefined,
    installments:
      isCreditCard && billingPeriod.value === 'annual'
        ? installments.value
        : undefined,
  };
};

const openPaymentModal = async () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  await nextTick();
  pixModalOpen.value = true;
  await initPaymentSubscription();
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

const processPayment = async () => {
  if (!selectedPlanForCheckout.value) return;

  if (isTestPlan(selectedPlanForCheckout.value)) {
    if (testPlanAlreadyUsed.value) {
      planStore.showSnackbar(t('test_plan_already_used'), EColor.error);
      return;
    }
    processingPayment.value = true;
    try {
      const paymentData = buildPaymentData();
      const result: CreateOrderPaymentResponse | null =
        await planStore.createOrderPayment(paymentData);

      if (result) {
        router.push({ name: 'account-settings', query: { tab: 'plans' } });
      }
    } catch (error: any) {
      console.error('Erro ao ativar plano de teste:', error);
      planStore.showSnackbar(
        error?.message || t('test_plan_activation_failed'),
        EColor.error
      );
    } finally {
      processingPayment.value = false;
    }
    return;
  }

  if (!selectedPaymentMethod.value) return;

  paymentInitiated.value = true;

  const isPixPayment = selectedPaymentMethod.value === 'pix';
  const isCreditCardPayment = selectedPaymentMethod.value === 'credit_card';
  const isBoletoPayment = selectedPaymentMethod.value === 'boleto';

  if (isPixPayment || isCreditCardPayment || isBoletoPayment) {
    processingPayment.value = true;
  }

  try {
    const paymentData = buildPaymentData();
    const result: CreateOrderPaymentResponse | null =
      await planStore.createOrderPayment(paymentData);

    if (!result) {
      return;
    }

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
  } finally {
    if (isPixPayment || isCreditCardPayment || isBoletoPayment) {
      processingPayment.value = false;
    }
  }
};

const detectCardBrand = (cardNumber: string): string | null => {
  const cleaned = cardNumber.replaceAll(/\s/g, '');

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
    console.error('Erro ao detectar marca do cartão:', error);
    return null;
  }

  return null;
};

const formatCardNumber = (value: string): string => {
  const cleaned = value.replaceAll(/\s/g, '');
  const chunks = cleaned.match(/.{1,4}/g);
  return chunks ? chunks.join(' ') : cleaned;
};

const onCardNumberInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const value = target.value.replaceAll(/\D/g, '');
  newCard.value.number = formatCardNumber(value);
  detectedBrand.value = detectCardBrand(value);
};

const formatExpiry = (value: string): string => {
  const cleaned = value.replaceAll(/\D/g, '');

  if (cleaned.length === 0) {
    return '';
  }

  if (cleaned.length === 1) {
    const firstDigit = Number.parseInt(cleaned[0], 10);
    if (firstDigit > 1) {
      return `0${firstDigit}`;
    }
    return cleaned;
  }

  if (cleaned.length >= 2) {
    const month = cleaned.slice(0, 2);
    const monthNum = Number.parseInt(month, 10);

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

  const monthNum = Number.parseInt(month, 10);

  if (Number.isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
    return t('invalid_month');
  }

  if (!year || year.length !== 2) {
    return null;
  }

  const yearNum = Number.parseInt(year, 10);

  if (Number.isNaN(yearNum)) {
    return t('invalid_year');
  }

  const currentDate = new Date();
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
  let value = target.value.replaceAll(/\D/g, '');

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

watch(
  selectedPlanForCheckout,
  (plan, previousPlan) => {
    const hasPlanChanged = plan?.plan_id !== previousPlan?.plan_id;

    if (hasPlanChanged) {
      selectedAddons.value = [];
      selectedCrossSellByType.value = {};

      if (plan && !isTestPlan(plan) && step2Loaded.value) {
        prefillRenewalAddons();
      }

      return;
    }

    if (plan && isTestPlan(plan)) {
      selectedAddons.value = [];
      selectedCrossSellByType.value = {};
    }
  },
  { immediate: false }
);

watch(
  enabledPaymentMethods,
  () => {
    if (
      selectedPaymentMethod.value &&
      !isPaymentMethodEnabled(selectedPaymentMethod.value)
    ) {
      selectedPaymentMethod.value = null;
    }
  },
  { deep: true }
);

watch(selectedPaymentMethod, (newMethod) => {
  if (newMethod !== 'credit_card' && showAddCardModal.value) {
    showAddCardModal.value = false;
  }
  if (newMethod === 'credit_card' && billingPeriod.value === 'annual') {
    loadCreditCardFee();
  }
});

watch(billingPeriod, (newBilling) => {
  if (
    newBilling === 'annual' &&
    selectedPaymentMethod.value === 'credit_card'
  ) {
    loadCreditCardFee();
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
        <div v-if="loading">
          <div class="d-flex align-center gap-3 mb-4">
            <VSkeletonLoader type="avatar" width="40" height="40" />
          </div>

          <VSkeletonLoader type="heading" width="200" class="mx-auto mb-2" />
          <VSkeletonLoader type="text" width="300" class="mx-auto mb-6" />

          <div class="d-flex justify-center align-center gap-4 mb-8">
            <VSkeletonLoader type="text" width="60" />
            <VSkeletonLoader type="chip" width="50" />
            <VSkeletonLoader type="text" width="60" />
          </div>

          <VRow class="plans-row" justify="center">
            <VCol
              v-for="n in 3"
              :key="n"
              cols="12"
              sm="6"
              md="4"
              class="plan-col"
            >
              <VCard variant="outlined" class="plan-card w-100">
                <VCardText>
                  <div class="text-center mb-4">
                    <VSkeletonLoader
                      type="avatar"
                      class="mx-auto mb-4"
                      width="80"
                      height="80"
                    />
                    <VSkeletonLoader
                      type="heading"
                      class="mx-auto mb-2"
                      width="120"
                    />
                    <VSkeletonLoader type="text" class="mx-auto" width="180" />
                  </div>

                  <div class="text-center mb-6">
                    <VSkeletonLoader
                      type="heading"
                      class="mx-auto mb-2"
                      width="140"
                    />
                    <VSkeletonLoader type="text" class="mx-auto" width="80" />
                  </div>

                  <VDivider class="mb-4" />

                  <div class="d-flex flex-column gap-3 mb-6">
                    <div
                      v-for="i in 4"
                      :key="i"
                      class="d-flex align-center gap-2"
                    >
                      <VSkeletonLoader type="avatar" width="20" height="20" />
                      <VSkeletonLoader type="text" width="150" />
                    </div>
                  </div>

                  <VSkeletonLoader type="button" class="w-100" />
                </VCardText>
              </VCard>
            </VCol>
          </VRow>
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
              <VStepperItem
                :value="4"
                :title="
                  isTestPlan(selectedPlanForCheckout)
                    ? $t('test')
                    : $t('payment')
                "
              />
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
                          currentPlanBillingPeriod === 'annual' && isPlanActive
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
                        :disabled="
                          currentPlanBillingPeriod === 'annual' && isPlanActive
                        "
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
                                {{ getBillingPeriodText(plan) }}
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
                  <!-- Alerta quando upgrade está bloqueado -->
                  <VAlert
                    v-if="isUpgradeBlocked"
                    type="warning"
                    variant="tonal"
                    class="mb-4"
                    prominent
                  >
                    <VAlertTitle>
                      {{ $t('upgrade_blocked_title') }}
                    </VAlertTitle>
                    <div>
                      {{ $t('upgrade_blocked_message') }}
                    </div>
                  </VAlert>

                  <!-- Alerta quando total fica zerado -->
                  <VAlert
                    v-if="isTotalZero"
                    type="warning"
                    variant="tonal"
                    class="mb-4"
                    prominent
                  >
                    <VAlertTitle>
                      {{ $t('total_zero_title') }}
                    </VAlertTitle>
                    <div>
                      {{ $t('total_zero_message') }}
                    </div>
                  </VAlert>

                  <VRow class="plan-addons-row">
                    <!-- Plano Selecionado - Esquerda -->
                    <VCol cols="12" md="6" class="d-flex flex-column">
                      <h4 class="text-h6 mb-4">{{ $t('selected_plan') }}</h4>
                      <div class="plan-selected-container">
                        <VCard variant="outlined" class="h-100">
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
                                  {{
                                    getBillingPeriodText(
                                      selectedPlanForCheckout
                                    )
                                  }}
                                </div>
                              </div>
                            </div>
                          </VCardText>
                        </VCard>
                      </div>
                    </VCol>

                    <!-- Adicionais - Direita -->
                    <VCol cols="12" md="6" class="d-flex flex-column">
                      <h4 class="text-h6 mb-4">{{ $t('addons') }}</h4>
                      <div class="addons-container">
                        <div
                          v-if="loadingProducts"
                          class="d-flex flex-column gap-4"
                        >
                          <VCard v-for="n in 2" :key="n" variant="outlined">
                            <VCardText>
                              <div class="d-flex flex-column gap-3">
                                <div>
                                  <VSkeletonLoader
                                    type="text"
                                    width="150"
                                    class="mb-1"
                                  />
                                  <VSkeletonLoader type="text" width="250" />
                                </div>
                                <div class="d-flex align-center gap-2">
                                  <VSkeletonLoader
                                    type="text"
                                    class="flex-grow-1"
                                  />
                                  <VSkeletonLoader type="button" width="80" />
                                </div>
                              </div>
                            </VCardText>
                          </VCard>
                        </div>

                        <div
                          v-else-if="groupedCrossSells.length > 0"
                          class="addons-scrollable"
                        >
                          <VCard
                            v-for="group in groupedCrossSells"
                            :key="group.product_id"
                            variant="outlined"
                            :class="{
                              'border-primary': isAddonSelected(
                                group.product_id
                              ),
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

                                <div class="d-flex align-center gap-2">
                                  <VSelect
                                    v-model="
                                      selectedCrossSellByType[group.product_id]
                                    "
                                    :items="
                                      group.options.map((opt) => ({
                                        title: getCrossSellLabel(opt),
                                        value: opt.plan_cross_sell_id,
                                        raw: opt,
                                      }))
                                    "
                                    item-title="title"
                                    item-value="value"
                                    :label="`Selecione ${group.product_name}`"
                                    variant="outlined"
                                    density="compact"
                                    class="flex-grow-1"
                                    placeholder="Selecione uma opção"
                                    :disabled="
                                      isTestPlan(selectedPlanForCheckout)
                                    "
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

                                <div
                                  v-if="isAddonSelected(group.product_id)"
                                  class="d-flex align-center justify-space-between"
                                >
                                  <VChip color="success" variant="tonal">
                                    {{
                                      $t('selected_quantity', {
                                        quantity: getAddonQuantity(
                                          group.product_id
                                        ),
                                      })
                                    }}
                                  </VChip>
                                  <VBtn
                                    color="error"
                                    variant="outlined"
                                    size="small"
                                    :disabled="
                                      isTestPlan(selectedPlanForCheckout) ||
                                      !canRemoveAddonSelection(group.product_id)
                                    "
                                    @click="removeAddon(group.product_id)"
                                  >
                                    {{ $t('remove') }} 1
                                  </VBtn>
                                </div>
                              </div>
                            </VCardText>
                          </VCard>
                        </div>

                        <VCard v-else variant="outlined" class="h-100">
                          <VCardText class="text-center py-4">
                            <div class="text-body-2 text-medium-emphasis">
                              {{ $t('no_addons_available') }}
                            </div>
                          </VCardText>
                        </VCard>
                      </div>
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
                      <div
                        v-if="
                          upgradeDiscount?.is_upgrade &&
                          upgradeDiscount.discount > 0
                        "
                        class="d-flex align-center justify-space-between mb-2"
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
                <div v-else-if="loadingUser">
                  <VRow>
                    <!-- Skeleton Informações Pessoais -->
                    <VCol cols="12" md="6">
                      <VSkeletonLoader
                        type="heading"
                        width="180"
                        class="mb-4"
                      />
                      <VCard variant="outlined">
                        <VCardText>
                          <div class="d-flex flex-column gap-3">
                            <div v-for="i in 4" :key="i">
                              <VSkeletonLoader
                                type="text"
                                width="80"
                                class="mb-1"
                              />
                              <VSkeletonLoader type="text" width="200" />
                              <VDivider v-if="i < 4" class="mt-3" />
                            </div>
                          </div>
                        </VCardText>
                      </VCard>
                    </VCol>

                    <!-- Skeleton Endereço -->
                    <VCol cols="12" md="6">
                      <VSkeletonLoader
                        type="heading"
                        width="120"
                        class="mb-4"
                      />
                      <VCard variant="outlined">
                        <VCardText>
                          <div class="d-flex flex-column gap-3">
                            <div v-for="i in 5" :key="i">
                              <VSkeletonLoader
                                type="text"
                                width="80"
                                class="mb-1"
                              />
                              <VSkeletonLoader type="text" width="180" />
                              <VDivider v-if="i < 5" class="mt-3" />
                            </div>
                          </div>
                        </VCardText>
                      </VCard>
                    </VCol>
                  </VRow>
                </div>
              </VStepperWindowItem>

              <!-- Step 4: Pagamento ou Teste -->
              <VStepperWindowItem :value="4">
                <!-- Tela de Teste para Plano de Teste -->
                <div v-if="isTestPlan(selectedPlanForCheckout)">
                  <div class="text-center mb-6">
                    <VIcon
                      v-if="selectedPlanForCheckout"
                      :icon="selectedPlanForCheckout.icon || 'tabler-test-pipe'"
                      size="64"
                      color="primary"
                      class="mb-4"
                    />
                    <h4 class="text-h4 mb-2">
                      {{ $t('test_plan_title') }}
                    </h4>
                    <p class="text-body-1 text-medium-emphasis">
                      {{ $t('test_plan_subtitle') }}
                    </p>
                  </div>

                  <VCard variant="outlined" class="mb-6">
                    <VCardText>
                      <div
                        v-if="selectedPlanForCheckout"
                        class="d-flex align-center gap-3 mb-4"
                      >
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

                      <div class="d-flex flex-column gap-3">
                        <div class="d-flex align-center gap-2">
                          <VIcon
                            icon="tabler-clock"
                            size="20"
                            color="primary"
                          />
                          <span class="text-body-1">
                            {{
                              $t('test_plan_duration', {
                                days: selectedPlanForCheckout?.days_trial || 0,
                              })
                            }}
                          </span>
                        </div>
                        <div class="d-flex align-center gap-2">
                          <VIcon
                            icon="tabler-info-circle"
                            size="20"
                            color="primary"
                          />
                          <span class="text-body-1">
                            {{ $t('test_plan_unique') }}
                          </span>
                        </div>
                        <div class="d-flex align-center gap-2">
                          <VIcon
                            icon="tabler-check"
                            size="20"
                            color="success"
                          />
                          <span class="text-body-1">
                            {{ $t('test_plan_features') }}
                          </span>
                        </div>
                      </div>
                    </VCardText>
                  </VCard>

                  <VAlert type="info" variant="tonal" class="mb-6">
                    <VAlertTitle>
                      {{ $t('test_plan_info_title') }}
                    </VAlertTitle>
                    <div>
                      {{ $t('test_plan_info_message') }}
                    </div>
                  </VAlert>
                </div>

                <!-- Tela de Pagamento para Planos Normais -->
                <div v-else>
                  <h4 v-if="!paymentInitiated" class="text-h6 mb-4">
                    {{ $t('select_payment_method') }}
                  </h4>

                  <!-- Alerta quando upgrade está bloqueado -->
                  <VAlert
                    v-if="isUpgradeBlocked"
                    type="warning"
                    variant="tonal"
                    class="mb-4"
                    prominent
                  >
                    <VAlertTitle>
                      {{ $t('upgrade_blocked_title') }}
                    </VAlertTitle>
                    <div>
                      {{ $t('upgrade_blocked_message') }}
                    </div>
                  </VAlert>

                  <!-- Alerta quando total fica zerado -->
                  <VAlert
                    v-if="isTotalZero"
                    type="warning"
                    variant="tonal"
                    class="mb-4"
                    prominent
                  >
                    <VAlertTitle>
                      {{ $t('total_zero_title') }}
                    </VAlertTitle>
                    <div>
                      {{ $t('total_zero_message') }}
                    </div>
                  </VAlert>

                  <VRow v-if="!paymentInitiated">
                    <!-- Loading Skeleton -->
                    <template v-if="loadingPaymentMethods">
                      <VCol cols="12" md="4" v-for="n in 3" :key="n">
                        <VCard variant="outlined">
                          <VCardText class="text-center">
                            <VSkeletonLoader
                              type="avatar"
                              width="48"
                              height="48"
                              class="mx-auto mb-3"
                            />
                            <VSkeletonLoader
                              type="text"
                              width="120"
                              class="mx-auto mb-2"
                            />
                            <VSkeletonLoader
                              type="text"
                              width="180"
                              class="mx-auto"
                            />
                          </VCardText>
                        </VCard>
                      </VCol>
                    </template>

                    <!-- Boleto -->
                    <VCol
                      v-else-if="isPaymentMethodEnabled('boleto')"
                      :cols="getPaymentMethodColClasses.cols"
                      :md="getPaymentMethodColClasses.md"
                    >
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
                    <VCol
                      v-if="
                        !loadingPaymentMethods &&
                        isPaymentMethodEnabled('credit_card')
                      "
                      :cols="getPaymentMethodColClasses.cols"
                      :md="getPaymentMethodColClasses.md"
                    >
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
                    <VCol
                      v-if="
                        !loadingPaymentMethods && isPaymentMethodEnabled('pix')
                      "
                      :cols="getPaymentMethodColClasses.cols"
                      :md="getPaymentMethodColClasses.md"
                    >
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

                    <!-- Mensagem quando não há métodos habilitados -->
                    <VCol
                      v-if="
                        !loadingPaymentMethods &&
                        enabledPaymentMethods.length === 0
                      "
                      cols="12"
                    >
                      <VAlert type="warning" variant="tonal" prominent>
                        <VAlertTitle>
                          {{ $t('no_payment_methods_available') }}
                        </VAlertTitle>
                        <div>
                          {{ $t('no_payment_methods_available_message') }}
                        </div>
                      </VAlert>
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
                                v-for="addonItem in selectedAddonsSummary"
                                :key="addonItem.addon.plan_cross_sell_id"
                                class="d-flex justify-space-between align-center"
                              >
                                <span class="text-body-2 text-medium-emphasis">
                                  {{ addonItem.addon.name }}
                                  <span>(x{{ addonItem.totalQuantity }})</span>:
                                </span>
                                <span class="text-body-2 font-weight-medium">
                                  {{ formatCurrency(addonItem.totalPrice) }}
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

                      <VLabel class="text-body-2 mb-1"
                        >{{ $t('select_credit_card') }}:</VLabel
                      >

                      <VSkeletonLoader
                        v-if="loadingCards"
                        type="text"
                        height="56"
                        class="mb-4 rounded"
                      />

                      <VSelect
                        v-else-if="userCards.length > 0"
                        v-model="selectedCardId"
                        :items="cardSelectItems"
                        variant="outlined"
                        density="comfortable"
                        item-title="title"
                        item-value="value"
                        clearable
                        clear-icon="tabler-x"
                        class="mb-4 credit-card-select"
                        @update:model-value="
                          (value) => {
                            selectedCardId = value;
                          }
                        "
                      >
                        <template #item="{ item, props: itemProps }">
                          <VListItem v-bind="itemProps" :title="item.title">
                            <template #prepend>
                              <VAvatar
                                v-if="item.brand && getBrandLogoUrl(item.brand)"
                                size="32"
                                class="mr-2"
                              >
                                <VImg
                                  :src="getBrandLogoUrl(item.brand) || ''"
                                  :alt="item.brand || ''"
                                  cover
                                />
                              </VAvatar>
                              <VIcon
                                v-else-if="item.value"
                                icon="tabler-credit-card"
                                size="24"
                                class="mr-2"
                              />
                            </template>
                          </VListItem>
                        </template>
                        <template #selection="{ item }">
                          <div class="d-flex align-center">
                            <VAvatar
                              v-if="item.brand && getBrandLogoUrl(item.brand)"
                              size="24"
                              class="mr-2"
                            >
                              <VImg
                                :src="getBrandLogoUrl(item.brand) || ''"
                                :alt="item.brand || ''"
                                cover
                              />
                            </VAvatar>
                            <VIcon
                              v-else-if="item.value"
                              icon="tabler-credit-card"
                              size="20"
                              class="mr-2"
                            />
                            <span>{{ item.title }}</span>
                          </div>
                        </template>
                      </VSelect>

                      <VCard v-else variant="outlined" class="mb-4">
                        <VCardText class="text-center py-4">
                          <div class="text-body-2 text-medium-emphasis mb-3">
                            {{ $t('no_cards_registered') }}
                          </div>
                        </VCardText>
                      </VCard>

                      <!-- Opções de Parcelamento e Recorrência -->
                      <VCard variant="outlined" class="mb-4">
                        <VCardText>
                          <h5 class="text-h6 mb-4">
                            {{ $t('payment_options') }}
                          </h5>

                          <!-- Parcelamento (apenas para plano anual) -->
                          <div v-if="billingPeriod === 'annual'" class="mb-4">
                            <VLabel class="text-body-2 mb-1"
                              >{{ $t('select_installments') }}:</VLabel
                            >
                            <VSelect
                              v-model="installments"
                              :items="installmentOptions"
                              variant="outlined"
                              density="compact"
                              item-title="title"
                              item-value="value"
                            />
                          </div>

                          <!-- Recorrência -->
                          <div>
                            <VCheckbox
                              v-model="recurringPayment"
                              :label="$t('recurring_payment')"
                              color="primary"
                              hide-details
                            />
                            <p class="text-body-2 text-medium-emphasis mt-2">
                              {{ $t('recurring_payment_description') }}
                            </p>
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
                                v-for="addonItem in selectedAddonsSummary"
                                :key="addonItem.addon.plan_cross_sell_id"
                                class="d-flex justify-space-between align-center"
                              >
                                <span class="text-body-2 text-medium-emphasis">
                                  {{ addonItem.addon.name }}
                                  <span>(x{{ addonItem.totalQuantity }})</span>:
                                </span>
                                <span class="text-body-2 font-weight-medium">
                                  {{ formatCurrency(addonItem.totalPrice) }}
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
                            v-if="creditCardFeeAmount > 0"
                            class="d-flex justify-space-between align-center mb-2"
                          >
                            <span class="text-body-2 text-medium-emphasis">
                              {{ $t('credit_card_fee') }}:
                            </span>
                            <span class="text-body-2 font-weight-medium">
                              {{ formatCurrency(creditCardFeeAmount) }}
                            </span>
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

                  <!-- Opções de Parcelamento e Recorrência (quando formulário de adicionar cartão está aberto) -->
                  <VRow
                    v-if="
                      selectedPaymentMethod === 'credit_card' &&
                      showAddCardModal
                    "
                    class="mt-6"
                  >
                    <VCol cols="12" md="6">
                      <VCard variant="outlined">
                        <VCardText>
                          <h5 class="text-h6 mb-4">
                            {{ $t('payment_options') }}
                          </h5>

                          <!-- Parcelamento (apenas para plano anual) -->
                          <div v-if="billingPeriod === 'annual'" class="mb-4">
                            <VLabel class="text-body-2 mb-1"
                              >{{ $t('select_installments') }}:</VLabel
                            >
                            <VSelect
                              v-model="installments"
                              :items="installmentOptions"
                              variant="outlined"
                              density="compact"
                              item-title="title"
                              item-value="value"
                            />
                          </div>

                          <!-- Recorrência -->
                          <div>
                            <VCheckbox
                              v-model="recurringPayment"
                              :label="$t('recurring_payment')"
                              color="primary"
                              hide-details
                            />
                            <p class="text-body-2 text-medium-emphasis mt-2">
                              {{ $t('recurring_payment_description') }}
                            </p>
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
                                <VLabel class="text-body-2 mb-1"
                                  >{{ $t('card_number') }}:</VLabel
                                >
                                <VTextField
                                  v-model="newCard.number"
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
                                <VLabel class="text-body-2 mb-1"
                                  >{{ $t('cardholder_name') }}:</VLabel
                                >
                                <VTextField
                                  v-model="newCard.holderName"
                                  placeholder="Nome como está no cartão"
                                  :maxlength="100"
                                />
                              </VCol>
                              <VCol cols="6">
                                <VLabel class="text-body-2 mb-1"
                                  >{{ $t('expiry_date') }}:</VLabel
                                >
                                <VTextField
                                  :model-value="
                                    newCard.expiryMonth && newCard.expiryYear
                                      ? `${newCard.expiryMonth}/${newCard.expiryYear}`
                                      : ''
                                  "
                                  placeholder="MM/AA"
                                  @input="onExpiryInput"
                                  :maxlength="5"
                                  :error="!!expiryError"
                                  :error-messages="expiryError"
                                />
                              </VCol>
                              <VCol cols="6">
                                <VLabel class="text-body-2 mb-1"
                                  >{{ $t('cvv') }}:</VLabel
                                >
                                <VTextField
                                  v-model="newCard.cvv"
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
                                v-for="addonItem in selectedAddonsSummary"
                                :key="addonItem.addon.plan_cross_sell_id"
                                class="d-flex justify-space-between align-center"
                              >
                                <span class="text-body-2 text-medium-emphasis">
                                  {{ addonItem.addon.name }}
                                  <span>(x{{ addonItem.totalQuantity }})</span>:
                                </span>
                                <span class="text-body-2 font-weight-medium">
                                  {{ formatCurrency(addonItem.totalPrice) }}
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
                            v-if="creditCardFeeAmount > 0"
                            class="d-flex justify-space-between align-center mb-2"
                          >
                            <span class="text-body-2 text-medium-emphasis">
                              {{ $t('credit_card_fee') }}:
                            </span>
                            <span class="text-body-2 font-weight-medium">
                              {{ formatCurrency(creditCardFeeAmount) }}
                            </span>
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
                                v-for="addonItem in selectedAddonsSummary"
                                :key="addonItem.addon.plan_cross_sell_id"
                                class="d-flex justify-space-between align-center"
                              >
                                <span class="text-body-2 text-medium-emphasis">
                                  {{ addonItem.addon.name }}
                                  <span>(x{{ addonItem.totalQuantity }})</span>:
                                </span>
                                <span class="text-body-2 font-weight-medium">
                                  {{ formatCurrency(addonItem.totalPrice) }}
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
                </div>
              </VStepperWindowItem>
            </VStepperWindow>

            <!-- Botões de Navegação -->
            <VCardText class="d-flex justify-space-between flex-wrap gap-3">
              <template v-if="!pixPaymentInitiated">
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
                        userCards.length > 0 &&
                        !isNewCardValid) ||
                      isDiscountGreaterThanTotal ||
                      isUpgradeBlocked ||
                      isTotalZero ||
                      (isTestPlan(selectedPlanForCheckout) &&
                        testPlanAlreadyUsed)
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
                      (isTestPlan(selectedPlanForCheckout)
                        ? testPlanAlreadyUsed
                        : !selectedPaymentMethod ||
                          (selectedPaymentMethod === 'credit_card' &&
                            !selectedCardId &&
                            userCards.length > 0 &&
                            !isNewCardValid)) ||
                      isDiscountGreaterThanTotal ||
                      isUpgradeBlocked ||
                      isTotalZero ||
                      processingPayment
                    "
                    :loading="processingPayment"
                    @click="processPayment"
                  >
                    {{
                      isTestPlan(selectedPlanForCheckout)
                        ? $t('test_now')
                        : $t('finalize_purchase')
                    }}
                  </VBtn>
                </div>
              </template>
              <template v-else>
                <VSpacer />
                <div class="d-flex align-center gap-3">
                  <VAlert
                    :type="paymentStatusAlert.type"
                    variant="tonal"
                    class="d-flex align-center"
                    density="comfortable"
                  >
                    <VIcon start :icon="paymentStatusAlert.icon" />
                    {{ paymentStatusAlert.message }}
                  </VAlert>
                  <VBtn
                    v-if="!pixModalOpen"
                    color="primary"
                    variant="outlined"
                    @click="pixModalOpen = true"
                  >
                    <VIcon
                      start
                      :icon="
                        selectedPaymentMethod === 'boleto'
                          ? 'tabler-file-invoice'
                          : 'tabler-qrcode'
                      "
                    />
                    {{
                      selectedPaymentMethod === 'boleto'
                        ? $t('view_boleto_payment')
                        : $t('view_pix_payment')
                    }}
                  </VBtn>
                </div>
                <VSpacer />
              </template>
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
      <span v-html="planStore.snackbar.message"></span>
    </VSnackbar>
  </div>

  <VDialog v-model="pixModalOpen" max-width="500" persistent>
    <DialogCloseBtn v-if="shouldShowCloseButton" @click="closePixModal" />
    <VCard>
      <VCardTitle>
        <span>{{
          selectedPaymentMethod === 'pix'
            ? $t('pix_payment')
            : selectedPaymentMethod === 'boleto'
              ? $t('boleto_payment')
              : $t('credit_card_payment')
        }}</span>
      </VCardTitle>
      <VDivider />
      <VCardText class="d-flex flex-column align-center gap-4 pa-6">
        <div v-if="pixPaymentConfirmed" class="text-center w-100">
          <VIcon size="64" color="success" class="mb-4"
            >tabler-circle-check</VIcon
          >
          <h3 class="text-h5 mb-2">{{ $t('payment_success_title') }}</h3>
          <p class="text-body-1">{{ $t('payment_success_message') }}</p>
        </div>
        <div v-else-if="isPaymentReceived" class="text-center w-100">
          <VIcon size="64" color="success" class="mb-4"
            >tabler-circle-check</VIcon
          >
          <h3 class="text-h5 mb-2">{{ $t('payment_received_title') }}</h3>
          <p class="text-body-1">{{ $t('payment_received_message') }}</p>
        </div>
        <div v-else class="text-center w-100">
          <div v-if="pixPaymentStatus" class="mb-4">
            <VChip
              :color="getPaymentStatusColor(pixPaymentStatus)"
              variant="tonal"
              size="large"
            >
              {{ getPaymentStatusText(pixPaymentStatus) }}
            </VChip>
          </div>
          <p v-if="selectedPaymentMethod === 'pix'" class="text-body-1 mb-2">
            {{ $t('pix_payment_instructions') }}
          </p>
          <p
            v-else-if="selectedPaymentMethod === 'boleto'"
            class="text-body-1 mb-2"
          >
            {{ $t('boleto_payment_instructions') }}
          </p>
          <p v-else class="text-body-1 mb-2">
            {{ $t('credit_card_payment_processing') }}
          </p>
          <p
            v-if="
              selectedPaymentMethod === 'pix' && pixPaymentData?.expiration_date
            "
            class="text-caption text-medium-emphasis"
          >
            {{ $t('pix_expires_at') }}:
            {{
              new Date(pixPaymentData.expiration_date).toLocaleString(locale)
            }}
          </p>
        </div>

        <div
          v-if="
            pixPaymentData?.qr_code &&
            !pixPaymentConfirmed &&
            !isPaymentReceived
          "
          class="d-flex justify-center align-center pa-4 bg-grey-lighten-4 rounded mt-n2"
        >
          <img
            :src="getPixQrCodeImageSrc(pixPaymentData.qr_code)"
            alt="QR Code PIX"
            style="
              max-width: 300px;
              max-height: 300px;
              width: 100%;
              height: auto;
              object-fit: contain;
            "
          />
        </div>

        <div
          v-if="
            selectedPaymentMethod === 'pix' &&
            !pixPaymentConfirmed &&
            !isPaymentReceived
          "
          class="w-100"
        >
          <VLabel class="mb-2">{{ $t('pix_copy_paste_code') }}</VLabel>
          <VTextField
            :model-value="pixPaymentData?.payload || ''"
            readonly
            variant="outlined"
            density="compact"
            class="mb-2"
          >
            <template #append-inner>
              <IconBtn
                size="small"
                variant="text"
                class="me-n2"
                @click="copyPixCode"
              >
                <VIcon size="20">tabler-copy</VIcon>
              </IconBtn>
            </template>
          </VTextField>
        </div>

        <VAlert
          v-if="
            selectedPaymentMethod === 'pix' &&
            !pixPaymentConfirmed &&
            !isPaymentReceived
          "
          type="info"
          variant="tonal"
          class="w-100"
        >
          {{ $t('pix_payment_warning') }}
        </VAlert>

        <!-- Boleto Content -->
        <div
          v-if="
            selectedPaymentMethod === 'boleto' &&
            boletoPaymentData &&
            !pixPaymentConfirmed &&
            !isPaymentReceived
          "
          class="w-100"
        >
          <div
            v-if="boletoPaymentData.qr_code"
            class="d-flex justify-center align-center pa-4 bg-grey-lighten-4 rounded mb-4"
          >
            <img
              :src="getPixQrCodeImageSrc(boletoPaymentData.qr_code)"
              alt="QR Code PIX"
              style="
                max-width: 300px;
                max-height: 300px;
                width: 100%;
                height: auto;
                object-fit: contain;
              "
            />
          </div>

          <div v-if="boletoPaymentData.payload" class="mb-4">
            <VLabel class="mb-2">{{ $t('pix_copy_paste_code') }}</VLabel>
            <VTextField
              :model-value="boletoPaymentData.payload || ''"
              readonly
              variant="outlined"
              density="compact"
              class="mb-2"
            >
              <template #append-inner>
                <IconBtn
                  size="small"
                  variant="text"
                  class="me-n2"
                  @click="copyBoletoPixPayload"
                >
                  <VIcon size="20">tabler-copy</VIcon>
                </IconBtn>
              </template>
            </VTextField>
          </div>

          <div class="mb-4">
            <VLabel class="mb-2">{{
              $t('boleto_identification_field')
            }}</VLabel>
            <VTextField
              :model-value="boletoPaymentData.identification_field || ''"
              readonly
              variant="outlined"
              density="compact"
              class="mb-2"
            >
              <template #append-inner>
                <IconBtn
                  size="small"
                  variant="text"
                  class="me-n2"
                  @click="copyBoletoCode"
                >
                  <VIcon size="20">tabler-copy</VIcon>
                </IconBtn>
              </template>
            </VTextField>
          </div>

          <div class="mb-4">
            <VLabel class="mb-2">{{ $t('boleto_due_date') }}</VLabel>
            <p class="text-body-1">
              {{
                new Date(boletoPaymentData.due_date).toLocaleDateString(
                  locale,
                  {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                  }
                )
              }}
            </p>
          </div>

          <VBtn
            v-if="boletoPaymentData.bank_slip_url"
            color="primary"
            variant="elevated"
            block
            @click="downloadBoleto"
          >
            <VIcon start>tabler-download</VIcon>
            {{ $t('download_boleto') }}
          </VBtn>
        </div>
      </VCardText>
      <VDivider />
      <VCardActions v-if="shouldShowCloseButton" class="justify-end pa-4">
        <VBtn variant="tonal" color="secondary" @click="closePixModal">
          {{ $t('close') }}
        </VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
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

.plan-addons-row {
  align-items: stretch;
}

.plan-selected-container,
.addons-container {
  flex: 1;
  min-height: 400px;
  display: flex;
  flex-direction: column;
}

.addons-scrollable {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 8px;
  min-height: 0;
  /* Para Firefox */
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.2) rgba(0, 0, 0, 0.05);
}

/* Estilização da barra de rolagem */
.addons-scrollable::-webkit-scrollbar {
  width: 8px;
}

.addons-scrollable::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.05);
  border-radius: 4px;
}

.addons-scrollable::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  transition: background 0.2s ease;
}

.addons-scrollable::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.3);
}

.credit-card-select {
  .v-field__clearable {
    opacity: 1 !important;
    visibility: visible !important;
    display: flex !important;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    min-width: 32px;
    border-radius: 50%;
    background-color: rgba(var(--v-theme-error), 0.1);
    cursor: pointer;
    transition: all 0.2s ease;
    margin-inline-start: 8px;

    &:hover {
      background-color: rgba(var(--v-theme-error), 0.2);
      transform: scale(1.1);
    }

    &:active {
      transform: scale(0.95);
    }

    .v-icon {
      color: rgb(var(--v-theme-error)) !important;
      font-size: 20px !important;
    }
  }
}
</style>
