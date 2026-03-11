<script setup lang="ts">
import { useServerBuildStore } from '@/@webcore/stores/serverBuild';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { EServerBuildJobItemStatus } from '@core/common/enums/EServerBuildJobItemStatus';
import { EServerBuildJobStatus } from '@core/common/enums/EServerBuildJobStatus';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EServerPermissions } from '@core/common/enums/EPermissions/server';
import { EServerBuildType } from '@core/common/enums/EServerBuildType';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EServerPermissions.server_group,
      EServerPermissions.server_view,
      EServerPermissions.server_create,
      EServerPermissions.server_edit,
    ],
  },
});

const serverBuildStore = useServerBuildStore();
useSnackbarCleanup(serverBuildStore);
const { t } = useI18n();

const permissionsGenerate = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EServerPermissions.server_group,
  EServerPermissions.server_create,
];

const permissionsEdit = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EServerPermissions.server_group,
  EServerPermissions.server_edit,
];

const buildTypeOrder: EServerBuildType[] = [
  EServerBuildType.baileys,
  EServerBuildType.wwebjs,
  EServerBuildType.balance_api,
];

const activeStatusSet = new Set<string>([
  EServerBuildJobStatus.queued,
  EServerBuildJobStatus.running,
  EServerBuildJobStatus.cancel_requested,
]);

const pollingIntervalMs = 5000;
const pollingInFlight = ref(false);
const pollingTimer = ref<ReturnType<typeof setInterval> | null>(null);

const activeJob = computed(() => serverBuildStore.active_job);
const versionsByType = computed(() => serverBuildStore.versions_by_type);

const hasActiveJob = computed(() => {
  const status = activeJob.value?.status;
  if (!status) {
    return false;
  }

  return activeStatusSet.has(status);
});

const canCancelActiveJob = computed(() => {
  const status = activeJob.value?.status;
  if (!status) {
    return false;
  }

  return (
    status === EServerBuildJobStatus.queued ||
    status === EServerBuildJobStatus.running
  );
});

const getBuildTypeLabel = (buildType: string): string => {
  if (buildType === EServerBuildType.baileys) return t('build_type_baileys');
  if (buildType === EServerBuildType.wwebjs) return t('build_type_wwebjs');
  return t('build_type_balance_api');
};

const getJobStatusLabel = (status: string): string => {
  if (status === EServerBuildJobStatus.queued)
    return t('build_job_status_queued');
  if (status === EServerBuildJobStatus.running)
    return t('build_job_status_running');
  if (status === EServerBuildJobStatus.cancel_requested)
    return t('build_job_status_cancel_requested');
  if (status === EServerBuildJobStatus.canceled)
    return t('build_job_status_canceled');
  if (status === EServerBuildJobStatus.failed)
    return t('build_job_status_failed');

  return t('build_job_status_completed');
};

const getJobStatusColor = (status: string): string => {
  if (status === EServerBuildJobStatus.completed) return 'success';
  if (status === EServerBuildJobStatus.failed) return 'error';
  if (status === EServerBuildJobStatus.canceled) return 'warning';
  if (status === EServerBuildJobStatus.cancel_requested) return 'warning';

  return 'info';
};

const getItemStatusLabel = (status: string): string => {
  if (status === EServerBuildJobItemStatus.pending)
    return t('build_item_status_pending');
  if (status === EServerBuildJobItemStatus.running)
    return t('build_item_status_running');
  if (status === EServerBuildJobItemStatus.success)
    return t('build_item_status_success');
  if (status === EServerBuildJobItemStatus.failed)
    return t('build_item_status_failed');

  return t('build_item_status_canceled');
};

const getItemStatusColor = (status: string): string => {
  if (status === EServerBuildJobItemStatus.success) return 'success';
  if (status === EServerBuildJobItemStatus.failed) return 'error';
  if (status === EServerBuildJobItemStatus.canceled) return 'warning';
  if (status === EServerBuildJobItemStatus.running) return 'info';

  return 'secondary';
};

const stopPolling = (): void => {
  if (!pollingTimer.value) {
    return;
  }

  clearInterval(pollingTimer.value);
  pollingTimer.value = null;
};

const startPolling = (): void => {
  if (pollingTimer.value) {
    return;
  }

  pollingTimer.value = setInterval(async () => {
    if (!hasActiveJob.value || pollingInFlight.value) {
      return;
    }

    pollingInFlight.value = true;
    try {
      await serverBuildStore.fetchBuilds();
    } finally {
      pollingInFlight.value = false;
    }
  }, pollingIntervalMs);
};

const refreshBuilds = async (): Promise<void> => {
  await serverBuildStore.fetchBuilds();
};

const handleGenerateVersion = async (): Promise<void> => {
  const generated = await serverBuildStore.generateVersion();
  if (!generated) {
    return;
  }

  await refreshBuilds();
};

const handleCancelBuild = async (): Promise<void> => {
  const canceled = await serverBuildStore.cancelActiveBuild();
  if (!canceled) {
    return;
  }

  await refreshBuilds();
};

const handleSetDefault = async (
  serverBuildVersionId: string
): Promise<void> => {
  const updated =
    await serverBuildStore.setDefaultVersion(serverBuildVersionId);
  if (!updated) {
    return;
  }

  await refreshBuilds();
};

watch(
  hasActiveJob,
  (active) => {
    if (active) {
      startPolling();
      return;
    }

    stopPolling();
  },
  { immediate: true }
);

onMounted(async () => {
  await refreshBuilds();
});

onBeforeUnmount(() => {
  stopPolling();
});
</script>

