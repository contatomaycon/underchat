<script lang="ts" setup>
import { useAccountStore } from '@/@webcore/stores/account';
import { ListAccountSubscriptionsResponse } from '@core/schema/account/listAccountSubscriptions/response.schema';

const accountStore = useAccountStore();
const { t, locale } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  accountId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const subscriptions = ref<ListAccountSubscriptionsResponse | null>(null);
const accountId = toRef(props, 'accountId');
const accountName = ref<string | null>(null);

const MAX_ITEMS_VISIBLE = 2;

const getCurrencyConfig = () => {
  const localeMap: Record<string, { locale: string; currency: string }> = {
    pt: { locale: 'pt-BR', currency: 'BRL' },
    en: { locale: 'en-US', currency: 'USD' },
    es: { locale: 'es-ES', currency: 'EUR' },
  };

  return localeMap[locale.value] || localeMap.pt;
};

const formatCurrency = (value: string | number): string => {
  const config = getCurrencyConfig();
  const numValue = typeof value === 'string' ? Number.parseFloat(value) : value;

  return new Intl.NumberFormat(config.locale, {
    style: 'currency',
    currency: config.currency,
  }).format(numValue);
};

const hasMorePlanItems = computed(() => {
  if (!subscriptions.value?.plan_items) return false;
  return subscriptions.value.plan_items.length > MAX_ITEMS_VISIBLE;
});

const hasMoreCrossSells = computed(() => {
  if (!subscriptions.value?.cross_sells) return false;
  return subscriptions.value.cross_sells.length > MAX_ITEMS_VISIBLE;
});

