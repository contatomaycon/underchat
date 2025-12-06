<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAccountSettingsStore } from '@/@webcore/stores/accountSettings';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { ViewCurrentPlanInvoiceResponse } from '@core/schema/accountSettings/viewCurrentPlanInvoice/response.schema';
import { ListUserCardResponse } from '@core/schema/plan/listUserCards/response.schema';
import { ListAccountAddonsResponse } from '@core/schema/accountSettings/listAccountAddons/response.schema';

const { t, locale } = useI18n();
const accountSettingsStore = useAccountSettingsStore();
useSnackbarCleanup(accountSettingsStore);

const loading = ref(false);
const planInvoice = ref<ViewCurrentPlanInvoiceResponse | null>(null);
const cardsLoading = ref(false);
const addonsLoading = ref(false);
const userCards = ref<ListUserCardResponse[]>([]);
const accountAddons = ref<ListAccountAddonsResponse[]>([]);
const cardToDelete = ref<string | null>(null);
const isDeleteDialogOpen = ref(false);

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

const getAnnualPrice = (): number => {
  if (!planInvoice.value?.plan_price) return 0;
  const annualPrice = planInvoice.value.plan_price * 12;
  if (planInvoice.value.annual_discount) {
    const discount = Number.parseFloat(planInvoice.value.annual_discount);
    return annualPrice * (1 - discount / 100);
  }
  return annualPrice;
};

const getPrice = computed(() => {
  if (!planInvoice.value) return 0;
  if (planInvoice.value.billing_period === 'annual') {
    return getAnnualPrice();
  }
  return planInvoice.value.plan_price || 0;
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

const loadAccountAddons = async () => {
  addonsLoading.value = true;
  const result = await accountSettingsStore.listAccountAddons();
  if (result) {
    accountAddons.value = result;
  }
  addonsLoading.value = false;
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

const getAddonProgressPercentage = (addon: ListAccountAddonsResponse) => {
  if (addon.quantity_total === 0) return 0;
  return Math.min(
    Math.max((addon.quantity_used / addon.quantity_total) * 100, 0),
    100
  );
};

const getPlanProgressPercentage = (addon: ListAccountAddonsResponse) => {
  if (addon.quantity_total === 0) return 0;
  const planUsed = Math.min(addon.quantity_used, addon.quantity_plan);
  return Math.min(Math.max((planUsed / addon.quantity_total) * 100, 0), 100);
};

onMounted(() => {
  loadPlanInvoice();
  loadUserCards();
  loadAccountAddons();
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
              <div>
                <h4 class="text-h6">{{ planInvoice.plan_name }}</h4>
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
                  <VChip
                    :color="
                      planInvoice.recurring_payment ? 'success' : 'default'
                    "
                    size="small"
                    variant="tonal"
                  >
                    {{ planInvoice.recurring_payment ? $t('yes') : $t('no') }}
                  </VChip>
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
                  v-if="planInvoice.billing_period === 'annual'"
                  color="primary"
                  size="small"
                  variant="tonal"
                >
                  {{ $t('annual') }}
                </VChip>
                <VChip v-else color="default" size="small" variant="tonal">
                  {{ $t('monthly') }}
                </VChip>
              </div>
            </div>

            <div class="d-flex gap-2">
              <VBtn color="primary" variant="flat">
                {{ $t('upgrade_plan') }}
              </VBtn>
              <VBtn color="default" variant="outlined">
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
                class="text-body-2 text-medium-emphasis"
              >
                {{ $t('no_cards_found') }}
              </div>

              <div v-else class="d-flex flex-column gap-2">
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
                    <VBtn
                      icon
                      variant="text"
                      size="small"
                      color="error"
                      @click="deleteCard(card.user_card_id)"
                    >
                      <VIcon icon="tabler-trash" size="20" />
                      <VTooltip activator="parent" location="top">
                        {{ $t('delete') }}
                      </VTooltip>
                    </VBtn>
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
                  <template v-if="getAlertStatus === 'error'">
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
                <span class="text-h6">{{ $t('addons') }}</span>
              </div>

              <VProgressCircular
                v-if="addonsLoading"
                indeterminate
                color="primary"
                size="24"
                class="mb-2"
              />

              <div
                v-else-if="accountAddons.length === 0"
                class="text-body-2 text-medium-emphasis"
              >
                {{ $t('no_addons_found') }}
              </div>

              <div v-else class="d-flex flex-column gap-3">
                <div
                  v-for="addon in accountAddons"
                  :key="addon.plan_cross_sell_id"
                >
                  <div class="d-flex align-center justify-space-between mb-2">
                    <span class="text-body-1 font-weight-medium">
                      {{ addon.name }}
                    </span>
                    <span class="text-body-2 text-medium-emphasis">
                      {{ addon.quantity_used }} / {{ addon.quantity_total }}
                    </span>
                  </div>
                  <div class="addon-progress-container mb-1">
                    <VProgressLinear
                      :model-value="getAddonProgressPercentage(addon)"
                      color="primary"
                      height="8"
                      rounded
                      class="addon-progress-base"
                    />
                    <VProgressLinear
                      v-if="addon.quantity_plan > 0 && addon.quantity_addon > 0"
                      :model-value="getPlanProgressPercentage(addon)"
                      color="secondary"
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
        <VCard
          variant="elevated"
          class="account-settings-card d-inline-block pa-8"
        >
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
