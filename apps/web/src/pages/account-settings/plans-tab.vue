<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAccountSettingsStore } from '@/@webcore/stores/accountSettings';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { ViewCurrentPlanInvoiceResponse } from '@core/schema/accountSettings/viewCurrentPlanInvoice/response.schema';
import { ListUserCardResponse } from '@core/schema/plan/listUserCards/response.schema';
import { ListAccountPlanProductsResponse } from '@core/schema/accountSettings/listAccountPlanProducts/response.schema';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
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

const { t, locale } = useI18n();
const router = useRouter();
const accountSettingsStore = useAccountSettingsStore();
useSnackbarCleanup(accountSettingsStore);

const loading = ref(false);
const planInvoice = ref<ViewCurrentPlanInvoiceResponse | null>(null);
const cardsLoading = ref(false);
const planProductsLoading = ref(false);
const userCards = ref<ListUserCardResponse[]>([]);
const accountPlanProducts = ref<ListAccountPlanProductsResponse[]>([]);
const cardToDelete = ref<string | null>(null);
const isDeleteDialogOpen = ref(false);
const showAddCardModal = ref(false);
const newCard = ref({
  number: '',
  holderName: '',
  expiryMonth: '',
  expiryYear: '',
  cvv: '',
});
const detectedBrand = ref<string | null>(null);
const expiryError = ref<string | null>(null);
const showCvv = ref(false);
const isAddingCard = ref(false);

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
  if (!dateString) return '';
  const date = new Date(dateString);

  let dateLocale = 'en-US';
  if (locale.value === 'pt') {
    dateLocale = 'pt-BR';
  }
  if (locale.value === 'es') {
    dateLocale = 'es-ES';
  }

  return new Intl.DateTimeFormat(dateLocale, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
};

const getPrice = computed(() => {
  if (!planInvoice.value) return 0;

  return (
    planInvoice.value.plan_account_value || planInvoice.value.plan_price || 0
  );
});

const getTotalDays = computed(() => {
  if (
    !planInvoice.value?.next_payment_date ||
    !planInvoice.value?.last_payment_date
  ) {
    return 30;
  }

  const lastDate = new Date(planInvoice.value.last_payment_date);
  const nextDate = new Date(planInvoice.value.next_payment_date);
  const diffTime = nextDate.getTime() - lastDate.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays || 30;
});

const getRemainingDays = computed(() => {
  if (!planInvoice.value?.next_payment_date) {
    return 0;
  }

  const nextDate = new Date(planInvoice.value.next_payment_date);
  const now = new Date();
  const diffTime = nextDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return Math.max(diffDays, 0);
});

const getElapsedDays = computed(() => {
  if (!planInvoice.value?.last_payment_date) {
    return 0;
  }

  const lastDate = new Date(planInvoice.value.last_payment_date);
  const now = new Date();
  const diffTime = now.getTime() - lastDate.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return Math.max(diffDays, 0);
});

const getProgressPercentage = computed(() => {
  if (
    !planInvoice.value?.next_payment_date ||
    !planInvoice.value?.last_payment_date
  ) {
    return 100;
  }

  const total = getTotalDays.value;
  const elapsed = getElapsedDays.value;

  if (total === 0) return 100;

  return Math.min(Math.max((elapsed / total) * 100, 0), 100);
});

const getAlertStatus = computed(() => {
  if (planInvoice.value?.cancellation_date) {
    const nextPaymentDateStr = planInvoice.value.next_payment_date;
    if (nextPaymentDateStr) {
      const nextPaymentDate = new Date(nextPaymentDateStr);
      const now = new Date();
      if (nextPaymentDate > now) {
        return 'warning';
      }
    }
    return 'error';
  }

  if (
    !planInvoice.value?.next_payment_date ||
    !planInvoice.value?.last_payment_date
  ) {
    return 'error';
  }

  const progress = getProgressPercentage.value;
  const remaining = getRemainingDays.value;

  if (progress >= 100 || remaining <= 0) {
    return 'error';
  }

  if (remaining <= 6) {
    return 'warning';
  }

  return 'success';
});