<template>
  <div>
    <VCard :title="$t('build_versions')" no-padding>
      <VCardText>
        <div class="d-flex flex-wrap gap-3">
          <VBtn
            v-if="$canPermission(permissionsGenerate)"
            color="primary"
            prepend-icon="tabler-hammer"
            :disabled="serverBuildStore.loading || hasActiveJob"
            @click="handleGenerateVersion"
          >
            {{ $t('build_generate_version') }}
          </VBtn>

          <VBtn
            v-if="$canPermission(permissionsEdit) && canCancelActiveJob"
            color="warning"
            variant="tonal"
            prepend-icon="tabler-player-stop"
            :disabled="serverBuildStore.loading"
            @click="handleCancelBuild"
          >
            {{ $t('build_cancel') }}
          </VBtn>
        </div>
      </VCardText>

      <VDivider />

      <VCardText>
        <VCard v-if="activeJob" class="mb-6" variant="tonal">
          <VCardTitle>{{ $t('build_current_job') }}</VCardTitle>

          <VCardText>
            <div class="d-flex flex-wrap gap-x-6 gap-y-2 mb-4">
              <div class="build-meta-item">
                <strong>{{ $t('build_version') }}:</strong>
                <span>{{ activeJob.version }}</span>
              </div>

              <div class="build-meta-item">
                <strong>{{ $t('build_status') }}:</strong>
                <VChip
                  size="small"
                  :color="getJobStatusColor(activeJob.status)"
                >
                  {{ getJobStatusLabel(activeJob.status) }}
                </VChip>
              </div>

              <div class="build-meta-item">
                <strong>{{ $t('build_requested_at') }}:</strong>
                <span>{{
                  activeJob.created_at
                    ? formatDateTime(activeJob.created_at)
                    : '-'
                }}</span>
              </div>

              <div class="build-meta-item">
                <strong>{{ $t('build_started_at') }}:</strong>
                <span>{{
                  activeJob.started_at
                    ? formatDateTime(activeJob.started_at)
                    : '-'
                }}</span>
              </div>

              <div class="build-meta-item">
                <strong>{{ $t('build_finished_at') }}:</strong>
                <span>{{
                  activeJob.finished_at
                    ? formatDateTime(activeJob.finished_at)
                    : '-'
                }}</span>
              </div>
            </div>

            <VTable density="compact">
              <thead>
                <tr>
                  <th>{{ $t('build_type') }}</th>
                  <th>{{ $t('build_status') }}</th>
                  <th>{{ $t('build_image') }}</th>
                  <th>{{ $t('error') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in activeJob.items"
                  :key="item.server_build_job_item_id"
                >
                  <td>{{ getBuildTypeLabel(item.build_type) }}</td>
                  <td>
                    <VChip
                      size="small"
                      :color="getItemStatusColor(item.status)"
                    >
                      {{ getItemStatusLabel(item.status) }}
                    </VChip>
                  </td>
                  <td class="text-truncate build-image-cell">
                    {{ item.image_reference ?? '-' }}
                  </td>
                  <td class="text-truncate build-image-cell">
                    {{ item.error_message ?? '-' }}
                  </td>
                </tr>
              </tbody>
            </VTable>
          </VCardText>
        </VCard>

        <VAlert v-else type="info" variant="tonal" class="mb-6">
          {{ $t('build_no_active_job') }}
        </VAlert>

        <VRow>
          <VCol
            v-for="buildType in buildTypeOrder"
            :key="buildType"
            cols="12"
            md="4"
          >
            <VCard class="h-100" variant="outlined">
              <VCardTitle>{{ getBuildTypeLabel(buildType) }}</VCardTitle>

              <VCardText>
                <div
                  v-if="(versionsByType[buildType] ?? []).length === 0"
                  class="text-medium-emphasis"
                >
                  {{ $t('no_data_available') }}
                </div>

                <VList v-else density="compact" class="build-version-list">
                  <VListItem
                    v-for="version in versionsByType[buildType]"
                    :key="version.server_build_version_id"
                  >
                    <template #title>
                      <div
                        class="d-flex justify-space-between align-center gap-2"
                      >
                        <span class="font-weight-medium">{{
                          version.version
                        }}</span>
                        <VChip
                          v-if="version.is_default"
                          color="success"
                          size="x-small"
                        >
                          {{ $t('build_default') }}
                        </VChip>
                      </div>
                    </template>

                    <template #subtitle>
                      <div class="mt-1 d-flex flex-column gap-1">
                        <span>{{ formatDateTime(version.created_at) }}</span>
                        <span class="text-truncate build-image-cell">{{
                          version.image_reference
                        }}</span>
                      </div>
                    </template>

                    <template #append>
                      <VBtn
                        v-if="
                          !version.is_default && $canPermission(permissionsEdit)
                        "
                        size="x-small"
                        variant="text"
                        color="primary"
                        :disabled="serverBuildStore.loading"
                        @click="
                          handleSetDefault(version.server_build_version_id)
                        "
                      >
                        {{ $t('build_set_default') }}
                      </VBtn>
                    </template>
                  </VListItem>
                </VList>
              </VCardText>
            </VCard>
          </VCol>
        </VRow>
      </VCardText>
    </VCard>

    <VSnackbar
      v-model="serverBuildStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="serverBuildStore.snackbar.color"
    >
      {{ serverBuildStore.snackbar.message }}
    </VSnackbar>
  </div>
</template>

<style scoped lang="scss">
.build-meta-item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.build-version-list :deep(.v-list-item) {
  padding-inline: 0;
}

.build-image-cell {
  max-inline-size: 340px;
}
</style>
