<script lang="ts" setup>
import { useLabelTemplateStore } from '@/@webcore/stores/labelTemplate';
import { ELabelStatus } from '@core/common/enums/ELabelStatus';
import { CreateLabelTemplateRequest } from '@core/schema/labelTemplate/createLabelTemplate/request.schema';
import { VForm } from 'vuetify/components/VForm';

const labelTemplateStore = useLabelTemplateStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const itemsStatus = ref([
  { value: ELabelStatus.active, text: t('active') },
  { value: ELabelStatus.inactive, text: t('inactive') },
]);

const DEFAULT_COLOR = '#A89999';

const color = ref<string>(DEFAULT_COLOR);
const label = ref<string | null>(null);
const label_status_id = ref<string | null>(null);

const refFormAddLabelTemplate = ref<VForm>();

const addLabelTemplate = async () => {
  const validateForm = await refFormAddLabelTemplate?.value?.validate();
  if (!validateForm?.valid) return;

  if (!label.value || !label_status_id.value || !color.value) {
    return;
  }

  const payload: CreateLabelTemplateRequest = {
    label: label.value,
    label_status: {
      label_status_id: label_status_id.value,
    },
    color: color.value,
  };

  const result = await labelTemplateStore.addLabelTemplate(payload);

  if (result) {
    isVisible.value = false;

    await labelTemplateStore.listLabelTemplate();
  }
};

const resetForm = () => {
  label.value = null;
  label_status_id.value = null;
  color.value = DEFAULT_COLOR;
  refFormAddLabelTemplate.value?.resetValidation();
};

onMounted(async () => {
  resetForm();
});

watch(isVisible, (visible) => {
  if (visible) resetForm();
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <template v-if="labelTemplateStore.loading">
      <VOverlay
        :model-value="labelTemplateStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VForm ref="refFormAddLabelTemplate" @submit.prevent>
      <VCard :title="$t('add_label_template')">
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

            <VCol cols="12" md="6">
              <AppSelect
                v-model="label_status_id"
                :items="itemsStatus"
                item-title="text"
                item-value="value"
                :label="$t('label_status') + ':'"
                :placeholder="$t('label_status')"
                :rules="[
                  requiredValidator(
                    label_status_id,
                    $t('label_status_id_required')
                  ),
                ]"
              />
            </VCol>

            <VCol cols="12">
              <div class="d-flex align-center">
                <div class="d-flex align-center gap-2">
                  <label :for="'color-picker'" class="mb-0 fw-semibold"
                    >{{ $t('cor') }}:</label
                  >
                  <span class="color-value">{{ color.toUpperCase() }}</span>
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
          <VBtn @click="addLabelTemplate"> {{ $t('add') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
