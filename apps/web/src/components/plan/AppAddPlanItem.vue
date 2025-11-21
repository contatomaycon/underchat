<script lang="ts" setup>
import { usePlanStore } from '@/@webcore/stores/plan';
import { VForm } from 'vuetify/components/VForm';
import { EColor } from '@core/common/enums/EColor';
import { CreatePlanItemRequest } from '@core/schema/plan/createPlanItem/request.schema';
import { ListPlanItemResponse } from '@core/schema/plan/listPlanItems/response.schema';

const planStore = usePlanStore();
const { t } = useI18n();

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

// TODO: Buscar lista de plan products quando a API estiver disponível
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
    planItems.value = [];
  }
};

const addPlanItem = async () => {
  const validateForm = await refFormAddPlanItem?.value?.validate();
  if (!validateForm?.valid) return;

  if (!planId.value || !plan_product_id.value || quantity.value === null) {
    return;
  }

  // Verificar se o produto já está na lista
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

const getProductName = (item: ListPlanItemResponse) => {
  return item.plan_product?.name || t('unknown_product');
};

const getPlanName = computed(() => {
  if (!planId.value) return '';
  const plan = planStore.list.find((p) => p.plan_id === planId.value);
  if (plan) {
    return plan.name;
  }
  const planAll = planStore.listAll.find((p) => p.plan_id === planId.value);
  return planAll?.name || t('unknown_plan');
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

    <template v-if="planStore.loading">
      <VOverlay
        :model-value="planStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VCard :title="$t('add_plan_item')">
      <VCardText>
        <VAlert v-if="getPlanName" type="info" variant="tonal" class="mb-4">
          <div class="d-flex align-center">
            <VIcon icon="tabler-info-circle" class="me-2" />
            <span>
              {{ $t('adding_items_to_plan') }}:
              <strong>{{ getPlanName }}</strong>
            </span>
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
                  <div>
                    <strong>{{ getProductName(item) }}</strong>
                    <span class="ml-2 text-medium-emphasis">
                      ({{ $t('quantity') }}: {{ item.quantity }})
                    </span>
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
              <AppAutocomplete
                v-model="plan_product_id"
                :items="planProducts"
                :label="$t('plan_product') + ':'"
                :placeholder="$t('select_plan_product')"
                :rules="[
                  requiredValidator(
                    plan_product_id,
                    $t('plan_product_required')
                  ),
                ]"
              />
            </VCol>
            <VCol cols="12" sm="6">
              <AppTextField
                v-model="quantity"
                :label="$t('quantity') + ':'"
                :placeholder="$t('quantity')"
                type="number"
                :rules="[requiredValidator(quantity, $t('quantity_required'))]"
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
