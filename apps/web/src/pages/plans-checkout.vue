<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EPlanPermissions } from '@core/common/enums/EPermissions/plan';
import { usePlanStore } from '@/@webcore/stores/plan';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { ListPlanWithItemsResponse } from '@core/schema/plan/listPlanWithItems/response.schema';
import { ListPlanProductWithPriceResponse } from '@core/schema/plan/listPlanProductWithPrice/response.schema';

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
useSnackbarCleanup(planStore);

const loading = ref(false);
const billingPeriod = ref<'monthly' | 'annual'>('monthly');
const selectedPlanForCheckout = ref<ListPlanWithItemsResponse | null>(null);
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

const loadCheckoutData = async () => {
  loading.value = true;
  const planId = route.query.plan_id as string;
  const billing = (route.query.billing as 'monthly' | 'annual') || 'monthly';

  if (!planId) {
    router.push({ name: 'plans' });
    return;
  }

  billingPeriod.value = billing;

  const plans = await planStore.listPlanWithItems();
  if (plans) {
    const plan = plans.find((p) => p.plan_id === planId);
    if (!plan) {
      router.push({ name: 'plans' });
      return;
    }
    selectedPlanForCheckout.value = plan;
  }

  loadingProducts.value = true;
  const products = await planStore.listPlanProductWithPrice();
  if (products) {
    availableProducts.value = products;
  }
  loadingProducts.value = false;

  loading.value = false;
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

const getAddonsTotal = computed(() => {
  return selectedAddons.value.reduce((total, addon) => {
    const addonPrice = addon.price || 0;
    const multiplier = billingPeriod.value === 'annual' ? 12 : 1;
    return total + addonPrice * addon.quantity * multiplier;
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

onMounted(() => {
  loadCheckoutData();
});
</script>

<template>
  <div>
    <VCard :title="$t('checkout')" no-padding>
      <VCardText>
        <div v-if="loading" class="text-center py-8">
          <VProgressCircular indeterminate color="primary" size="64" />
        </div>

        <div v-else-if="selectedPlanForCheckout">
          <div class="d-flex align-center gap-3 mb-4">
            <VBtn icon variant="text" @click="goBack">
              <VIcon>tabler-arrow-left</VIcon>
            </VBtn>
            <h3 class="text-h6 mb-0">{{ $t('checkout') }}</h3>
          </div>

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
                        :icon="selectedPlanForCheckout.icon || 'tabler-rocket'"
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
                  <div class="d-flex align-center justify-space-between">
                    <span class="text-body-1 font-weight-medium"
                      >{{ $t('price') }}:</span
                    >
                    <div class="text-right">
                      <div class="text-h5 font-weight-bold text-primary">
                        {{ formatCurrency(getPrice(selectedPlanForCheckout)) }}
                      </div>
                      <div class="text-body-2 text-medium-emphasis">
                        /{{
                          billingPeriod === 'annual' ? $t('year') : $t('month')
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
                  <VProgressCircular indeterminate color="primary" size="32" />
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
                    <div class="d-flex align-center justify-space-between">
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
                      </div>
                      <div class="d-flex align-center gap-3">
                        <div class="d-flex align-center gap-2">
                          <VBtn
                            icon
                            size="small"
                            variant="outlined"
                            :disabled="
                              getAddonQuantity(product.plan_product_id) === 0
                            "
                            @click="removeAddon(product.plan_product_id)"
                          >
                            <VIcon size="20">tabler-minus</VIcon>
                          </VBtn>
                          <span
                            class="text-body-1 font-weight-medium"
                            style="min-width: 24px; text-align: center"
                          >
                            {{ getAddonQuantity(product.plan_product_id) }}
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
              <div class="d-flex align-center justify-space-between mb-2">
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

          <div class="d-flex justify-end flex-wrap gap-3">
            <VBtn variant="tonal" color="secondary" @click="goBack">
              {{ $t('cancel') }}
            </VBtn>
            <VBtn color="primary" :disabled="!selectedPlanForCheckout">
              {{ $t('proceed_to_payment') }}
            </VBtn>
          </div>
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
