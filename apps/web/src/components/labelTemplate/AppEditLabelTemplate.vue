<script lang="ts" setup>
import { VForm } from 'vuetify/components/VForm';
import { useLabelTemplateStore } from '@/@webcore/stores/labelTemplate';
import { ELabelStatus } from '@core/common/enums/ELabelStatus';
import {
  EditLabelTemplateParamsRequest,
  UpdateLabelTemplateRequest,
} from '@core/schema/labelTemplate/editLabelTemplate/request.schema';

const labelTemplateStore = useLabelTemplateStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  labelTemplateId: string | null;
}>();

const itemsStatus = ref([
  { value: ELabelStatus.active, text: t('active') },
  { value: ELabelStatus.inactive, text: t('inactive') },
]);

const statusSearchQuery = ref('');
const isStatusMenuOpen = ref(false);

const filteredStatuses = computed(() => {
  if (!statusSearchQuery.value) {
    return itemsStatus.value;
  }
  const query = statusSearchQuery.value.toLowerCase();
  return itemsStatus.value.filter((status) =>
    status.text.toLowerCase().includes(query)
  );
});

watch(isStatusMenuOpen, (isOpen) => {
  if (!isOpen) {
    statusSearchQuery.value = '';
  }
});

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const labelTemplateId = toRef(props, 'labelTemplateId');
const label = ref<string | null>(null);
const label_status_id = ref<string | null>(null);
const color = ref<string | null>(null);

const refFormEditLabelTemplate = ref<VForm>();

const updateLabelTemplate = async () => {
  const validateForm = await refFormEditLabelTemplate?.value?.validate();
  if (!validateForm?.valid) return;

  if (!labelTemplateId.value || !label_status_id.value) {
    return;
  }

  const payload: EditLabelTemplateParamsRequest = {
    label_template_id: labelTemplateId.value,
  };

  const body: UpdateLabelTemplateRequest = {
    label: label.value,
    color: color.value?.toUpperCase(),
    label_status: {
      label_status_id: label_status_id.value,
    },
  };

  const result = await labelTemplateStore.updateLabelTemplate(payload, body);

  if (result) {
    isVisible.value = false;

    await labelTemplateStore.listLabelTemplate();
  }
};

onMounted(async () => {
  if (!labelTemplateId.value) return;

  const labelTemplate = await labelTemplateStore.getLabelTemplateById(
    labelTemplateId.value
  );
  if (labelTemplate) {
    label.value = labelTemplate.label;
    color.value = labelTemplate.color;
    label_status_id.value = labelTemplate.label_status?.label_status_id ?? null;
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <VOverlay
      :model-value="labelTemplateStore.loading"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VForm ref="refFormEditLabelTemplate" @submit.prevent>
      <VCard :title="$t('edit_label_template')">
        <VCardText>
          <VRow>
            <VCol cols="12">
              <AppTextField
                v-model="label"
                :label="$t('label') + ':'"
                :placeholder="$t('label')"
                :rules="[requiredValidator(label, $t('label_required'))]"
              />
            </VCol>

            <VCol cols="12">
              <VLabel class="mb-1 text-body-2"
                >{{ $t('label_status') }}:</VLabel
              >
              <VMenu v-model="isStatusMenuOpen">
                <template #activator="{ props: menuProps }">
                  <VTextField
                    v-bind="menuProps"
                    :model-value="
                      filteredStatuses.find(
                        (status) => status.value === label_status_id
                      )?.text || ''
                    "
                    :placeholder="$t('label_status')"
                    variant="outlined"
                    readonly
                    :clearable="!!label_status_id"
                    clear-icon="tabler-x"
                    @click:clear="label_status_id = null"
                    :append-inner-icon="
                      label_status_id ? undefined : 'tabler-chevron-down'
                    "
                  />
                </template>
                <VCard>
                  <VCardText class="pa-2">
                    <AppTextField
                      v-model="statusSearchQuery"
                      :placeholder="$t('search') + '...'"
                      prepend-inner-icon="tabler-search"
                      density="compact"
                      hide-details
                      autofocus
                      @click.stop
                    />
                  </VCardText>
                  <VDivider />
                  <VList max-height="300" style="overflow-y: auto">
                    <template v-if="filteredStatuses.length > 0">
                      <VListItem
                        v-for="(item, index) in filteredStatuses"
                        :key="index"
                        :value="item.value"
                        @click="
                          () => {
                            label_status_id = item.value;
                            isStatusMenuOpen = false;
                            statusSearchQuery = '';
                          }
                        "
                        :active="label_status_id === item.value"
                      >
                        <VListItemTitle>{{ item.text }}</VListItemTitle>
                      </VListItem>
                    </template>
                    <VListItem v-else-if="statusSearchQuery" disabled>
                      <VListItemTitle
                        class="text-center text-body-2 text-medium-emphasis"
                      >
                        {{ $t('no_results_found') }}
                      </VListItemTitle>
                    </VListItem>
                  </VList>
                </VCard>
              </VMenu>
            </VCol>

            <VCol cols="12">
              <div class="d-flex align-center">
                <div class="d-flex align-center gap-2">
                  <label for="color-picker" class="mb-0 fw-semibold"
                    >{{ $t('cor') }}:</label
                  >
                  <span class="color-value">{{ color?.toUpperCase() }}</span>
                </div>
                <div class="flex-grow-1"></div>
                <div class="d-flex align-center gap-2">
                  <input
                    type="color"
                    v-model="color"
                    class="color-input"
                    aria-label="seletor de cor"
                  />
                  <div
                    class="swatch-large"
                    :style="{ backgroundColor: color || '' }"
                    aria-label="preview da cor"
                  ></div>
                </div>
              </div>
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="updateLabelTemplate"> {{ $t('save') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
