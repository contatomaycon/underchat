<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EPlanPermissions } from '@core/common/enums/EPermissions/plan';
import { usePlanStore } from '@/@webcore/stores/plan';
import { useAccountStore } from '@/@webcore/stores/account';
import { useUsersStore } from '@/@webcore/stores/user';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { getUser } from '@/@webcore/localStorage/user';
import { ListPlanWithItemsResponse } from '@core/schema/plan/listPlanWithItems/response.schema';
import { ListPlanProductWithPriceResponse } from '@core/schema/plan/listPlanProductWithPrice/response.schema';
import { ViewUserResponse } from '@core/schema/user/viewUser/response.schema';

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
const accountStore = useAccountStore();
const usersStore = useUsersStore();
useSnackbarCleanup(planStore);

const currentStep = ref(1);
const loading = ref(false);
const billingPeriod = ref<'monthly' | 'annual'>('monthly');
const plans = ref<ListPlanWithItemsResponse[]>([]);
const selectedPlanForCheckout = ref<ListPlanWithItemsResponse | null>(null);
const currentPlanId = ref<string | null>(null);
const currentPlan = ref<ListPlanWithItemsResponse | null>(null);
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
const currentUser = ref<ViewUserResponse | null>(null);
const loadingUser = ref(false);

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

  billingPeriod.value = billing;

  const [plansList, currentPlanIdValue] = await Promise.all([
    planStore.listPlanWithItems(),
    accountStore.getCurrentPlan(),
  ]);

  if (plansList) {
    plans.value = plansList;
    currentPlanId.value = currentPlanIdValue;

    if (currentPlanIdValue) {
      currentPlan.value =
        plansList.find((p) => p.plan_id === currentPlanIdValue) || null;
    } else {
      currentPlan.value = null;
    }

    if (planId) {
      const plan = plansList.find((p) => p.plan_id === planId);
      if (plan) {
        selectedPlanForCheckout.value = plan;
        currentStep.value = 2;
      }
    }
  }

  loadingProducts.value = true;
  const products = await planStore.listPlanProductWithPrice();
  if (products) {
    availableProducts.value = products;
  }
  loadingProducts.value = false;

  await loadUserData();

  loading.value = false;
};

const loadUserData = async () => {
  const user = getUser();
  if (!user?.user_id) return;

  loadingUser.value = true;
  const userData = await usersStore.viewUserById(user.user_id);
  if (userData) {
    currentUser.value = userData;
  }
  loadingUser.value = false;
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

const isPlanDisabled = (plan: ListPlanWithItemsResponse): boolean => {
  return isCurrentPlan(plan.plan_id) || isDowngrade(plan);
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
};

const nextStep = () => {
  if (currentStep.value < 3) {
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
                  v-if="currentStep < 3"
                  color="primary"
                  :disabled="currentStep === 1 && !selectedPlanForCheckout"
                  @click="nextStep"
                >
                  {{ $t('next') }}
                </VBtn>
                <VBtn
                  v-else
                  color="primary"
                  :disabled="!selectedPlanForCheckout"
                >
                  {{ $t('proceed_to_payment') }}
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
</style>
