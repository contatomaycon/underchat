<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EPlanPermissions } from '@core/common/enums/EPermissions/plan';
import { usePlanStore } from '@/@webcore/stores/plan';
import { useAccountSettingsStore } from '@/@webcore/stores/accountSettings';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { ListPlanWithItemsResponse } from '@core/schema/plan/listPlanWithItems/response.schema';

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
const accountSettingsStore = useAccountSettingsStore();
useSnackbarCleanup(planStore);

const plans = ref<ListPlanWithItemsResponse[]>([]);
const loading = ref(false);
const billingPeriod = ref<'monthly' | 'annual'>('monthly');
const selectedPlanId = ref<string | null>(null);
const currentPlanId = ref<string | null>(null);
const currentPlan = ref<ListPlanWithItemsResponse | null>(null);
const currentPlanBillingPeriod = ref<'monthly' | 'annual' | null>(null);
const currentPlanInvoice = ref<any | null>(null);

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

const loadPlans = async () => {
  loading.value = true;
  const [result, currentPlanIdValue, planInvoice] = await Promise.all([
    planStore.listPlanWithItems(),
    planStore.getCurrentPlan(),
    accountSettingsStore.getCurrentPlanInvoice(),
  ]);

  currentPlanInvoice.value = planInvoice;

  if (result) {
    plans.value = result;
    currentPlanId.value = currentPlanIdValue;

    if (currentPlanIdValue) {
      currentPlan.value =
        result.find((p) => p.plan_id === currentPlanIdValue) || null;
    } else {
      currentPlan.value = null;
    }

    if (planInvoice?.billing_period) {
      currentPlanBillingPeriod.value = planInvoice.billing_period as
        | 'monthly'
        | 'annual';

      const isActive = planInvoice.next_payment_date
        ? new Date(planInvoice.next_payment_date) > new Date()
        : false;

      if (currentPlanBillingPeriod.value === 'annual' && isActive) {
        billingPeriod.value = 'annual';
      }
    } else {
      currentPlanBillingPeriod.value = null;
    }

    if (result.length > 1) {
      selectedPlanId.value = result[1].plan_id;
    }
  }
  loading.value = false;
};

const isTestPlan = (plan: ListPlanWithItemsResponse): boolean => {
  return plan.is_test === true && (plan.days_trial ?? 0) > 0;
};

const filteredPlans = computed(() => {
  if (billingPeriod.value === 'annual') {
    return plans.value.filter((plan) => !isTestPlan(plan));
  }
  return plans.value;
});

const selectPlan = (planId: string) => {
  selectedPlanId.value = planId;
};

const isPlanActive = computed(() => {
  if (!currentPlanInvoice.value?.next_payment_date) {
    return false;
  }

  const nextPaymentDate = new Date(currentPlanInvoice.value.next_payment_date);
  const now = new Date();
  return nextPaymentDate > now;
});

const openCheckout = (plan: ListPlanWithItemsResponse) => {
  if (isPlanDisabled(plan)) return;

  router.push({
    name: 'plans-checkout',
    query: {
      plan_id: plan.plan_id,
      billing: billingPeriod.value,
    },
  });
};

