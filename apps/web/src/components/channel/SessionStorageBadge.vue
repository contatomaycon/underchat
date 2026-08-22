<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';

const props = defineProps<{
  storage: EWorkerSessionStorage;
}>();

const { t } = useI18n();

const presentation = computed(() =>
  props.storage === EWorkerSessionStorage.postgres
    ? {
        color: 'success',
        icon: 'tabler-database',
        label: t('session_storage_postgres'),
        tooltip: t('session_storage_postgres_description'),
      }
    : {
        color: 'warning',
        icon: 'tabler-folders',
        label: t('session_storage_legacy_volume'),
        tooltip: t('session_storage_legacy_volume_description'),
      }
);
</script>

<template>
  <VTooltip :text="presentation.tooltip" location="top">
    <template #activator="{ props: tooltipProps }">
      <VChip
        v-bind="tooltipProps"
        :color="presentation.color"
        :prepend-icon="presentation.icon"
        size="small"
        variant="tonal"
        :data-testid="`session-storage-${storage}`"
      >
        {{ presentation.label }}
      </VChip>
    </template>
  </VTooltip>
</template>
