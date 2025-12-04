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

const { t } = useI18n();
const planStore = usePlanStore();
useSnackbarCleanup(planStore);

const plans = ref<ListPlanWithItemsResponse[]>([]);
const loading = ref(false);
const billingPeriod = ref<'monthly' | 'annual'>('annual');
const selectedPlanId = ref<string | null>(null);

const formatCurrency = (value: number | null | undefined): string => {
  if (!value) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
};

const getAnnualPrice = (monthlyPrice: number): number => {
  return monthlyPrice * 12;
};

const getPrice = (plan: ListPlanWithItemsResponse): number => {
  if (billingPeriod.value === 'annual') {
    return getAnnualPrice(plan.price);
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
            <VChip
              v-if="billingPeriod === 'annual'"
              color="primary"
              size="small"
              class="ms-2"
            >
              {{ $t('save_up_to') }} 10%
            </VChip>
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
                    <VIcon
                      :icon="
                        index === 0
                          ? 'tabler-piggy-bank'
                          : index === 1
                            ? 'tabler-safe'
                            : 'tabler-rocket'
                      "
                      size="40"
                    />
                  </VAvatar>
                  <h3 class="text-h5 mb-2">{{ plan.name }}</h3>
                  <p class="text-body-2 text-medium-emphasis mb-4">
                    {{
                      index === 0
                        ? $t('simple_start_for_everyone')
                        : index === 1
                          ? $t('for_small_to_medium_businesses')
                          : $t('solution_for_big_organizations')
                    }}
                  </p>
                </div>

                <div class="text-center mb-6">
                  <div class="d-flex align-center justify-center gap-2 mb-2">
                    <span class="text-h3 font-weight-bold text-primary">
                      {{ formatCurrency(getPrice(plan)) }}
                    </span>
                    <span class="text-body-2 text-medium-emphasis">
                      /{{ $t('month') }}
                    </span>
                  </div>
                  <div
                    v-if="billingPeriod === 'annual'"
                    class="text-body-2 text-medium-emphasis"
                  >
                    {{ formatCurrency(getAnnualPrice(plan.price)) }}/{{
                      $t('year')
                    }}
                  </div>
                  <div
                    v-else-if="plan.price === 0"
                    class="text-body-2 text-medium-emphasis"
                  >
                    {{ $t('free') }}
                  </div>
                  <div
                    v-else-if="plan.price_old > plan.price"
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
                      <span v-if="item.quantity > 1">
                        {{ item.quantity }}x
                      </span>
                      {{ item.plan_product?.name || $t('plan_item') }}
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
