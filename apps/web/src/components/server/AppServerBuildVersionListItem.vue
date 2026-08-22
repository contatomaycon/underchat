<script setup lang="ts">
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { ServerBuildVersion } from '@core/schema/server/viewServerBuild/response.schema';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  version: ServerBuildVersion;
  canEdit: boolean;
  loading: boolean;
}>();

const emit = defineEmits<{
  setDefault: [serverBuildVersionId: string];
  remove: [version: ServerBuildVersion];
}>();

const { t } = useI18n();

const removeLabel = computed(() =>
  props.version.is_default
    ? t('build_remove_default_version_disabled')
    : t('build_remove_version')
);
</script>

<template>
  <VListItem class="build-version-item">
    <template #title>
      <div class="d-flex justify-space-between align-center gap-2">
        <span class="font-weight-medium">{{ version.version }}</span>
        <VChip v-if="version.is_default" color="success" size="x-small">
          {{ $t('build_default') }}
        </VChip>
      </div>
    </template>

    <template #subtitle>
      <div class="mt-1 d-flex flex-column gap-1">
        <span>{{ formatDateTime(version.created_at) }}</span>
        <span class="text-truncate build-version-image">
          {{ version.image_reference }}
        </span>
      </div>
    </template>

    <template v-if="canEdit" #append>
      <div class="build-version-actions">
        <VBtn
          v-if="!version.is_default"
          size="x-small"
          variant="text"
          color="primary"
          :disabled="loading"
          @click="emit('setDefault', version.server_build_version_id)"
        >
          {{ $t('build_set_default') }}
        </VBtn>

        <IconBtn
          color="error"
          :disabled="loading || version.is_default"
          :aria-label="removeLabel"
          @click="emit('remove', version)"
        >
          <VTooltip
            location="top"
            transition="scale-transition"
            activator="parent"
          >
            <span>{{ removeLabel }}</span>
          </VTooltip>
          <VIcon icon="tabler-trash" />
        </IconBtn>
      </div>
    </template>
  </VListItem>
</template>

<style scoped>
.build-version-item {
  padding-inline: 0;
}

.build-version-actions {
  display: flex;
  align-items: center;
  gap: 0.125rem;
}

.build-version-image {
  max-inline-size: 340px;
}
</style>
