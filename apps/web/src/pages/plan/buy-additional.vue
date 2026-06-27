<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
} from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { can } from '@layouts/plugins/casl';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EPlanPermissions } from '@core/common/enums/EPermissions/plan';
import { EColor } from '@core/common/enums/EColor';
import { usePlanStore } from '@/@webcore/stores/plan';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { getUser } from '@/@webcore/localStorage/user';
import { ListAvailableCrossSellResponse } from '@core/schema/plan/listAvailableCrossSell/response.schema';
import { ViewCurrentPlanResponse } from '@core/schema/plan/viewCurrentPlan/response.schema';
import { ListUserCardResponse } from '@core/schema/plan/listUserCards/response.schema';
import { ListCreditCardFeeResponse } from '@core/schema/config/listCreditCardFee/response.schema';
import { ListMethodPaymentsResponse } from '@core/schema/plan/listMethodPayments/response.schema';
import { CreateOrderPaymentRequest } from '@core/schema/plan/createOrderPayment/request.schema';
import { CreateOrderPaymentResponse } from '@core/schema/plan/createOrderPayment/response.schema';
import { EMethodPayment } from '@core/common/enums/EMethodPayment';
import creditCardType from 'credit-card-type';
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
import { onMessage, unsubscribe } from '@/@webcore/centrifugo';
import { paymentAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import DialogCloseBtn from '@/@webcore/components/DialogCloseBtn.vue';
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
const router = useRouter();
const planStore = usePlanStore();

const checkoutPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EPlanPermissions.plan_group,
  EPlanPermissions.plan_invoice,
];

useSnackbarCleanup(planStore);

const MONTHLY_CREDIT_CARD_FEE_INSTALLMENT = 3;

type AddonCartItem = {
  plan_cross_sell_id: string;
  plan_product_id: string;
  name: string;
  quantity: number;
  price_per_cycle: number;
  price_proportional: number;
  purchase_count: number;
  is_single_use: boolean;
};

const loadingInitial = ref(false);
const loadingProducts = ref(false);
const loadingCards = ref(false);
const processingPayment = ref(false);

const currentPlanInvoice = ref<ViewCurrentPlanResponse | null>(null);
const availableCrossSells = ref<ListAvailableCrossSellResponse[]>([]);
const addonCartItems = ref<AddonCartItem[]>([]);

const selectedCrossSellByType = ref<Record<string, string | null>>({});
const selectedQuantityByType = ref<Record<string, number>>({});

const creditCardFee = ref<ListCreditCardFeeResponse | null>(null);
const enabledPaymentMethods = ref<ListMethodPaymentsResponse>([]);
const selectedPaymentMethod = ref<'boleto' | 'credit_card' | 'pix' | null>(
  null
);

const userCards = ref<ListUserCardResponse[]>([]);
const selectedCardId = ref<string | null>(null);
const useNewCard = ref(false);
const installments = ref(1);

const newCard = ref({
  number: '',
  holderName: '',
  expiryMonth: '',
  expiryYear: '',
  cvv: '',
});
const detectedBrand = ref<string | null>(null);
const showCvv = ref(false);
const expiryError = ref<string | null>(null);

const paymentDialogOpen = ref(false);
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
const paymentId = ref<string | null>(null);
const paymentStatus = ref<
  'PENDING' | 'RECEIVED' | 'CONFIRMED' | 'OVERDUE' | 'REFUNDED' | null
>(null);
const paymentConfirmed = ref(false);
const paymentSubscription = ref<Subscription | null>(null);

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