const getAlertMessage = computed(() => {
  if (planInvoice.value?.cancellation_date) {
    const nextPaymentDateStr = planInvoice.value.next_payment_date;
    if (nextPaymentDateStr) {
      const nextPaymentDate = new Date(nextPaymentDateStr);
      const now = new Date();
      if (nextPaymentDate > now) {
        return t('plan_cancelling_alert');
      }
    }
    return t('plan_cancelled_alert');
  }

  const status = getAlertStatus.value;

  if (status === 'error') {
    return t('plan_expired_alert');
  }

  if (status === 'warning') {
    return t('plan_update_attention');
  }

  return t('plan_active_ok');
});

const loadPlanInvoice = async () => {
  loading.value = true;
  const result = await accountSettingsStore.getCurrentPlanInvoice();
  if (result) {
    planInvoice.value = result;
  }
  loading.value = false;
};

const loadUserCards = async () => {
  cardsLoading.value = true;
  const result = await accountSettingsStore.listUserCards();
  if (result) {
    userCards.value = result;
  }
  cardsLoading.value = false;
};

const loadAccountPlanProducts = async () => {
  planProductsLoading.value = true;
  const result = await accountSettingsStore.listAccountPlanProducts();
  if (result) {
    accountPlanProducts.value = result;
  }
  planProductsLoading.value = false;
};

const deleteCard = (cardId: string) => {
  cardToDelete.value = cardId;
  isDeleteDialogOpen.value = true;
};

const confirmDeleteCard = async () => {
  if (!cardToDelete.value) return;

  await accountSettingsStore.deleteUserCard(cardToDelete.value);
  isDeleteDialogOpen.value = false;
  cardToDelete.value = null;
  await loadUserCards();
};

const setCardAsDefault = async (cardId: string) => {
  await accountSettingsStore.updateUserCardDefault(cardId);
  await loadUserCards();
};

const toggleRecurringPayment = async (value: boolean | null) => {
  if (value === null) return;
  if (!planInvoice.value) return;

  const previousValue = planInvoice.value.recurring_payment;
  planInvoice.value.recurring_payment = value;

  const success = await accountSettingsStore.updatePlanRecurring(value);

  if (!success) {
    planInvoice.value.recurring_payment = previousValue;
  }
};

