<script lang="ts" setup>
import { useSectorsStore } from '@/@webcore/stores/sector';
import {
  EditSectorParamsBody,
  EditSectorParamsRequest,
} from '@core/schema/sector/editSector/request.schema';
import { VForm } from 'vuetify/components/VForm';
import { ESectorStatus } from '@core/common/enums/ESectorStatus';

const sectorStore = useSectorsStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  sectorId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const sectorId = toRef(props, 'sectorId');
const name = ref<string | null>(null);
const color = ref<string | null>(null);
const sectorStatus = ref<string | null>(null);
const sectorStatusOptions = Object.entries(ESectorStatus).map(
  ([key, value]) => ({
    name: t(`${key}`) || key,
    id: value,
  })
);

const refFormEditSector = ref<VForm>();

const updateSector = async () => {
  const validateForm = await refFormEditSector?.value?.validate();
  if (!validateForm?.valid) return;

  if (!sectorId.value || !name.value || !color.value || !sectorStatus.value) {
    return;
  }

  const payload: EditSectorParamsRequest = {
    sector_id: sectorId.value,
  };

  const body: EditSectorParamsBody = {
    name: name.value,
    color: color.value.toUpperCase(),
    sector_status_id: sectorStatus.value,
  };

  const result = await sectorStore.updateSector(payload, body);

  if (result) {
    isVisible.value = false;

    await sectorStore.listSectors();
  }
};

onMounted(async () => {
  if (!sectorId.value) return;

  const sector = await sectorStore.getSectorById(sectorId.value);
  if (sector) {
    name.value = sector.name;
    color.value = sector.color;
    sectorStatus.value = sector.sector_status?.id ?? null;
  }
});
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

    <VForm ref="refFormEditSector" @submit.prevent>
      <VCard :title="$t('edit_sector')">
        <VCardText>
          <VRow>
            <VCol cols="12" sm="6" md="6">
              <AppTextField
                v-model="name"
                :label="$t('name') + ':'"
                :placeholder="$t('name')"
                :rules="[requiredValidator(name, $t('name_required'))]"
              />
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <label
                :for="'sector-status-select'"
                class="d-block text-body-2 font-weight-medium mb-1"
              >
                {{ $t('status') }}:
              </label>
              <VSelect
                :items="sectorStatusOptions"
                item-title="name"
                item-value="id"
                v-model="sectorStatus"
                dense
                variant="outlined"
                hide-details
                style="min-width: 200px"
              />
            </VCol>

            <VCol cols="12" sm="6" md="6">
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
          <VBtn @click="updateSector"> {{ $t('save') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