const formatDate = (dateString: string | null | undefined): string => {
  if (!dateString) {
    return '';
  }

  const date = new Date(dateString);
  const localeMap: Record<string, string> = {
    pt: 'pt-BR',
    en: 'en-US',
    es: 'es-ES',
  };

  const currentLocale = localeMap[locale.value] || 'pt-BR';

  return new Intl.DateTimeFormat(currentLocale, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
};

const roundTo2 = (value: number): number => {
  return Math.round(value * 100) / 100;
};

const applyCreditCardFee = (value: number, feeRate: number): number => {
  if (!value) return 0;
  if (!feeRate) return roundTo2(value);

  return roundTo2(value * (1 + feeRate / 100));
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

  return rates[installment] || 0;
};

const hasActivePlan = computed(() => {
  if (
    !currentPlanInvoice.value?.plan_id ||
    !currentPlanInvoice.value.next_payment_date
  ) {
    return false;
  }

  return new Date(currentPlanInvoice.value.next_payment_date) > new Date();
});

const currentBillingPeriod = computed<'monthly' | 'annual'>(() => {
  return currentPlanInvoice.value?.billing_period === 'annual'
    ? 'annual'
    : 'monthly';
});

const daysRemaining = computed(() => {
  const fromCrossSell = availableCrossSells.value[0]?.days_remaining;
  if (fromCrossSell && fromCrossSell > 0) {
    return fromCrossSell;
  }

  if (!currentPlanInvoice.value?.next_payment_date) {
    return 0;
  }

  const nextDate = new Date(currentPlanInvoice.value.next_payment_date);
  const now = new Date();
  return Math.max(
    0,
    Math.ceil((nextDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  );
});

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

  const purchasableCrossSells = availableCrossSells.value.filter(
    (crossSell) => crossSell.can_purchase !== false
  );

  for (const crossSell of purchasableCrossSells) {
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

const getCrossSellCyclePrice = (crossSell: ListAvailableCrossSellResponse) => {
  const fallbackMultiplier = currentBillingPeriod.value === 'annual' ? 12 : 1;
  return Number(
    crossSell.price_per_cycle ?? crossSell.price * fallbackMultiplier
  );
};

const getCrossSellProportionalPrice = (
  crossSell: ListAvailableCrossSellResponse
) => {
  return Number(
    crossSell.price_proportional ??
      crossSell.price_per_cycle ??
      getCrossSellCyclePrice(crossSell)
  );
};

const getCrossSellLabel = (
  crossSell: ListAvailableCrossSellResponse
): string => {
  return `${crossSell.quantity}x - ${formatCurrency(
    getCrossSellCyclePrice(crossSell)
  )}`;
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

const getSelectedQuantityForProduct = (planProductId: string): number => {
  const value = selectedQuantityByType.value[planProductId] || 1;
  return Math.max(1, Math.floor(value));
};

const updateSelectedQuantityForProduct = (
  planProductId: string,
  value: number
) => {
  if (!Number.isFinite(value)) {
    selectedQuantityByType.value[planProductId] = 1;
    return;
  }

  selectedQuantityByType.value[planProductId] = Math.max(1, Math.floor(value));
};

const isSelectedOptionSingleUse = (planProductId: string): boolean => {
  const option = getSelectedOptionForProduct(planProductId);
  return option?.is_single_use === true;
};

const getCartCountForProduct = (planProductId: string): number => {
  return addonCartItems.value
    .filter((item) => item.plan_product_id === planProductId)
    .reduce((total, item) => total + item.purchase_count, 0);
};

const addAddon = (planProductId: string) => {
  const selectedOption = getSelectedOptionForProduct(planProductId);
  if (!selectedOption) return;

  const isSingleUse = selectedOption.is_single_use === true;
  const currentProductCount = getCartCountForProduct(planProductId);

  if (isSingleUse && currentProductCount >= 1) {
    return;
  }

  const desiredCount = isSingleUse
    ? 1
    : getSelectedQuantityForProduct(planProductId);

  const existingItem = addonCartItems.value.find(
    (item) => item.plan_cross_sell_id === selectedOption.plan_cross_sell_id
  );

  if (existingItem) {
    if (existingItem.is_single_use) {
      return;
    }

    existingItem.purchase_count += desiredCount;
    return;
  }

  addonCartItems.value.push({
    plan_cross_sell_id: selectedOption.plan_cross_sell_id,
    plan_product_id: selectedOption.plan_product_id,
    name: selectedOption.plan_product?.name || '',
    quantity: selectedOption.quantity,
    price_per_cycle: getCrossSellCyclePrice(selectedOption),
    price_proportional: getCrossSellProportionalPrice(selectedOption),
    purchase_count: desiredCount,
    is_single_use: isSingleUse,
  });

  selectedQuantityByType.value[planProductId] = 1;
};

const increaseAddonLine = (item: AddonCartItem) => {
  if (item.is_single_use) {
    return;
  }

  item.purchase_count += 1;
};

const decreaseAddonLine = (item: AddonCartItem) => {
  if (item.purchase_count <= 1) {
    addonCartItems.value = addonCartItems.value.filter(
      (line) => line.plan_cross_sell_id !== item.plan_cross_sell_id
    );

    return;
  }

  item.purchase_count -= 1;
};

const removeAddonLine = (item: AddonCartItem) => {
  addonCartItems.value = addonCartItems.value.filter(
    (line) => line.plan_cross_sell_id !== item.plan_cross_sell_id
  );
};

const getAddonLineTotal = (item: AddonCartItem): number => {
  return roundTo2(item.price_proportional * item.purchase_count);
};

const addonsSubtotal = computed(() => {
  return roundTo2(
    addonCartItems.value.reduce(
      (total, item) => total + getAddonLineTotal(item),
      0
    )
  );
});

const isPaymentMethodEnabled = (
  method: 'boleto' | 'credit_card' | 'pix'
): boolean => {
  return enabledPaymentMethods.value.some(
    (paymentMethod) => paymentMethod.type === method && paymentMethod.status
  );
};

const isCreditCardEnabled = computed(() => {
  return isPaymentMethodEnabled('credit_card');
});

const shouldApplyCreditCardFee = computed(() => {
  return selectedPaymentMethod.value === 'credit_card';
});

const selectedInstallmentFeeRate = computed(() => {
  if (!shouldApplyCreditCardFee.value) return 0;

  if (currentBillingPeriod.value === 'monthly') {
    return getCreditCardFeeRate(MONTHLY_CREDIT_CARD_FEE_INSTALLMENT);
  }

  return getCreditCardFeeRate(installments.value);
});

const checkoutTotal = computed(() => {
  if (!shouldApplyCreditCardFee.value) {
    return addonsSubtotal.value;
  }

  return applyCreditCardFee(
    addonsSubtotal.value,
    selectedInstallmentFeeRate.value
  );
});

const creditCardFeeAmount = computed(() => {
  if (!shouldApplyCreditCardFee.value) return 0;

  return roundTo2(checkoutTotal.value - addonsSubtotal.value);
});

const installmentOptions = computed(() => {
  if (selectedPaymentMethod.value !== 'credit_card') {
    return [] as Array<{ title: string; value: number }>;
  }

  if (currentBillingPeriod.value !== 'annual') {
    return [] as Array<{ title: string; value: number }>;
  }

  if (!creditCardFee.value) {
    return [] as Array<{ title: string; value: number }>;
  }

  const options: Array<{ title: string; value: number }> = [];
  for (let i = 1; i <= 12; i += 1) {
    const feeRate = getCreditCardFeeRate(i);
    const totalWithFee = applyCreditCardFee(addonsSubtotal.value, feeRate);
    const installmentValue = i > 0 ? totalWithFee / i : totalWithFee;

    options.push({
      value: i,
      title: t('credit_card_installment_option', {
        number: i,
        installmentValue: formatCurrency(installmentValue),
        totalWithFee: formatCurrency(totalWithFee),
      }),
    });
  }

  return options;
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

const isNewCardValid = computed(() => {
  const number = newCard.value.number.replaceAll(/\s/g, '');
  return (
    number.length >= 13 &&
    newCard.value.holderName.trim().length >= 3 &&
    newCard.value.expiryMonth.length === 2 &&
    newCard.value.expiryYear.length === 2 &&
    !expiryError.value &&
    newCard.value.cvv.length >= 3 &&
    newCard.value.cvv.length <= 4
  );
});

const canProcessPayment = computed(() => {
  if (!hasActivePlan.value) return false;
  if (addonCartItems.value.length === 0) return false;
  if (!selectedPaymentMethod.value) return false;

  if (selectedPaymentMethod.value !== 'credit_card') {
    return true;
  }

  if (useNewCard.value) {
    return isNewCardValid.value;
  }

  return Boolean(selectedCardId.value);
});

const detectCardBrand = (cardNumber: string): string | null => {
  const cleaned = cardNumber.replaceAll(/\s/g, '');

  if (cleaned.length < 4) {
    return null;
  }

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
  } catch {
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

  return typeof logoPath === 'string'
    ? logoPath
    : (logoPath as any)?.default || logoPath;
};

const resetNewCardForm = () => {
  newCard.value = {
    number: '',
    holderName: '',
    expiryMonth: '',
    expiryYear: '',
    cvv: '',
  };
  detectedBrand.value = null;
  expiryError.value = null;
  showCvv.value = false;
};

const loadCurrentPlan = async () => {
  const currentPlan = await planStore.getCurrentPlanDetails();
  currentPlanInvoice.value = currentPlan;
};

const loadAvailableAddons = async () => {
  if (!hasActivePlan.value) {
    availableCrossSells.value = [];
    return;
  }

  loadingProducts.value = true;
  const result = await planStore.listAvailableCrossSell({
    pricing_mode: 'proportional',
  });

  availableCrossSells.value = result || [];
  loadingProducts.value = false;
};

const loadMethodPayments = async () => {
  const methods = await planStore.getMethodPayments();
  enabledPaymentMethods.value = methods;
};

const loadUserCards = async () => {
  if (!isCreditCardEnabled.value) {
    userCards.value = [];
    selectedCardId.value = null;
    return;
  }

  loadingCards.value = true;
  const cards = await planStore.listUserCards();
  userCards.value = cards || [];

  const defaultCard = userCards.value.find((card) => card.default);
  if (defaultCard) {
    selectedCardId.value = defaultCard.user_card_id;
  } else {
    selectedCardId.value = userCards.value[0]?.user_card_id || null;
  }

  loadingCards.value = false;
};

const loadCreditCardFee = async () => {
  const fee = await planStore.getCreditCardFee();
  creditCardFee.value = fee;
};

const setDefaultPaymentMethod = () => {
  if (
    selectedPaymentMethod.value &&
    isPaymentMethodEnabled(selectedPaymentMethod.value)
  ) {
    return;
  }

  const ordered: Array<'pix' | 'boleto' | 'credit_card'> = [
    'pix',
    'boleto',
    'credit_card',
  ];

  selectedPaymentMethod.value =
    ordered.find((method) => isPaymentMethodEnabled(method)) || null;
};

const buildPaymentData = (): CreateOrderPaymentRequest | null => {
  if (!currentPlanInvoice.value?.plan_id || !selectedPaymentMethod.value) {
    return null;
  }

  const addons = addonCartItems.value.flatMap((item) =>
    Array.from({ length: item.purchase_count }, () => ({
      plan_cross_sell_id: item.plan_cross_sell_id,
    }))
  );

  if (addons.length === 0) {
    return null;
  }

  const isCreditCard = selectedPaymentMethod.value === 'credit_card';

  return {
    order_type: 'addon',
    plan_id: currentPlanInvoice.value.plan_id,
    billing_period: currentBillingPeriod.value,
    addons,
    payment_method: selectedPaymentMethod.value,
    credit_card_id:
      isCreditCard && !useNewCard.value && selectedCardId.value
        ? selectedCardId.value
        : undefined,
    new_card:
      isCreditCard && useNewCard.value && newCard.value.number
        ? {
            number: newCard.value.number.replaceAll(/\s/g, ''),
            holder_name: newCard.value.holderName,
            expiry_month: newCard.value.expiryMonth,
            expiry_year: newCard.value.expiryYear,
            cvv: newCard.value.cvv,
          }
        : undefined,
    installments:
      isCreditCard && currentBillingPeriod.value === 'annual'
        ? installments.value
        : undefined,
  };
};

const getPixQrCodeImageSrc = (qrCode: string): string => {
  if (!qrCode) return '';
  if (qrCode.startsWith('data:image')) {
    return qrCode;
  }

  return `data:image/png;base64,${qrCode}`;
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

const paymentCompleted = computed(() => {
  if (paymentConfirmed.value) {
    return true;
  }

  return (
    paymentStatus.value === 'RECEIVED' || paymentStatus.value === 'CONFIRMED'
  );
});

const paymentStatusAlert = computed(() => {
  if (paymentCompleted.value) {
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
  if (!user?.account_id || !paymentId.value) {
    return;
  }

  try {
    const channel = paymentAccountCentrifugo(user.account_id);
    const sub = await onMessage(channel, (data: any) => {
      if (data?.payment_id !== paymentId.value) {
        return;
      }

      paymentStatus.value = data.status || null;

      if (data.is_confirmed) {
        paymentConfirmed.value = true;
        setTimeout(() => {
          paymentDialogOpen.value = false;
          router.push({ name: 'account-settings', query: { tab: 'plans' } });
        }, 3000);
      }
    });

    paymentSubscription.value = sub;
  } catch {
    // noop
  }
};

const cleanupPaymentSubscription = async () => {
  if (!paymentSubscription.value) {
    return;
  }

  const user = getUser();
  if (!user?.account_id) {
    paymentSubscription.value = null;
    return;
  }

  const channel = paymentAccountCentrifugo(user.account_id);
  await unsubscribe(channel);
  paymentSubscription.value = null;
};

const openPaymentDialog = async () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  await nextTick();
  paymentDialogOpen.value = true;
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

  boletoPaymentData.value = null;
  paymentId.value = pixData.payment_id;
  paymentStatus.value = 'PENDING';
  paymentConfirmed.value = false;

  await openPaymentDialog();
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

  pixPaymentData.value = null;
  paymentId.value = boletoData.payment_id;
  paymentStatus.value = 'PENDING';
  paymentConfirmed.value = false;

  await openPaymentDialog();
};

const processCreditCardPayment = async (creditCardData: {
  payment_id: string;
  status: string;
  is_confirmed: boolean;
}) => {
  pixPaymentData.value = null;
  boletoPaymentData.value = null;
  paymentId.value = creditCardData.payment_id;
  paymentStatus.value =
    (creditCardData.status as
      | 'PENDING'
      | 'RECEIVED'
      | 'CONFIRMED'
      | 'OVERDUE'
      | 'REFUNDED') || 'PENDING';

  paymentConfirmed.value = creditCardData.is_confirmed;

  await openPaymentDialog();
};

const processPayment = async () => {
  if (processingPayment.value || !canProcessPayment.value) {
    return;
  }

  const paymentData = buildPaymentData();
  if (!paymentData) {
    planStore.showSnackbar(t('order_payment_creation_failed'), EColor.error);
    return;
  }

  processingPayment.value = true;

  try {
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

    planStore.showSnackbar(t('payment_process_error'), EColor.error);
  } finally {
    processingPayment.value = false;
  }
};

const copyPixCode = async () => {
  if (!pixPaymentData.value?.payload) return;

  await navigator.clipboard.writeText(pixPaymentData.value.payload);
  planStore.showSnackbar(t('pix_code_copied'), EColor.success);
};

const copyBoletoCode = async () => {
  if (!boletoPaymentData.value?.identification_field) return;

  await navigator.clipboard.writeText(
    boletoPaymentData.value.identification_field
  );
  planStore.showSnackbar(t('boleto_code_copied'), EColor.success);
};

const copyBoletoPixPayload = async () => {
  if (!boletoPaymentData.value?.payload) return;

  await navigator.clipboard.writeText(boletoPaymentData.value.payload);
  planStore.showSnackbar(t('pix_code_copied'), EColor.success);
};

const downloadBoleto = () => {
  if (!boletoPaymentData.value?.bank_slip_url) return;

  window.open(boletoPaymentData.value.bank_slip_url, '_blank');
};

const closePaymentDialog = async () => {
  const shouldRedirect = paymentCompleted.value;

  await cleanupPaymentSubscription();
  paymentDialogOpen.value = false;

  if (shouldRedirect) {
    router.push({ name: 'account-settings', query: { tab: 'plans' } });
  }
};

watch(groupedCrossSells, (groups) => {
  for (const group of groups) {
    if (
      !selectedCrossSellByType.value[group.product_id] &&
      group.options.length > 0
    ) {
      selectedCrossSellByType.value[group.product_id] =
        group.options[0].plan_cross_sell_id;
    }

    if (!selectedQuantityByType.value[group.product_id]) {
      selectedQuantityByType.value[group.product_id] = 1;
    }
  }
});

watch(selectedPaymentMethod, (method) => {
  if (!method || method !== 'credit_card') {
    useNewCard.value = false;
    return;
  }

  if (userCards.value.length === 0) {
    useNewCard.value = true;
  }

  if (currentBillingPeriod.value !== 'annual') {
    installments.value = 1;
  }
});

watch(useNewCard, (value) => {
  if (!value) {
    resetNewCardForm();
  }
});

watch(paymentDialogOpen, async (isOpen) => {
  if (isOpen) {
    return;
  }

  await cleanupPaymentSubscription();
  paymentStatus.value = null;
  paymentConfirmed.value = false;
});

onBeforeUnmount(async () => {
  await cleanupPaymentSubscription();
});

onMounted(async () => {
  if (!can(checkoutPermissions)) {
    router.replace({ name: 'not-authorized' });
    return;
  }

  loadingInitial.value = true;

  await Promise.all([loadCurrentPlan(), loadMethodPayments()]);
  setDefaultPaymentMethod();

  if (hasActivePlan.value) {
    await Promise.all([
      loadAvailableAddons(),
      loadCreditCardFee(),
      loadUserCards(),
    ]);
  }

  loadingInitial.value = false;
});
</script>

<template>
  <VCard :title="$t('buy_additional')" no-padding>
    <VCardText>
      <div v-if="loadingInitial">
        <VRow>
          <VCol cols="12" md="8">
            <VSkeletonLoader type="heading, text" class="mb-4" />
            <VSkeletonLoader
              v-for="n in 3"
              :key="n"
              type="article"
              class="mb-3"
            />
          </VCol>
          <VCol cols="12" md="4">
            <VSkeletonLoader type="article" />
          </VCol>
        </VRow>
      </div>

      <div v-else-if="!hasActivePlan">
        <VAlert type="warning" variant="tonal" class="mb-4">
          {{ $t('addon_order_requires_active_plan') }}
        </VAlert>

        <VBtn color="primary" @click="router.push({ name: 'plans' })">
          {{ $t('plans_pricing') }}
        </VBtn>
      </div>

      <div v-else>
        <VAlert type="info" variant="tonal" class="mb-6">
          <div class="d-flex flex-column gap-1">
            <span class="font-weight-medium">
              {{ $t('selected_plan') }}
              <span class="text-medium-emphasis">
                ({{
                  currentBillingPeriod === 'annual'
                    ? $t('annual')
                    : $t('monthly')
                }})
              </span>
            </span>
            <span class="text-body-2 text-medium-emphasis">
              {{
                $t('remaining_days_for_addon_pricing', {
                  days: daysRemaining,
                })
              }}
            </span>
          </div>
        </VAlert>

        <VRow>
          <VCol cols="12" md="8">
            <h4 class="text-h6 mb-4">{{ $t('addons') }}</h4>

            <div v-if="loadingProducts" class="d-flex flex-column gap-3">
              <VSkeletonLoader v-for="n in 3" :key="n" type="article" />
            </div>

            <VCard
              v-else-if="groupedCrossSells.length === 0"
              variant="outlined"
              class="pa-6 text-center"
            >
              <span class="text-body-2 text-medium-emphasis">
                {{ $t('no_addons_available') }}
              </span>
            </VCard>

            <div v-else class="d-flex flex-column gap-3">
              <VCard
                v-for="group in groupedCrossSells"
                :key="group.product_id"
                variant="outlined"
              >
                <VCardText>
                  <div class="d-flex flex-column gap-4">
                    <div>
                      <div class="text-h6 mb-1">{{ group.product_name }}</div>
                      <p
                        v-if="group.product_description"
                        class="text-body-2 text-medium-emphasis mb-0"
                      >
                        {{ group.product_description }}
                      </p>
                    </div>

                    <div class="d-flex flex-wrap gap-3 align-center">
                      <VSelect
                        v-model="selectedCrossSellByType[group.product_id]"
                        :items="
                          group.options.map((option) => ({
                            title: getCrossSellLabel(option),
                            value: option.plan_cross_sell_id,
                          }))
                        "
                        item-title="title"
                        item-value="value"
                        :label="`${$t('select')} ${group.product_name}`"
                        density="compact"
                        variant="outlined"
                        class="addon-select"
                      />

                      <VTextField
                        :model-value="
                          getSelectedQuantityForProduct(group.product_id)
                        "
                        type="number"
                        min="1"
                        :max="
                          isSelectedOptionSingleUse(group.product_id)
                            ? 1
                            : undefined
                        "
                        :disabled="isSelectedOptionSingleUse(group.product_id)"
                        density="compact"
                        variant="outlined"
                        class="addon-quantity"
                        :label="$t('quantity')"
                        @update:model-value="
                          updateSelectedQuantityForProduct(
                            group.product_id,
                            Number($event)
                          )
                        "
                      />

                      <VBtn
                        color="primary"
                        variant="outlined"
                        @click="addAddon(group.product_id)"
                      >
                        {{ $t('add') }}
                      </VBtn>
                    </div>

                    <div
                      v-if="getSelectedOptionForProduct(group.product_id)"
                      class="d-flex flex-wrap gap-2"
                    >
                      <VChip color="default" variant="tonal" size="small">
                        {{ $t('full_cycle_price') }}:
                        {{
                          formatCurrency(
                            getCrossSellCyclePrice(
                              getSelectedOptionForProduct(group.product_id)!
                            )
                          )
                        }}
                      </VChip>
                      <VChip color="primary" variant="tonal" size="small">
                        {{ $t('proportional_price') }}:
                        {{
                          formatCurrency(
                            getCrossSellProportionalPrice(
                              getSelectedOptionForProduct(group.product_id)!
                            )
                          )
                        }}
                      </VChip>
                      <VChip color="success" variant="tonal" size="small">
                        {{
                          $t('selected_quantity', {
                            quantity: getCartCountForProduct(group.product_id),
                          })
                        }}
                      </VChip>
                    </div>
                  </div>
                </VCardText>
              </VCard>
            </div>
          </VCol>

          <VCol cols="12" md="4">
            <VCard variant="outlined" class="checkout-sticky-card">
              <VCardText>
                <h4 class="text-h6 mb-4">{{ $t('checkout') }}</h4>

                <div v-if="addonCartItems.length === 0" class="mb-4">
                  <span class="text-body-2 text-medium-emphasis">
                    {{ $t('no_addons_selected') }}
                  </span>
                </div>

                <div v-else class="d-flex flex-column gap-3 mb-4">
                  <VCard
                    v-for="item in addonCartItems"
                    :key="item.plan_cross_sell_id"
                    variant="tonal"
                    class="pa-3"
                  >
                    <div
                      class="d-flex justify-space-between align-center gap-2"
                    >
                      <div>
                        <div class="text-body-1 font-weight-medium">
                          {{ item.name }}
                        </div>
                        <div class="text-body-2 text-medium-emphasis">
                          {{ formatCurrency(item.price_proportional) }} x
                          {{ item.purchase_count }}
                        </div>
                      </div>
                      <div class="d-flex align-center gap-1">
                        <VBtn
                          icon
                          size="x-small"
                          variant="text"
                          @click="decreaseAddonLine(item)"
                        >
                          <VIcon icon="tabler-minus" size="16" />
                        </VBtn>
                        <VBtn
                          icon
                          size="x-small"
                          variant="text"
                          :disabled="item.is_single_use"
                          @click="increaseAddonLine(item)"
                        >
                          <VIcon icon="tabler-plus" size="16" />
                        </VBtn>
                        <VBtn
                          icon
                          size="x-small"
                          variant="text"
                          color="error"
                          @click="removeAddonLine(item)"
                        >
                          <VIcon icon="tabler-trash" size="16" />
                        </VBtn>
                      </div>
                    </div>
                  </VCard>
                </div>

                <VDivider class="my-4" />

                <h5 class="text-subtitle-1 mb-3">{{ $t('payment_method') }}</h5>

                <VRadioGroup
                  v-model="selectedPaymentMethod"
                  inline
                  class="mb-3"
                >
                  <VRadio
                    v-if="isPaymentMethodEnabled(EMethodPayment.pix)"
                    :label="$t('pix')"
                    :value="EMethodPayment.pix"
                  />
                  <VRadio
                    v-if="isPaymentMethodEnabled(EMethodPayment.boleto)"
                    :label="$t('boleto')"
                    :value="EMethodPayment.boleto"
                  />
                  <VRadio
                    v-if="isPaymentMethodEnabled(EMethodPayment.credit_card)"
                    :label="$t('credit_card')"
                    :value="EMethodPayment.credit_card"
                  />
                </VRadioGroup>

                <div
                  v-if="selectedPaymentMethod === 'credit_card'"
                  class="mb-4"
                >
                  <div class="d-flex align-center justify-space-between mb-2">
                    <span class="text-body-2">{{ $t('credit_card') }}</span>
                    <VBtn
                      variant="text"
                      size="small"
                      @click="useNewCard = !useNewCard"
                    >
                      {{
                        useNewCard ? $t('use_saved_card') : $t('add_new_card')
                      }}
                    </VBtn>
                  </div>

                  <div v-if="loadingCards" class="mb-3">
                    <VProgressCircular
                      indeterminate
                      size="22"
                      color="primary"
                    />
                  </div>

                  <template v-else-if="!useNewCard">
                    <VSelect
                      v-model="selectedCardId"
                      :items="cardSelectItems"
                      item-title="title"
                      item-value="value"
                      :label="$t('select_credit_card')"
                      density="compact"
                      variant="outlined"
                    >
                      <template #selection="{ item }">
                        <div class="d-flex align-center gap-2">
                          <img
                            v-if="item.brand && getBrandLogoUrl(item.brand)"
                            :src="getBrandLogoUrl(item.brand) || ''"
                            :alt="item.brand"
                            class="brand-logo"
                          />
                          <span>{{ item.title }}</span>
                        </div>
                      </template>
                    </VSelect>
                  </template>

                  <template v-else>
                    <VRow>
                      <VCol cols="12">
                        <VLabel class="text-body-2 mb-1">
                          {{ $t('card_number') }}:
                        </VLabel>
                        <VTextField
                          v-model="newCard.number"
                          placeholder="0000 0000 0000 0000"
                          :maxlength="19"
                          autocomplete="cc-number"
                          inputmode="numeric"
                          @input="onCardNumberInput"
                        >
                          <template #append-inner>
                            <img
                              v-if="
                                detectedBrand && getBrandLogoUrl(detectedBrand)
                              "
                              :src="getBrandLogoUrl(detectedBrand) || ''"
                              :alt="detectedBrand"
                              class="brand-logo"
                            />
                          </template>
                        </VTextField>
                      </VCol>
                      <VCol cols="12">
                        <VLabel class="text-body-2 mb-1">
                          {{ $t('cardholder_name') }}:
                        </VLabel>
                        <VTextField
                          v-model="newCard.holderName"
                          :placeholder="$t('cardholder_name')"
                          autocomplete="cc-name"
                        />
                      </VCol>
                      <VCol cols="6">
                        <VLabel class="text-body-2 mb-1">
                          {{ $t('expiry_date') }}:
                        </VLabel>
                        <VTextField
                          :model-value="
                            newCard.expiryMonth && newCard.expiryYear
                              ? `${newCard.expiryMonth}/${newCard.expiryYear}`
                              : ''
                          "
                          placeholder="MM/AA"
                          :maxlength="5"
                          autocomplete="cc-exp"
                          inputmode="numeric"
                          :error="!!expiryError"
                          :error-messages="expiryError"
                          @input="onExpiryInput"
                        />
                      </VCol>
                      <VCol cols="6">
                        <VLabel class="text-body-2 mb-1">
                          {{ $t('cvv') }}:
                        </VLabel>
                        <VTextField
                          v-model="newCard.cvv"
                          placeholder="000"
                          :maxlength="4"
                          :type="showCvv ? 'text' : 'password'"
                          autocomplete="cc-csc"
                          inputmode="numeric"
                        >
                          <template #append-inner>
                            <VIcon
                              :icon="showCvv ? 'tabler-eye-off' : 'tabler-eye'"
                              @click="showCvv = !showCvv"
                            />
                          </template>
                        </VTextField>
                      </VCol>
                    </VRow>
                  </template>

                  <VSelect
                    v-if="currentBillingPeriod === 'annual'"
                    v-model="installments"
                    :items="installmentOptions"
                    item-title="title"
                    item-value="value"
                    :label="$t('installments')"
                    density="compact"
                    variant="outlined"
                    class="mt-3"
                  />
                </div>

                <VDivider class="my-4" />

                <div class="d-flex justify-space-between align-center mb-2">
                  <span class="text-body-2">{{ $t('addons') }}</span>
                  <span class="text-body-1 font-weight-medium">
                    {{ formatCurrency(addonsSubtotal) }}
                  </span>
                </div>

                <div
                  v-if="creditCardFeeAmount > 0"
                  class="d-flex justify-space-between align-center mb-2"
                >
                  <span class="text-body-2">{{ $t('credit_card_fee') }}</span>
                  <span class="text-body-1 font-weight-medium">
                    {{ formatCurrency(creditCardFeeAmount) }}
                  </span>
                </div>

                <div class="d-flex justify-space-between align-center mb-4">
                  <span class="text-h6">{{ $t('total') }}</span>
                  <span class="text-h5 font-weight-bold text-primary">
                    {{ formatCurrency(checkoutTotal) }}
                  </span>
                </div>

                <VBtn
                  block
                  color="primary"
                  :disabled="!canProcessPayment"
                  :loading="processingPayment"
                  @click="processPayment"
                >
                  {{ $t('buy') }}
                </VBtn>
              </VCardText>
            </VCard>
          </VCol>
        </VRow>
      </div>
    </VCardText>
  </VCard>

  <VDialog v-model="paymentDialogOpen" max-width="720" persistent>
    <DialogCloseBtn @click="closePaymentDialog" />
    <VCard>
      <VCardTitle>
        <span>{{ $t('payment_status') }}</span>
      </VCardTitle>
      <VDivider />
      <VCardText>
        <VAlert
          :type="paymentStatusAlert.type"
          variant="tonal"
          class="mb-4"
          :icon="paymentStatusAlert.icon"
        >
          {{ paymentStatusAlert.message }}
        </VAlert>

        <div
          v-if="selectedPaymentMethod === 'pix' && pixPaymentData"
          class="d-flex flex-column gap-4"
        >
          <div class="d-flex justify-center align-center">
            <img
              :src="getPixQrCodeImageSrc(pixPaymentData.qr_code)"
              alt="PIX QR Code"
              class="pix-qr-code"
            />
          </div>

          <VTextField
            :model-value="pixPaymentData.payload || ''"
            readonly
            :label="$t('pix_copy_paste_code')"
            variant="outlined"
            density="compact"
            class="w-100"
            append-icon="tabler-copy"
            @click:append="copyPixCode"
          />

          <div class="text-caption text-medium-emphasis text-center">
            {{ $t('expires_at') }}:
            {{ formatDate(pixPaymentData.expiration_date) }}
          </div>
        </div>

        <div
          v-if="selectedPaymentMethod === 'boleto' && boletoPaymentData"
          class="d-flex flex-column gap-3"
        >
          <div
            v-if="boletoPaymentData.qr_code"
            class="d-flex justify-center align-center pa-4 bg-grey-lighten-4 rounded"
          >
            <img
              :src="getPixQrCodeImageSrc(boletoPaymentData.qr_code)"
              alt="QR Code PIX"
              class="pix-qr-code"
            />
          </div>

          <VTextField
            :model-value="boletoPaymentData.identification_field"
            readonly
            :label="$t('boleto_line')"
            append-icon="tabler-copy"
            @click:append="copyBoletoCode"
          />

          <VTextField
            v-if="boletoPaymentData.payload"
            :model-value="boletoPaymentData.payload"
            readonly
            :label="$t('pix_copy_paste_code')"
            append-icon="tabler-copy"
            @click:append="copyBoletoPixPayload"
          />

          <div class="text-caption text-medium-emphasis">
            {{ $t('due_date') }}: {{ formatDate(boletoPaymentData.due_date) }}
          </div>

          <VBtn color="primary" variant="outlined" @click="downloadBoleto">
            {{ $t('download_boleto') }}
          </VBtn>
        </div>

        <div
          v-if="selectedPaymentMethod === 'credit_card'"
          class="d-flex flex-column gap-2"
        >
          <span class="text-body-1">
            {{ $t('payment_status') }}:
            <strong :class="`text-${getPaymentStatusColor(paymentStatus)}`">
              {{ getPaymentStatusText(paymentStatus) }}
            </strong>
          </span>
        </div>
      </VCardText>
      <VDivider />
      <VCardActions class="justify-end pa-4">
        <VBtn variant="tonal" color="secondary" @click="closePaymentDialog">
          {{ $t('close') }}
        </VBtn>
      </VCardActions>
    </VCard>
  </VDialog>

  <VSnackbar
    v-model="planStore.snackbar.status"
    transition="scroll-y-reverse-transition"
    location="top end"
    :color="planStore.snackbar.color"
  >
    {{ planStore.snackbar.message }}
  </VSnackbar>
</template>

<style scoped>
.addon-select {
  min-width: 260px;
  flex: 1;
}

.addon-quantity {
  max-width: 120px;
}

.checkout-sticky-card {
  position: sticky;
  top: 88px;
}

.brand-logo {
  width: 34px;
  height: 20px;
  object-fit: contain;
}

.pix-qr-code {
  width: 220px;
  max-width: 100%;
  height: auto;
}

@media (max-width: 959px) {
  .checkout-sticky-card {
    position: static;
  }
}
</style>
