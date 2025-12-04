<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EPlanPermissions } from '@core/common/enums/EPermissions/plan';
import { usePlanStore } from '@/@webcore/stores/plan';
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
const planStore = usePlanStore();
useSnackbarCleanup(planStore);

const plans = ref<ListPlanWithItemsResponse[]>([]);
const loading = ref(false);
const billingPeriod = ref<'monthly' | 'annual'>('monthly');
const selectedPlanId = ref<string | null>(null);

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
  const result = await planStore.listPlanWithItems();
  if (result) {
    plans.value = result;

    if (result.length > 1) {
      selectedPlanId.value = result[1].plan_id;
    }
  }
  loading.value = false;
};

const selectPlan = (planId: string) => {
  selectedPlanId.value = planId;
};

const isPlanSelected = (planId: string): boolean => {
  return selectedPlanId.value === planId;
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

        <VRow v-else-if="plans.length > 0" class="plans-row">
          <VCol
            v-for="(plan, index) in plans"
            :key="plan.plan_id"
            cols="12"
            sm="6"
            md="3"
            class="plan-col"
          >
            <VCard
              :class="[
                'plan-card',
                isPlanSelected(plan.plan_id) ? 'plan-card-popular' : '',
              ]"
              :variant="isPlanSelected(plan.plan_id) ? 'elevated' : 'outlined'"
              :elevation="isPlanSelected(plan.plan_id) ? 4 : 0"
              @click="selectPlan(plan.plan_id)"
              style="cursor: pointer"
            >
              <VCardText class="position-relative">
                <div class="text-center mb-4">
                  <VAvatar
                    :color="
                      index === 0 ? 'pink' : index === 1 ? 'blue' : 'primary'
                    "
                    size="80"
                    variant="tonal"
                    class="mb-4"
                  >
                    <VIcon :icon="plan.icon || 'tabler-rocket'" size="40" />
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
                  :color="isPlanSelected(plan.plan_id) ? 'primary' : 'default'"
                  :variant="isPlanSelected(plan.plan_id) ? 'flat' : 'outlined'"
                  @click.stop="selectPlan(plan.plan_id)"
                >
                  {{ $t('select_plan') }}
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
}

.plan-col {
  margin-bottom: 24px;
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
</style>
