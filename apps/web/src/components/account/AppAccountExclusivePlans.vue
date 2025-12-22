<script lang="ts" setup>
import { useAccountStore } from '@/@webcore/stores/account';
import { DataTableHeader } from 'vuetify';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { ListPlanAccountExclusiveResponse } from '@core/schema/planAccountExclusive/listPlanAccountExclusive/response.schema';
import { ListExclusivePlansResponse } from '@core/schema/planAccountExclusive/listExclusivePlans/response.schema';

const accountStore = useAccountStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  accountId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const accountId = toRef(props, 'accountId');
const loading = ref<boolean>(false);
const exclusivePlans = ref<ListPlanAccountExclusiveResponse[]>([]);
const availablePlans = ref<ListExclusivePlansResponse[]>([]);
const selectedPlanId = ref<string | null>(null);
const isDialogDeleteShow = ref(false);
const planToDelete = ref<string | null>(null);

const headers: DataTableHeader<ListPlanAccountExclusiveResponse>[] = [
  { title: t('plan'), key: 'plan' },
  { title: t('created_at'), key: 'created_at' },
  { title: t('actions'), key: 'actions', sortable: false },
];

const loadExclusivePlans = async () => {
  if (!accountId.value) return;

  loading.value = true;

  try {
    const result = await accountStore.getPlanAccountExclusives(accountId.value);
    if (result) {
      exclusivePlans.value = result;
    }
  } finally {
    loading.value = false;
  }
};

const loadAvailablePlans = async () => {
  if (!accountId.value) return;

  try {
    const result = await accountStore.getExclusivePlans(accountId.value);
    if (result) {
      availablePlans.value = result;
    }
  } catch (error) {
    console.error(error);
  }
};

const addPlan = async () => {
  if (!accountId.value || !selectedPlanId.value) return;

  loading.value = true;

  try {
    const result = await accountStore.createPlanAccountExclusive({
      account_id: accountId.value,
      plan_id: selectedPlanId.value,
    });

    if (result) {
      selectedPlanId.value = null;
      await loadExclusivePlans();
      await loadAvailablePlans();
    }
  } finally {
    loading.value = false;
  }
};

const removePlan = (planAccountExclusiveId: string) => {
  planToDelete.value = planAccountExclusiveId;
  isDialogDeleteShow.value = true;
};

const handleDelete = async () => {
  if (!planToDelete.value) return;

  loading.value = true;

  try {
    const result = await accountStore.deletePlanAccountExclusive(
      planToDelete.value
    );

    if (result) {
      await loadExclusivePlans();
      await loadAvailablePlans();
    }
  } finally {
    loading.value = false;
    planToDelete.value = null;
  }
};

const itemsAvailablePlans = computed(() =>
  availablePlans.value.map((p) => ({
    value: p.plan_id,
    text: p.name,
  }))
);

watch([isVisible, accountId], async ([visible, id]) => {
  if (visible && id) {
    await loadExclusivePlans();
    await loadAvailablePlans();
  }
});

onMounted(async () => {
  if (isVisible.value && accountId.value) {
    await loadExclusivePlans();
    await loadAvailablePlans();
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="900">
    <DialogCloseBtn @click="isVisible = false" />

    <VOverlay
      :model-value="loading"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VCard :title="$t('exclusive_plans')">
      <VCardText>
        <VRow>
          <VCol cols="12">
            <VDivider class="mb-4" />
            <h3 class="text-h6 mb-4">{{ $t('exclusive_plans_list') }}</h3>
          </VCol>

          <VCol cols="12">
            <VDataTable
              :headers="headers"
              :items="exclusivePlans"
              :loading="loading"
              :loading-text="$t('loading_text')"
            >
              <template #item.plan="{ item }">
                <span v-if="item.plan" class="font-weight-medium">
                  {{ item.plan.name }}
                </span>
                <span v-else class="text-medium-emphasis">-</span>
              </template>

              <template #item.created_at="{ item }">
                <span>{{ formatDateTime(item?.created_at ?? null) }}</span>
              </template>

              <template #item.actions="{ item }">
                <IconBtn
                  color="error"
                  variant="text"
                  @click="removePlan(item.plan_account_exclusive_id)"
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
              </template>

              <template #no-data>
                {{ $t('no_data_available') }}
              </template>
            </VDataTable>
          </VCol>

          <VCol cols="12">
            <VDivider class="my-4" />
            <h3 class="text-h6 mb-4">{{ $t('add_exclusive_plan') }}</h3>
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">{{ $t('plan') }}:</VLabel>
            <AppSelectSearch
              v-model="selectedPlanId"
              :items="itemsAvailablePlans"
              :placeholder="$t('select_plan')"
              :clearable="true"
              item-value="value"
              item-title="text"
            />
          </VCol>

          <VCol cols="12" md="6" class="d-flex align-end">
            <VBtn
              :disabled="!selectedPlanId || loading"
              :loading="loading"
              @click="addPlan"
            >
              {{ $t('add') }}
            </VBtn>
          </VCol>
        </VRow>
      </VCardText>

      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn variant="tonal" color="secondary" @click="isVisible = false">
          {{ $t('close') }}
        </VBtn>
      </VCardText>
    </VCard>

    <VDialogHandler
      v-if="isDialogDeleteShow"
      v-model="isDialogDeleteShow"
      :title="$t('remove_exclusive_plan')"
      :message="$t('remove_exclusive_plan_confirmation')"
      @confirm="handleDelete"
    />
  </VDialog>
</template>
