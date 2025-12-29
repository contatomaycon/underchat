<script lang="ts" setup>
import { usePlanStore } from '@/@webcore/stores/plan';
import { VForm } from 'vuetify/components/VForm';
import { EColor } from '@core/common/enums/EColor';
import { CreatePlanItemRequest } from '@core/schema/plan/createPlanItem/request.schema';
import { ListPlanItemResponse } from '@core/schema/plan/listPlanItems/response.schema';
import {
  requiredValidator,
  maxNumberValidator,
} from '@/@webcore/utils/validators';

const planStore = usePlanStore();
const { t, locale } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  planId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const planId = toRef(props, 'planId');

const plan_product_id = ref<string | null>(null);
const quantity = ref<number | null>(null);

const planItems = ref<ListPlanItemResponse[]>([]);

const isDialogDeleteItemShow = ref(false);
const itemToDelete = ref<string | null>(null);

const planProducts = ref<{ value: string; title: string }[]>([]);

const refFormAddPlanItem = ref<VForm>();

const loadPlanItems = async () => {
  if (!planId.value) {
    planItems.value = [];
    return;
  }

  try {
    const items = await planStore.listPlanItems(planId.value);
    planItems.value = items && Array.isArray(items) ? items : [];
  } catch (error) {
    console.error('Error loading plan items:', error);
    planItems.value = [];
  }
};

const addPlanItem = async () => {
  const validateForm = await refFormAddPlanItem?.value?.validate();
  if (!validateForm?.valid) return;

  if (!planId.value || !plan_product_id.value || quantity.value === null) {
    return;
  }

  const existingItem = planItems.value.find(
    (item) => item.plan_product_id === plan_product_id.value
  );

  if (existingItem) {
    planStore.showSnackbar(t('plan_product_already_added'), EColor.warning);
    return;
  }

  const payload: CreatePlanItemRequest = {
    plan_id: planId.value,
    plan_product_id: plan_product_id.value,
    quantity: quantity.value,
  };

  const result = await planStore.createPlanItem(payload);
  if (result) {
    await loadPlanItems();
    resetForm();
  }
};

const openDeleteItemDialog = (itemId: string) => {
  itemToDelete.value = itemId;
  isDialogDeleteItemShow.value = true;
};

const handleRemovePlanItem = async () => {
  if (!itemToDelete.value) return;

  const result = await planStore.deletePlanItem(itemToDelete.value);
  if (result) {
    await loadPlanItems();
  }

  itemToDelete.value = null;
};

const resetForm = () => {
  plan_product_id.value = null;
  quantity.value = null;
  refFormAddPlanItem.value?.resetValidation();
};

const handleQuantityInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  let value = target.value;

  const numericValue = value.replace(/\D/g, '');

  if (numericValue.length > 10) {
    const limitedValue = numericValue.slice(0, 10);
    quantity.value = Number(limitedValue);

    nextTick(() => {
      if (target) {
        target.value = limitedValue;
      }
    });
  } else if (numericValue) {
    const numValue = Number(numericValue);

    if (numValue > 9999999999) {
      quantity.value = 9999999999;
      nextTick(() => {
        if (target) {
          target.value = '9999999999';
        }
      });
    } else {
      quantity.value = numValue;
    }
  } else {
    quantity.value = null;
  }
};

const getProductName = (item: ListPlanItemResponse) => {
  return item.plan_product?.name || t('unknown_product');
};

const getProductDescription = (item: ListPlanItemResponse) => {
  return item.plan_product?.description || null;
};

const getCurrencyConfig = () => {
  const localeMap: Record<string, { locale: string; currency: string }> = {
    pt: { locale: 'pt-BR', currency: 'BRL' },
    en: { locale: 'en-US', currency: 'USD' },
    es: { locale: 'es-ES', currency: 'EUR' },
  };

  return localeMap[locale.value] || localeMap.pt;
};

const formatCurrency = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '';
  const config = getCurrencyConfig();
  return new Intl.NumberFormat(config.locale, {
    style: 'currency',
    currency: config.currency,
  }).format(value);
};

const getPlanData = computed(() => {
  if (!planId.value) return null;
  const plan = planStore.list.find((p) => p.plan_id === planId.value);
  if (plan) {
    return {
      name: plan.name,
      price: plan.price,
    };
  }
  const planAll = planStore.listAll.find((p) => p.plan_id === planId.value);
  if (planAll) {
    return {
      name: planAll.name,
      price: null,
    };
  }
  return null;
});

const loadPlanProducts = async () => {
  const products = await planStore.listPlanProductAll();
  if (products) {
    planProducts.value = products.map((p) => ({
      value: p.plan_product_id,
      title: p.name || '',
    }));
  }
};

