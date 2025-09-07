<script lang="ts" setup>
import { useSectorsStore } from '@/@webcore/stores/sector';
import { CreateSectorRequest } from '@core/schema/sector/createSector/request.schema';
import { VForm } from 'vuetify/components/VForm';

const sectorStore = useSectorsStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const name = ref<string | null>(null);

const DEFAULT_COLOR = '#A89999';
const color = ref<string>(DEFAULT_COLOR);

const refFormAddSector = ref<VForm>();

const addSectors = async () => {
  const validateForm = await refFormAddSector?.value?.validate();
  if (!validateForm?.valid) return;

  if (!name.value || !color.value) {
    return;
  }

  const payload: CreateSectorRequest = {
    name: name.value,
    color: color.value.toUpperCase(),
  };

  const result = await sectorStore.addSectors(payload);

  if (result) {
    isVisible.value = false;

    await sectorStore.listSectors();
  }
};

const resetForm = () => {
  name.value = null;
  color.value = DEFAULT_COLOR;
  refFormAddSector.value?.resetValidation();
};

watch(isVisible, (visible) => {
  if (visible) resetForm();
});

onMounted(resetForm);
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <template v-if="sectorStore.loading">
      <VOverlay
        :model-value="sectorStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VForm ref="refFormAddSector" @submit.prevent>
      <VCard :title="$t('add_sector')">
        <VCardText>
          <VRow>
            <VCol cols="12">
              <AppTextField
                v-model="name"
                :label="$t('name') + ':'"
                :placeholder="$t('name')"
                :rules="[requiredValidator(name, $t('name_required'))]"
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
          <VBtn @click="addSectors"> {{ $t('add') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
