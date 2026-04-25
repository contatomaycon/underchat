<script setup lang="ts">
import { EServerBuildType } from '@core/common/enums/EServerBuildType';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    availableBuildTypes: EServerBuildType[];
    loading?: boolean;
    version?: string | null;
    allowAll?: boolean;
  }>(),
  {
    loading: false,
    version: null,
    allowAll: false,
  }
);

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void;
  (e: 'confirm', buildTypes: EServerBuildType[]): void;
}>();

const { t } = useI18n();

const selectedBuildTypes = ref<EServerBuildType[]>([]);

const isVisible = computed({
  get: () => props.modelValue,
  set: (visible) => emit('update:modelValue', visible),
});

const allAvailableSelected = computed(
  () =>
    props.availableBuildTypes.length > 0 &&
    selectedBuildTypes.value.length === props.availableBuildTypes.length
);

const dialogTitle = computed(() =>
  props.version
    ? t('build_generate_missing_targets')
    : t('build_generate_version')
);

const getBuildTypeLabel = (buildType: EServerBuildType): string => {
  if (buildType === EServerBuildType.baileys) return t('build_type_baileys');
  if (buildType === EServerBuildType.wwebjs) return t('build_type_wwebjs');
  if (buildType === EServerBuildType.whatsmeow)
    return t('build_type_whatsmeow');

  return t('build_type_balance_api');
};

const resetSelection = (): void => {
  selectedBuildTypes.value = [...props.availableBuildTypes];
};

const closeDialog = (): void => {
  emit('update:modelValue', false);
};

const toggleAll = (): void => {
  selectedBuildTypes.value = allAvailableSelected.value
    ? []
    : [...props.availableBuildTypes];
};

const toggleBuildType = (buildType: EServerBuildType): void => {
  const isSelected = selectedBuildTypes.value.includes(buildType);

  selectedBuildTypes.value = isSelected
    ? selectedBuildTypes.value.filter((current) => current !== buildType)
    : [...selectedBuildTypes.value, buildType];
};

const confirm = (): void => {
  if (selectedBuildTypes.value.length === 0) {
    return;
  }

  emit('confirm', [...selectedBuildTypes.value]);
};

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) {
      resetSelection();
    }
  }
);

watch(
  () => props.availableBuildTypes,
  () => {
    selectedBuildTypes.value = selectedBuildTypes.value.filter((buildType) =>
      props.availableBuildTypes.includes(buildType)
    );
  }
);
</script>

<template>
  <VDialog v-model="isVisible" max-width="560" persistent>
    <DialogCloseBtn @click="closeDialog" />

    <VCard class="build-target-dialog" :title="dialogTitle">
      <VCardText class="build-target-dialog-content">
        <div v-if="version" class="build-version-target">
          <VIcon icon="tabler-tag" size="18" />
          <span>{{ version }}</span>
        </div>

        <VList class="build-target-list" density="comfortable">
          <VListItem
            v-if="allowAll"
            class="build-target-item"
            rounded
            :active="allAvailableSelected"
            @click="toggleAll"
          >
            <template #prepend>
              <VCheckboxBtn
                :model-value="allAvailableSelected"
                :disabled="loading"
                @click.stop
                @update:model-value="toggleAll"
              />
            </template>

            <VListItemTitle>{{ $t('build_target_all') }}</VListItemTitle>
          </VListItem>

          <VListItem
            v-for="buildType in availableBuildTypes"
            :key="buildType"
            class="build-target-item"
            rounded
            :active="selectedBuildTypes.includes(buildType)"
            @click="toggleBuildType(buildType)"
          >
            <template #prepend>
              <VCheckboxBtn
                :model-value="selectedBuildTypes.includes(buildType)"
                :disabled="loading"
                @click.stop
                @update:model-value="toggleBuildType(buildType)"
              />
            </template>

            <VListItemTitle>{{ getBuildTypeLabel(buildType) }}</VListItemTitle>
          </VListItem>
        </VList>
      </VCardText>

      <VCardText class="d-flex justify-end gap-3 flex-wrap">
        <VBtn
          color="secondary"
          variant="tonal"
          :disabled="loading"
          @click="closeDialog"
        >
          {{ $t('cancel') }}
        </VBtn>

        <VBtn
          :disabled="selectedBuildTypes.length === 0"
          :loading="loading"
          @click="confirm"
        >
          {{ $t('build_generate') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>

<style scoped lang="scss">
.build-target-dialog-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.build-version-target {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 0.5rem;
  border-radius: 0.375rem;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
  padding-block: 0.375rem;
  padding-inline: 0.625rem;
}

.build-target-list {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 0.5rem;
  padding: 0.375rem;
}

.build-target-item {
  min-block-size: 3rem;
}
</style>