const isPlanSelected = (planId: string): boolean => {
  if (selectedPlanId.value !== planId) return false;
  const plan = plans.value.find((p) => p.plan_id === planId);
  if (!plan) return false;
  return !isPlanDisabled(plan);
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

const isPlanDisabled = (plan: ListPlanWithItemsResponse): boolean => {
  return isDowngrade(plan) || isInvalidBillingPeriodChange(plan);
};

const getButtonText = (plan: ListPlanWithItemsResponse): string => {
  if (isCurrentPlan(plan.plan_id)) {
    return t('your_current_plan');
  }
  if (isTestPlan(plan)) {
    return t('test');
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

watch(billingPeriod, (newValue) => {
  if (
    currentPlanBillingPeriod.value === 'annual' &&
    isPlanActive.value &&
    newValue === 'monthly'
  ) {
    billingPeriod.value = 'annual';
  }
});

onMounted(() => {
  loadPlans();
});
</script>

<template>
  <div>
    <VCard :title="$t('pricing_plans')" no-padding>
      <VCardText>
        <div class="d-flex flex-column align-center mb-8">
          <h2 class="text-h4 mb-2">{{ $t('pricing_plans') }}</h2>
          <p class="text-body-1 text-medium-emphasis text-center">
            {{ $t('pricing_plans_subtitle') }}
          </p>

          <div class="d-flex align-center gap-4 mt-6">
            <span
              :class="[
                'text-body-1',
                billingPeriod === 'monthly' ? 'text-primary' : 'text-disabled',
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
              :disabled="currentPlanBillingPeriod === 'annual' && isPlanActive"
            />
            <span
              :class="[
                'text-body-1',
                billingPeriod === 'annual' ? 'text-primary' : 'text-disabled',
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

        <VRow v-if="loading">
          <VCol cols="12" class="text-center">
            <VProgressCircular indeterminate color="primary" />
          </VCol>
        </VRow>

        <VRow
          v-else-if="filteredPlans.length > 0"
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
                isCurrentPlan(plan.plan_id) ? 'plan-card-current' : '',
                isPlanSelected(plan.plan_id) && !isDowngrade(plan)
                  ? 'plan-card-popular'
                  : '',
                isDowngrade(plan) ? 'plan-card-disabled' : '',
              ]"
              :variant="
                isCurrentPlan(plan.plan_id)
                  ? 'elevated'
                  : isPlanSelected(plan.plan_id)
                    ? 'elevated'
                    : 'outlined'
              "
              :elevation="
                isCurrentPlan(plan.plan_id)
                  ? 4
                  : isPlanSelected(plan.plan_id)
                    ? 4
                    : 0
              "
              @click="!isPlanDisabled(plan) && openCheckout(plan)"
              :style="
                isPlanDisabled(plan) ? 'cursor: not-allowed' : 'cursor: pointer'
              "
            >
              <VCardText class="position-relative">
                <div v-if="isDowngrade(plan)" class="plan-disabled-overlay">
                  <VChip color="error" size="small" variant="tonal">
                    {{ $t('unavailable') }}
                  </VChip>
                </div>
                <div class="text-center mb-4">
                  <VAvatar
                    :color="
                      index === 0 ? 'pink' : index === 1 ? 'blue' : 'primary'
                    "
                    size="80"
                    variant="tonal"
                    class="mb-4"
                    :class="{ 'opacity-50': isDowngrade(plan) }"
                  >
                    <VIcon :icon="plan.icon || 'tabler-rocket'" size="40" />
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
                  <div class="d-flex align-center justify-center gap-2 mb-2">
                    <span class="text-h3 font-weight-bold text-primary">
                      {{ formatCurrency(getPrice(plan)) }}
                    </span>
                    <span class="text-body-2 text-medium-emphasis">
                      /{{
                        billingPeriod === 'annual' ? $t('year') : $t('month')
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
                        formatCurrency(getAnnualPriceWithoutDiscount(plan))
                      }}/{{ $t('year') }}
                    </s>
                  </div>
                  <div
                    v-if="billingPeriod === 'monthly' && plan.price === 0"
                    class="text-body-2 text-medium-emphasis"
                  >
                    {{ $t('free') }}
                  </div>
                  <div
                    v-if="
                      billingPeriod === 'monthly' && plan.price_old > plan.price
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
                      : isPlanSelected(plan.plan_id)
                        ? 'primary'
                        : 'default'
                  "
                  :variant="
                    isCurrentPlan(plan.plan_id)
                      ? 'flat'
                      : isPlanSelected(plan.plan_id)
                        ? 'flat'
                        : 'outlined'
                  "
                  :disabled="isPlanDisabled(plan)"
                  @click.stop="!isPlanDisabled(plan) && openCheckout(plan)"
                >
                  {{
                    isDowngrade(plan) ? $t('unavailable') : getButtonText(plan)
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
</style>