watch(
  [isVisible, planId],
  async ([visible, newPlanId]) => {
    if (visible && newPlanId) {
      resetForm();
      if (planStore.listAll.length === 0) {
        await planStore.listPlanAll();
      }
      await loadPlanItems();
      await loadPlanProducts();
    } else if (!visible) {
      planItems.value = [];
    }
  },
  { immediate: true }
);

onMounted(async () => {
  resetForm();
  await loadPlanProducts();
  if (planId.value && planStore.listAll.length === 0) {
    await planStore.listPlanAll();
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="800">
    <DialogCloseBtn @click="isVisible = false" />

    <VOverlay
      :model-value="planStore.loading"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VCard :title="$t('add_plan_item')">
      <VCardText>
        <VAlert v-if="getPlanData" type="info" variant="tonal" class="mb-4">
          <div class="d-flex flex-column">
            <div class="d-flex align-center mb-2">
              <VIcon icon="tabler-info-circle" class="me-2" />
              <span class="text-body-1 font-weight-medium">
                {{ $t('adding_items_to_plan') }}
              </span>
            </div>
            <div class="ms-8">
              <div class="d-flex align-center flex-wrap gap-2 mb-1">
                <VIcon icon="tabler-package" size="18" class="text-primary" />
                <span class="text-body-2">
                  <strong>{{ $t('plan') }}:</strong>
                  {{ getPlanData.name }}
                </span>
              </div>
              <div
                v-if="getPlanData.price !== null"
                class="d-flex align-center flex-wrap gap-2"
              >
                <VIcon
                  icon="tabler-currency-dollar"
                  size="18"
                  class="text-primary"
                />
                <span class="text-body-2">
                  <strong>{{ $t('price') }}:</strong>
                  {{ formatCurrency(getPlanData.price) }}
                </span>
              </div>
            </div>
          </div>
        </VAlert>

        <div v-if="planItems.length > 0" class="mb-6">
          <VLabel class="mb-3">{{ $t('plan_items_list') }}:</VLabel>
          <VList>
            <VListItem
              v-for="item in planItems"
              :key="item.plan_item_id"
              class="border rounded mb-2"
            >
              <VListItemTitle>
                <div class="d-flex justify-space-between align-center">
                  <div class="d-flex flex-column">
                    <div>
                      <strong>{{ getProductName(item) }}</strong>
                      <span class="ml-2 text-medium-emphasis">
                        ({{ $t('quantity') }}: {{ item.quantity }})
                      </span>
                    </div>
                    <div
                      v-if="getProductDescription(item)"
                      class="text-body-2 text-medium-emphasis mt-1"
                    >
                      {{ getProductDescription(item) }}
                    </div>
                  </div>
                  <IconBtn
                    color="error"
                    variant="text"
                    @click="openDeleteItemDialog(item.plan_item_id)"
                  >
                    <VTooltip
                      location="top"
                      transition="scale-transition"
                      activator="parent"
                    >
                      <span>{{ $t('remove') }}</span>
                    </VTooltip>
                    <VIcon icon="tabler-trash" />
                  </IconBtn>
                </div>
              </VListItemTitle>
            </VListItem>
          </VList>
        </div>

        <VDivider v-if="planItems.length > 0" class="my-4" />

        <VForm ref="refFormAddPlanItem" @submit.prevent>
          <VLabel class="mb-3">{{ $t('add_new_item') }}:</VLabel>
          <VRow>
            <VCol cols="12" sm="6">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('plan_product') }}:</VLabel
              >
              <AppSelectSearch
                v-model="plan_product_id"
                :items="planProducts"
                :placeholder="$t('select_plan_product')"
                :clearable="true"
                item-value="value"
                item-title="title"
              />
            </VCol>
            <VCol cols="12" sm="6">
              <VLabel class="text-body-2 mb-1">{{ $t('quantity') }}:</VLabel>
              <AppTextField
                v-model="quantity"
                :placeholder="$t('quantity')"
                type="number"
                :min="1"
                :max="9999999999"
                :rules="[
                  requiredValidator(quantity, $t('quantity_required')),
                  maxNumberValidator(
                    quantity,
                    9999999999,
                    $t('quantity_max_digits', { max: 10 })
                  ),
                ]"
                @input="handleQuantityInput"
              />
            </VCol>
          </VRow>
        </VForm>
      </VCardText>

      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn variant="tonal" color="secondary" @click="isVisible = false">
          {{ $t('close') }}
        </VBtn>
        <VBtn @click="addPlanItem"> {{ $t('add') }} </VBtn>
      </VCardText>
    </VCard>

    <VDialogHandler
      v-if="isDialogDeleteItemShow"
      v-model="isDialogDeleteItemShow"
      :title="$t('remove_plan_item')"
      :message="$t('remove_plan_item_confirmation')"
      @confirm="handleRemovePlanItem"
    />
  </VDialog>
</template>

<style lang="scss" scoped>
.border {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
