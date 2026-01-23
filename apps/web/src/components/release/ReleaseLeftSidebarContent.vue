<script setup lang="ts">
import { PerfectScrollbar } from 'vue3-perfect-scrollbar';
import { useI18n } from 'vue-i18n';
import { EReleaseType } from '@core/common/enums/EReleaseType';

defineOptions({
  inheritAttrs: false,
});

const props = defineProps<Props>();

defineEmits<{
  (e: 'toggleComposeDialogVisibility'): void;
  (e: 'selectType', type: EReleaseType | null): void;
}>();

interface Props {
  selectedType: EReleaseType | null;
}

const { t } = useI18n();

const getTypeColor = (type: EReleaseType): string => {
  const colors: Record<EReleaseType, string> = {
    [EReleaseType.news]: 'success',
    [EReleaseType.informative]: 'primary',
    [EReleaseType.maintenance]: 'warning',
    [EReleaseType.update]: 'info',
    [EReleaseType.fix]: 'secondary',
    [EReleaseType.warning]: 'error',
  };
  return colors[type] || 'primary';
};

const getTypeLabel = (type: EReleaseType): string => {
  const labels: Record<EReleaseType, string> = {
    [EReleaseType.news]: t('release_type_news'),
    [EReleaseType.informative]: t('release_type_informative'),
    [EReleaseType.maintenance]: t('release_type_maintenance'),
    [EReleaseType.update]: t('release_type_update'),
    [EReleaseType.fix]: t('release_type_fix'),
    [EReleaseType.warning]: t('release_type_warning'),
  };
  return labels[type] || type;
};

const types: EReleaseType[] = [
  EReleaseType.news,
  EReleaseType.informative,
  EReleaseType.maintenance,
  EReleaseType.update,
  EReleaseType.fix,
  EReleaseType.warning,
];
</script>

<template>
  <div class="d-flex flex-column h-100">
    <div class="px-6 pb-5 pt-6">
      <VBtn block @click="$emit('toggleComposeDialogVisibility')">
        {{ $t('add_release') }}
      </VBtn>
    </div>

    <PerfectScrollbar :options="{ wheelPropagation: false }" class="h-100">
      <ul class="release-types py-4">
        <div class="text-caption text-disabled mb-4 px-6">
          {{ $t('types') }}
        </div>
        <li
          v-bind="$attrs"
          :class="
            props.selectedType === null && 'release-type-active text-primary'
          "
          class="cursor-pointer d-flex align-center"
          @click="$emit('selectType', null)"
        >
          <VIcon
            icon="tabler-list"
            class="me-2 text-medium-emphasis"
            size="12"
          />
          <div class="text-body-1 text-high-emphasis">
            {{ $t('all') }}
          </div>
        </li>
        <li
          v-for="type in types"
          :key="type"
          v-bind="$attrs"
          :class="
            props.selectedType === type && 'release-type-active text-primary'
          "
          class="cursor-pointer d-flex align-center"
          @click="
            $emit('selectType', props.selectedType === type ? null : type)
          "
        >
          <VIcon
            icon="tabler-circle-filled"
            :color="getTypeColor(type)"
            class="me-2"
            size="12"
          />
          <div class="text-body-1 text-high-emphasis">
            {{ getTypeLabel(type) }}
          </div>
        </li>
      </ul>
    </PerfectScrollbar>
  </div>
</template>

<style lang="scss">
.release-types {
  .release-type-active {
    &::after {
      position: absolute;
      background: currentcolor;
      block-size: 100%;
      content: '';
      inline-size: 3px;
      inset-block-start: 0;
      inset-inline-start: 0;
    }
  }
}

.release-types {
  > li {
    position: relative;
    margin-block-end: 0.75rem;
    padding-inline: 24px;
  }
}
</style>
