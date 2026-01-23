<script setup lang="ts">
import { PerfectScrollbar } from 'vue3-perfect-scrollbar';
import { useI18n } from 'vue-i18n';
import { ViewReleaseResponse } from '@core/schema/release/viewRelease/response.schema';
import { EReleaseType } from '@core/common/enums/EReleaseType';

interface Props {
  release: ViewReleaseResponse | null;
}

const props = defineProps<Props>();

defineEmits<{
  (e: 'close'): void;
}>();

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
</script>

<template>
  <VNavigationDrawer
    data-allow-mismatch
    temporary
    :model-value="!!props.release"
    location="right"
    :scrim="false"
    floating
    class="release-view"
  >
    <template v-if="props.release">
      <div class="release-view-header d-flex align-center px-5 py-3">
        <IconBtn class="me-2" @click="$emit('close')">
          <VIcon size="22" icon="tabler-chevron-left" class="flip-in-rtl" />
        </IconBtn>

        <div
          class="d-flex align-center flex-wrap flex-grow-1 overflow-hidden gap-2"
        >
          <div class="text-body-1 text-high-emphasis text-truncate">
            {{ props.release.title }}
          </div>

          <VChip
            :color="getTypeColor(props.release.type)"
            class="text-capitalize flex-shrink-0"
            size="small"
            :label="false"
          >
            {{ getTypeLabel(props.release.type) }}
          </VChip>
        </div>
      </div>

      <VDivider />

      <PerfectScrollbar
        tag="div"
        class="release-content-container flex-grow-1 pa-sm-12 pa-6"
        :options="{ wheelPropagation: false }"
      >
        <VCard class="mb-4">
          <VCardText>
            <div class="text-base" v-html="props.release.message" />
          </VCardText>
        </VCard>
      </PerfectScrollbar>
    </template>
  </VNavigationDrawer>
</template>

<style lang="scss">
.release-view {
  &:not(.v-navigation-drawer--active) {
    transform: translateX(110%) !important;
  }

  inline-size: 100% !important;

  @media only screen and (min-width: 1280px) {
    inline-size: calc(100% - 256px) !important;
  }

  .v-navigation-drawer__content {
    display: flex;
    flex-direction: column;
  }
}

.release-content-container {
  background-color: rgb(var(--v-theme-on-surface), var(--v-hover-opacity));
}
</style>