const canDeleteCard = (card: ListUserCardResponse): boolean => {
  if (!planInvoice.value) {
    return true;
  }

  const hasRecurringPayment = planInvoice.value.recurring_payment === true;

  if (hasRecurringPayment && userCards.value.length === 1) {
    return false;
  }

  return true;
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

const addCard = async () => {
  if (!isNewCardValid.value) return;

  isAddingCard.value = true;

  try {
    const result = await accountSettingsStore.createUserCard({
      number: newCard.value.number,
      holder_name: newCard.value.holderName,
      expiry_month: newCard.value.expiryMonth,
      expiry_year: newCard.value.expiryYear,
      cvv: newCard.value.cvv,
    });

    if (result) {
      showAddCardModal.value = false;
      resetNewCardForm();
      await loadUserCards();
    }
  } finally {
    isAddingCard.value = false;
  }
};

const getPlanProductProgressPercentage = (
  product: ListAccountPlanProductsResponse
) => {
  if (product.quantity_total === 0) return 0;
  return Math.min(
    Math.max((product.quantity_used / product.quantity_total) * 100, 0),
    100
  );
};

const getPlanProductPlanProgressPercentage = (
  product: ListAccountPlanProductsResponse
) => {
  if (product.quantity_total === 0) return 0;
  const planUsed = Math.min(product.quantity_used, product.quantity_plan);
  return Math.min(Math.max((planUsed / product.quantity_total) * 100, 0), 100);
};

const isWithin7Days = computed(() => {
  if (!planInvoice.value?.last_payment_date) return false;
  const lastPaymentDate = new Date(planInvoice.value.last_payment_date);
  const now = new Date();
  const daysDiff = Math.floor(
    (now.getTime() - lastPaymentDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  return daysDiff <= 7;
});

const planStatus = computed(() => {
  if (!planInvoice.value) return null;

  const accountStatusId = planInvoice.value.account_status_id;

  if (accountStatusId === EAccountStatus.inactive) {
    return { label: t('cancelling'), color: 'warning' };
  }

  const hasCancellationDate = !!planInvoice.value.cancellation_date;
  const nextPaymentDateStr = planInvoice.value.next_payment_date;

  if (!hasCancellationDate) {
    return { label: t('active'), color: 'success' };
  }

  if (nextPaymentDateStr) {
    const nextPaymentDate = new Date(nextPaymentDateStr);
    const now = new Date();
    if (nextPaymentDate > now) {
      return { label: t('cancelling'), color: 'warning' };
    }
  }

  return { label: t('cancelled'), color: 'error' };
});

const cancelButtonColor = computed(() => {
  if (isWithin7Days.value) return 'error';
  return 'default';
});

const isCancelButtonDisabled = computed(() => {
  if (!planInvoice.value) return true;

  const accountStatusId = planInvoice.value.account_status_id;
  if (accountStatusId === EAccountStatus.inactive) return true;

  const hasCancellationDate = !!planInvoice.value.cancellation_date;
  if (!hasCancellationDate) return false;

  const nextPaymentDateStr = planInvoice.value.next_payment_date;
  if (!nextPaymentDateStr) return true;

  const nextPaymentDate = new Date(nextPaymentDateStr);
  const now = new Date();
  const isCancelling = nextPaymentDate > now;

  return isCancelling;
});

const isCancelling = ref(false);

const cancelSubscription = async () => {
  if (isCancelling.value || isCancelButtonDisabled.value) return;

  try {
    isCancelling.value = true;
    const result = await accountSettingsStore.cancelPlanAccount();
    if (result) {
      await loadPlanInvoice();
    }
  } finally {
    isCancelling.value = false;
  }
};

const isPlanActive = computed(() => {
  if (!planInvoice.value) return false;

  const hasCancellationDate = !!planInvoice.value.cancellation_date;
  if (hasCancellationDate) {
    const nextPaymentDateStr = planInvoice.value.next_payment_date;
    if (nextPaymentDateStr) {
      const nextPaymentDate = new Date(nextPaymentDateStr);
      const now = new Date();
      return nextPaymentDate > now;
    }
    return false;
  }

  return true;
});

const renewPlan = () => {
  if (!planInvoice.value) return;

  if (isPlanActive.value) {
    const billingPeriod = planInvoice.value.billing_period || 'monthly';
    router.push({
      name: 'plans-checkout',
      query: {
        plan_id: planInvoice.value.plan_id,
        billing: billingPeriod,
      },
    });
  } else {
    router.push({ name: 'plans' });
  }
};

onMounted(() => {
  loadPlanInvoice();
  loadUserCards();
  loadAccountPlanProducts();
});
</script>

<template>
  <div>
    <VRow v-if="loading">
      <VCol cols="12" class="text-center">
        <VProgressCircular indeterminate color="primary" />
      </VCol>
    </VRow>

    <VRow v-else-if="planInvoice && planInvoice.plan_id" class="align-stretch">
      <VCol cols="12" md="6" class="d-flex">
        <VCard
          variant="elevated"
          class="account-settings-card d-flex flex-column w-100"
        >
          <VCardText class="d-flex flex-column flex-grow-1">
            <div class="d-flex align-center gap-4 mb-4">
              <VAvatar
                v-if="planInvoice.plan_icon"
                color="primary"
                size="60"
                variant="tonal"
              >
                <VIcon :icon="planInvoice.plan_icon" size="30" />
              </VAvatar>
              <div class="flex-grow-1">
                <div class="d-flex align-center gap-2 mb-1">
                  <h4 class="text-h6">{{ planInvoice.plan_name }}</h4>
                  <VChip
                    v-if="planStatus"
                    :color="planStatus.color"
                    size="small"
                    variant="tonal"
                  >
                    {{ planStatus.label }}
                  </VChip>
                </div>
                <p class="text-body-2 text-medium-emphasis">
                  {{ planInvoice.plan_description || $t('no_description') }}
                </p>
              </div>
            </div>

            <VDivider class="my-4" />

            <div class="mb-4">
              <div v-if="planInvoice.last_payment_date" class="mb-3">
                <div class="d-flex align-center justify-space-between mb-1">
                  <span class="text-body-2 text-medium-emphasis">
                    {{ $t('last_payment_date') }}
                  </span>
                  <span class="text-body-1 font-weight-medium">
                    {{ formatDate(planInvoice.last_payment_date) }}
                  </span>
                </div>
              </div>

              <div v-if="planInvoice.next_payment_date" class="mb-3">
                <div class="d-flex align-center justify-space-between mb-1">
                  <span class="text-body-2 text-medium-emphasis">
                    {{ $t('next_payment_date') }}
                  </span>
                  <span class="text-body-1 font-weight-medium">
                    {{ formatDate(planInvoice.next_payment_date) }}
                  </span>
                </div>
              </div>

              <div class="mb-3">
                <div class="d-flex align-center justify-space-between mb-1">
                  <span class="text-body-2 text-medium-emphasis">
                    {{ $t('recurring_payment') }}
                  </span>
                  <VSwitch
                    :model-value="planInvoice.recurring_payment ?? false"
                    :disabled="loading || cardsLoading"
                    color="primary"
                    @update:model-value="toggleRecurringPayment"
                    hide-details
                  />
                </div>
              </div>

              <div v-if="planInvoice.cancellation_date" class="mb-3">
                <div class="d-flex align-center justify-space-between mb-1">
                  <span class="text-body-2 text-medium-emphasis">
                    {{ $t('cancellation_date') }}
                  </span>
                  <span class="text-body-1 font-weight-medium text-error">
                    {{ formatDate(planInvoice.cancellation_date) }}
                  </span>
                </div>
              </div>
            </div>

            <VDivider class="my-4" />

            <div class="mb-4">
              <div class="d-flex align-center gap-2 mb-2">
                <span class="text-h4 font-weight-bold text-primary">
                  {{ formatCurrency(getPrice) }}
                </span>
                <VChip
                  v-if="planInvoice.billing_period"
                  :color="
                    planInvoice.billing_period === 'annual'
                      ? 'primary'
                      : 'default'
                  "
                  size="small"
                  variant="tonal"
                >
                  {{
                    planInvoice.billing_period === 'annual'
                      ? $t('annual')
                      : planInvoice.billing_period === 'monthly'
                        ? $t('monthly')
                        : planInvoice.billing_period
                  }}
                </VChip>
              </div>
            </div>

            <div class="d-flex gap-2">
              <VBtn color="primary" variant="flat" @click="renewPlan">
                {{ $t('upgrade_plan') }}
              </VBtn>
              <VBtn
                :color="cancelButtonColor"
                variant="outlined"
                :disabled="isCancelButtonDisabled || isCancelling"
                :loading="isCancelling"
                @click="cancelSubscription"
              >
                {{ $t('cancel_subscription') }}
              </VBtn>
            </div>

            <VDivider class="my-4" />

            <div class="mb-4">
              <div class="d-flex align-center justify-space-between mb-3">
                <span class="text-h6">{{ $t('cards') }}</span>
              </div>

              <VProgressCircular
                v-if="cardsLoading"
                indeterminate
                color="primary"
                size="24"
                class="mb-2"
              />

              <div
                v-else-if="userCards.length === 0"
                class="text-body-2 text-medium-emphasis mb-3"
              >
                {{ $t('no_cards_found') }}
              </div>

              <VBtn
                v-if="!cardsLoading"
                color="primary"
                variant="outlined"
                prepend-icon="tabler-plus"
                @click="showAddCardModal = true"
                class="mb-3"
              >
                {{ $t('add_new_card') }}
              </VBtn>

              <div v-if="userCards.length > 0" class="d-flex flex-column gap-2">
                <VCard
                  v-for="card in userCards"
                  :key="card.user_card_id"
                  variant="outlined"
                  class="pa-3"
                >
                  <div class="d-flex align-center justify-space-between">
                    <div class="d-flex align-center gap-3">
                      <VIcon
                        :icon="
                          card.brand === 'Visa'
                            ? 'tabler-brand-visa'
                            : card.brand === 'Mastercard'
                              ? 'tabler-brand-mastercard'
                              : 'tabler-credit-card'
                        "
                        size="24"
                      />
                      <div>
                        <div class="text-body-2 font-weight-medium">
                          **** {{ card.last_number }}
                        </div>
                        <div class="text-caption text-medium-emphasis">
                          {{ card.holder_name }}
                        </div>
                      </div>
                      <VChip
                        v-if="card.default"
                        color="primary"
                        size="small"
                        variant="tonal"
                      >
                        {{ $t('default') }}
                      </VChip>
                    </div>
                    <div class="d-flex align-center gap-1">
                      <VBtn
                        v-if="!card.default"
                        icon
                        variant="text"
                        size="small"
                        color="primary"
                        @click="setCardAsDefault(card.user_card_id)"
                      >
                        <VIcon icon="tabler-star" size="20" />
                        <VTooltip activator="parent" location="top">
                          {{ $t('set_as_default') }}
                        </VTooltip>
                      </VBtn>
                      <VBtn
                        icon
                        variant="text"
                        size="small"
                        color="error"
                        :disabled="!canDeleteCard(card)"
                        @click="deleteCard(card.user_card_id)"
                      >
                        <VIcon icon="tabler-trash" size="20" />
                        <VTooltip activator="parent" location="top">
                          {{
                            canDeleteCard(card)
                              ? $t('delete')
                              : $t('cannot_delete_last_card')
                          }}
                        </VTooltip>
                      </VBtn>
                    </div>
                  </div>
                </VCard>
              </div>
            </div>
          </VCardText>
        </VCard>
      </VCol>

      <VCol cols="12" md="6" class="d-flex">
        <VCard
          variant="elevated"
          class="account-settings-card d-flex flex-column w-100"
        >
          <VCardText class="d-flex flex-column flex-grow-1">
            <VAlert
              v-if="planInvoice && planInvoice.plan_id"
              :type="getAlertStatus"
              variant="tonal"
              class="mb-4"
            >
              <div class="d-flex flex-column">
                <span class="font-weight-medium mb-1">
                  <template v-if="planInvoice.cancellation_date">
                    <template v-if="getAlertStatus === 'warning'">
                      {{ $t('plan_cancelling_title') }}
                    </template>
                    <template v-else>
                      {{ $t('plan_cancelled_title') }}
                    </template>
                  </template>
                  <template v-else-if="getAlertStatus === 'error'">
                    {{ $t('plan_expired_title') }}
                  </template>
                  <template v-else-if="getAlertStatus === 'warning'">
                    {{ $t('plan_update_attention_title') }}
                  </template>
                  <template v-else>
                    {{ $t('plan_active_title') }}
                  </template>
                </span>
                <span>{{ getAlertMessage }}</span>
              </div>
            </VAlert>

            <div class="mb-4">
              <div class="d-flex align-center justify-space-between mb-2">
                <span class="text-body-1 font-weight-medium">
                  {{ $t('days') }}
                </span>
                <span class="text-body-1 font-weight-medium">
                  <template
                    v-if="
                      planInvoice.next_payment_date &&
                      planInvoice.last_payment_date
                    "
                  >
                    {{ getElapsedDays }} {{ $t('of') }} {{ getTotalDays }}
                    {{ $t('days') }}
                  </template>
                  <template v-else>
                    {{ $t('expired') }}
                  </template>
                </span>
              </div>
              <VProgressLinear
                :model-value="getProgressPercentage"
                :color="getProgressPercentage >= 100 ? 'error' : 'primary'"
                height="8"
                rounded
                class="mb-2"
              />
              <p class="text-body-2 text-medium-emphasis">
                <template v-if="planInvoice.next_payment_date">
                  {{
                    $t('days_remaining_until_update', {
                      days: getRemainingDays,
                    })
                  }}
                </template>
                <template v-else>
                  {{ $t('plan_expired') }}
                </template>
              </p>
            </div>

            <VDivider class="my-4" />

            <div class="mb-4">
              <div class="d-flex align-center justify-space-between mb-3">
                <span class="text-h6">{{ $t('plan_products') }}</span>
              </div>

              <VProgressCircular
                v-if="planProductsLoading"
                indeterminate
                color="primary"
                size="24"
                class="mb-2"
              />

              <div
                v-else-if="accountPlanProducts.length === 0"
                class="text-body-2 text-medium-emphasis"
              >
                {{ $t('no_plan_products_found') }}
              </div>

              <div v-else class="d-flex flex-column gap-3">
                <div
                  v-for="product in accountPlanProducts"
                  :key="product.plan_product_id"
                >
                  <div class="mb-2">
                    <div class="d-flex align-center justify-space-between mb-1">
                      <span class="text-body-1 font-weight-medium">
                        {{ product.name }}
                      </span>
                      <span class="text-body-2 text-medium-emphasis">
                        {{ product.quantity_used }} /
                        {{ product.quantity_total }}
                      </span>
                    </div>
                    <div
                      v-if="
                        product.quantity_plan > 0 || product.quantity_addon > 0
                      "
                      class="d-flex flex-column gap-1 text-caption text-disabled"
                    >
                      <span v-if="product.quantity_plan > 0">
                        {{ $t('plan_quantity') }}: {{ product.quantity_plan }}
                      </span>
                      <span v-if="product.quantity_addon > 0">
                        {{ $t('addon_quantity') }}: {{ product.quantity_addon }}
                      </span>
                    </div>
                  </div>
                  <div class="addon-progress-container mb-1">
                    <VProgressLinear
                      :model-value="getPlanProductProgressPercentage(product)"
                      color="secondary"
                      height="8"
                      rounded
                      class="addon-progress-base"
                    />
                    <VProgressLinear
                      v-if="
                        product.quantity_plan > 0 &&
                        product.quantity_addon > 0 &&
                        product.quantity_used > 0
                      "
                      :model-value="
                        getPlanProductPlanProgressPercentage(product)
                      "
                      color="primary"
                      height="8"
                      rounded
                      class="addon-progress-plan"
                    />
                  </div>
                </div>
              </div>
            </div>
          </VCardText>
        </VCard>
      </VCol>
    </VRow>

    <VRow v-else>
      <VCol cols="12" class="text-center mt-12">
        <VCard variant="elevated" class="account-settings-card pa-8">
          <VCardText>
            <p class="text-body-1 text-medium-emphasis mb-0">
              {{ $t('no_plan_found') }}
            </p>
          </VCardText>
        </VCard>
      </VCol>
    </VRow>

    <VSnackbar
      v-model="accountSettingsStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="accountSettingsStore.snackbar.color"
    >
      {{ accountSettingsStore.snackbar.message }}
    </VSnackbar>

    <VDialog v-model="isDeleteDialogOpen" max-width="400">
      <VCard>
        <VCardTitle>{{ $t('delete_card') }}</VCardTitle>
        <VCardText>
          {{ $t('delete_card_confirmation') }}
        </VCardText>
        <VCardActions>
          <VSpacer />
          <VBtn variant="text" @click="isDeleteDialogOpen = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn color="error" variant="flat" @click="confirmDeleteCard">
            {{ $t('delete') }}
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>

    <VDialog v-model="showAddCardModal" max-width="600" persistent>
      <VCard>
        <VCardTitle class="d-flex align-center justify-space-between">
          <span>{{ $t('add_new_card') }}</span>
          <VBtn
            icon
            variant="text"
            size="small"
            @click="
              showAddCardModal = false;
              resetNewCardForm();
            "
          >
            <VIcon icon="tabler-x" />
          </VBtn>
        </VCardTitle>
        <VCardText>
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
                      v-if="detectedBrand && getBrandLogoUrl(detectedBrand)"
                      class="brand-logo-small"
                      style="
                        width: 40px;
                        height: 24px;
                        display: flex;
                        align-items: center;
                      "
                    >
                      <img
                        :src="getBrandLogoUrl(detectedBrand) || ''"
                        :alt="detectedBrand || 'card brand'"
                        style="
                          max-width: 100%;
                          max-height: 100%;
                          object-fit: contain;
                        "
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
                <VLabel class="text-body-2 mb-1">{{ $t('cvv') }}:</VLabel>
                <VTextField
                  v-model="newCard.cvv"
                  placeholder="000"
                  :type="showCvv ? 'text' : 'password'"
                  :maxlength="4"
                >
                  <template #append-inner>
                    <VIcon
                      :icon="showCvv ? 'tabler-eye-off' : 'tabler-eye'"
                      @click="showCvv = !showCvv"
                      style="cursor: pointer"
                    />
                  </template>
                </VTextField>
              </VCol>
            </VRow>
          </VForm>
        </VCardText>
        <VCardActions>
          <VSpacer />
          <VBtn
            variant="text"
            @click="
              showAddCardModal = false;
              resetNewCardForm();
            "
          >
            {{ $t('cancel') }}
          </VBtn>
          <VBtn
            color="primary"
            variant="flat"
            :disabled="!isNewCardValid || isAddingCard"
            :loading="isAddingCard"
            @click="addCard"
          >
            {{ $t('add') }}
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>
  </div>
</template>

<style scoped>
.account-settings-card {
  background-color: rgb(var(--v-theme-surface)) !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1) !important;
  border-radius: 8px;
}

.addon-progress-container {
  position: relative;
  width: 100%;
}

.addon-progress-base {
  position: relative;
  z-index: 1;
}

.addon-progress-plan {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
  opacity: 0.8;
}
</style>