onMounted(async () => {
  if (!accountId.value) return;

  const [subscriptionsData, accountData] = await Promise.all([
    accountStore.getAccountSubscriptions(accountId.value),
    accountStore.getAccountById(accountId.value),
  ]);

  subscriptions.value = subscriptionsData;
  accountName.value = accountData?.name ?? null;
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="800">
    <DialogCloseBtn @click="isVisible = false" />

    <template v-if="accountStore.loading">
      <VOverlay
        :model-value="accountStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VCard :title="$t('account_subscriptions')">
      <VCardText>
        <div v-if="subscriptions" class="d-flex flex-column gap-4">
          <VAlert
            v-if="accountName"
            type="info"
            variant="tonal"
            class="mb-2"
            prominent
          >
            <div class="d-flex align-center gap-2">
              <VIcon icon="tabler-user" size="24" />
              <div>
                <strong>{{ $t('account') }}:</strong> {{ accountName }}
              </div>
            </div>
          </VAlert>

          <div v-if="subscriptions.plan">
            <h3 class="text-h6 mb-3">{{ $t('plan') }}</h3>
            <VCard variant="outlined">
              <VCardText>
                <div class="d-flex flex-column gap-4">
                  <div class="d-flex flex-column gap-2">
                    <div class="d-flex align-center gap-2">
                      <VIcon
                        icon="tabler-package"
                        size="20"
                        class="text-primary"
                      />
                      <span class="text-body-1">
                        <strong>{{ $t('name') }}:</strong>
                        {{ subscriptions.plan.name }}
                      </span>
                    </div>
                    <div class="d-flex align-center gap-2">
                      <VIcon
                        icon="tabler-currency-dollar"
                        size="20"
                        class="text-primary"
                      />
                      <span class="text-body-1">
                        <strong>{{ $t('price') }}:</strong>
                        {{ formatCurrency(subscriptions.plan.price) }}
                      </span>
                    </div>
                  </div>

                  <div
                    v-if="
                      subscriptions.plan_items &&
                      subscriptions.plan_items.length > 0
                    "
                  >
                    <VDivider class="my-2" />
                    <h4 class="text-subtitle-1 mb-2">{{ $t('plan_items') }}</h4>
                    <div
                      :class="{
                        'subscription-list-container': hasMorePlanItems,
                      }"
                      :style="
                        hasMorePlanItems
                          ? { maxHeight: '160px', overflowY: 'auto' }
                          : {}
                      "
                    >
                      <VList>
                        <VListItem
                          v-for="item in subscriptions.plan_items"
                          :key="item.plan_item_id"
                        >
                          <VListItemTitle>
                            <div class="d-flex align-center gap-2">
                              <VIcon
                                icon="tabler-package"
                                size="18"
                                class="text-primary"
                              />
                              <span>{{ item.plan_product.name || '-' }}</span>
                            </div>
                          </VListItemTitle>
                          <VListItemSubtitle>
                            <div class="d-flex align-center gap-2 mt-1">
                              <VIcon
                                icon="tabler-hash"
                                size="16"
                                class="text-primary"
                              />
                              <span
                                >{{ $t('quantity') }}: {{ item.quantity }}</span
                              >
                            </div>
                          </VListItemSubtitle>
                        </VListItem>
                      </VList>
                    </div>
                  </div>
                </div>
              </VCardText>
            </VCard>
          </div>

          <div
            v-if="
              subscriptions.cross_sells && subscriptions.cross_sells.length > 0
            "
          >
            <h3 class="text-h6 mb-3">{{ $t('cross_sells') }}</h3>
            <VCard variant="outlined">
              <VCardText>
                <div
                  :class="{
                    'subscription-list-container': hasMoreCrossSells,
                  }"
                  :style="
                    hasMoreCrossSells
                      ? { maxHeight: '160px', overflowY: 'auto' }
                      : {}
                  "
                >
                  <VList>
                    <VListItem
                      v-for="crossSell in subscriptions.cross_sells"
                      :key="crossSell.plan_cross_sell_id"
                    >
                      <VListItemTitle>
                        <div class="d-flex align-center gap-2">
                          <VIcon
                            icon="tabler-package"
                            size="18"
                            class="text-primary"
                          />
                          <span>{{ crossSell.plan_product.name || '-' }}</span>
                        </div>
                      </VListItemTitle>
                      <VListItemSubtitle>
                        <div class="d-flex flex-column gap-1 mt-1">
                          <div class="d-flex align-center gap-2">
                            <VIcon
                              icon="tabler-hash"
                              size="16"
                              class="text-primary"
                            />
                            <span
                              >{{ $t('quantity') }}:
                              {{ crossSell.quantity }}</span
                            >
                          </div>
                          <div class="d-flex align-center gap-2">
                            <VIcon
                              icon="tabler-currency-dollar"
                              size="16"
                              class="text-primary"
                            />
                            <span
                              >{{ $t('price') }}:
                              {{ formatCurrency(crossSell.price) }}</span
                            >
                          </div>
                        </div>
                      </VListItemSubtitle>
                    </VListItem>
                  </VList>
                </div>
              </VCardText>
            </VCard>
          </div>

          <div
            v-if="
              !subscriptions.cross_sells ||
              subscriptions.cross_sells.length === 0
            "
            class="text-center py-4"
          >
            <p class="text-body-2 text-medium-emphasis">
              {{ $t('no_cross_sells_found') }}
            </p>
          </div>
        </div>
      </VCardText>

      <VCardText class="d-flex justify-end">
        <VBtn variant="tonal" color="secondary" @click="isVisible = false">
          {{ $t('close') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>

<style scoped>
.subscription-list-container {
  scrollbar-width: thin;
  scrollbar-color: rgba(var(--v-theme-on-surface), 0.3) transparent;
}

.subscription-list-container::-webkit-scrollbar {
  width: 8px;
}

.subscription-list-container::-webkit-scrollbar-track {
  background: transparent;
}

.subscription-list-container::-webkit-scrollbar-thumb {
  background-color: rgba(var(--v-theme-on-surface), 0.3);
  border-radius: 4px;
}

.subscription-list-container::-webkit-scrollbar-thumb:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.5);
}
</style>
