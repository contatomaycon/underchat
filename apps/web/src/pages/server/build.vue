<script setup lang="ts">
import { onMessage, unsubscribe } from '@/@webcore/centrifugo';
import { useServerBuildStore } from '@/@webcore/stores/serverBuild';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { EServerBuildJobItemStatus } from '@core/common/enums/EServerBuildJobItemStatus';
import { EServerBuildJobStatus } from '@core/common/enums/EServerBuildJobStatus';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EServerPermissions } from '@core/common/enums/EPermissions/server';
import { EServerBuildType } from '@core/common/enums/EServerBuildType';
import { serverBuildCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { IServerBuildCentrifugo } from '@core/common/interfaces/IServerBuildCentrifugo';
import {
  ServerBuildJob,
  ServerBuildJobItem,
} from '@core/schema/server/viewServerBuild/response.schema';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
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
const router = useRouter();

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
const terminalStatusSet = new Set<string>([
  EServerBuildJobStatus.completed,
  EServerBuildJobStatus.failed,
  EServerBuildJobStatus.canceled,
]);

const isBuildRealtimeSubscribed = ref(false);

const activeJob = computed(() => serverBuildStore.active_job);
const buildJobs = computed(() => serverBuildStore.jobs);
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

const getJobErrorMessage = (job: ServerBuildJob): string => {
  if (job.error_message) {
    return job.error_message;
  }

  const itemErrors = job.items
    .filter((item) => item.error_message)
    .map(
      (item) =>
        `${getBuildTypeLabel(item.build_type)}: ${String(item.error_message)}`
    );

  if (itemErrors.length === 0) {
    return '-';
  }

  return itemErrors.join(' | ');
};

const getJobRealtimeLogs = (serverBuildJobId: string): string => {
  const logs = serverBuildStore.realtime_logs_by_job[serverBuildJobId] ?? [];
  if (logs.length === 0) {
    return t('build_no_logs');
  }

  return logs.join('\n');
};

const getRetryableItems = (job: ServerBuildJob): ServerBuildJobItem[] => {
  if (!terminalStatusSet.has(job.status)) {
    return [];
  }

  return job.items.filter(
    (item) => item.status === EServerBuildJobItemStatus.failed
  );
};

const handleBuildRealtimeMessage = (data: IServerBuildCentrifugo): void => {
  serverBuildStore.applyRealtimeEvent(data);
};

const subscribeBuildRealtime = async (): Promise<void> => {
  if (isBuildRealtimeSubscribed.value) {
    return;
  }

  try {
    await onMessage(serverBuildCentrifugoQueue(), handleBuildRealtimeMessage);
    isBuildRealtimeSubscribed.value = true;
  } catch (error) {
    console.error('Failed to subscribe build realtime updates', error);
  }
};

const unsubscribeBuildRealtime = async (): Promise<void> => {
  if (!isBuildRealtimeSubscribed.value) {
    return;
  }

  try {
    await unsubscribe(serverBuildCentrifugoQueue());
  } catch (error) {
    console.error('Failed to unsubscribe build realtime updates', error);
  } finally {
    isBuildRealtimeSubscribed.value = false;
  }
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

const handleRetryBuildItem = async (
  serverBuildJobId: string,
  buildType: EServerBuildType
): Promise<void> => {
  const retried = await serverBuildStore.retryBuildItem({
    server_build_job_id: serverBuildJobId,
    build_type: buildType,
  });
  if (!retried) {
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

const handleBack = (): void => {
  router.push({ name: 'server' });
};

onMounted(async () => {
  await subscribeBuildRealtime();
  await refreshBuilds();
});

onBeforeUnmount(async () => {
  await unsubscribeBuildRealtime();
});
</script>

<template>
  <div>
    <VCard :title="$t('build_versions')" no-padding>
      <VCardText>
        <div class="d-flex flex-wrap gap-3">
          <VBtn
            variant="tonal"
            prepend-icon="tabler-arrow-left"
            @click="handleBack"
          >
            {{ $t('back') }}
          </VBtn>

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

        <VCard class="mt-6" variant="outlined">
          <VCardTitle>{{ $t('build_jobs_history') }}</VCardTitle>

          <VCardText>
            <div v-if="buildJobs.length === 0" class="text-medium-emphasis">
              {{ $t('no_data_available') }}
            </div>

            <VTable v-else density="compact">
              <thead>
                <tr>
                  <th>{{ $t('build_version') }}</th>
                  <th>{{ $t('build_status') }}</th>
                  <th>{{ $t('build_requested_at') }}</th>
                  <th>{{ $t('build_started_at') }}</th>
                  <th>{{ $t('build_finished_at') }}</th>
                  <th>{{ $t('error') }}</th>
                  <th>{{ $t('actions') }}</th>
                  <th>{{ $t('build_realtime_logs') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="job in buildJobs" :key="job.server_build_job_id">
                  <td>{{ job.version }}</td>
                  <td>
                    <VChip size="small" :color="getJobStatusColor(job.status)">
                      {{ getJobStatusLabel(job.status) }}
                    </VChip>
                  </td>
                  <td>
                    {{ job.created_at ? formatDateTime(job.created_at) : '-' }}
                  </td>
                  <td>
                    {{ job.started_at ? formatDateTime(job.started_at) : '-' }}
                  </td>
                  <td>
                    {{
                      job.finished_at ? formatDateTime(job.finished_at) : '-'
                    }}
                  </td>
                  <td class="build-error-cell">
                    {{ getJobErrorMessage(job) }}
                  </td>
                  <td class="build-actions-cell">
                    <div
                      v-if="
                        $canPermission(permissionsEdit) &&
                        getRetryableItems(job).length > 0
                      "
                      class="d-flex flex-column gap-2"
                    >
                      <VBtn
                        v-for="item in getRetryableItems(job)"
                        :key="`${job.server_build_job_id}:${item.build_type}`"
                        size="x-small"
                        color="primary"
                        variant="tonal"
                        :disabled="serverBuildStore.loading"
                        @click="
                          handleRetryBuildItem(
                            job.server_build_job_id,
                            item.build_type
                          )
                        "
                      >
                        {{
                          `${$t('build_retry_item')} ${getBuildTypeLabel(item.build_type)}`
                        }}
                      </VBtn>
                    </div>

                    <span v-else>-</span>
                  </td>
                  <td class="build-log-cell">
                    <pre class="build-log-pre">{{
                      getJobRealtimeLogs(job.server_build_job_id)
                    }}</pre>
                  </td>
                </tr>
              </tbody>
            </VTable>
          </VCardText>
        </VCard>
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

.build-error-cell {
  max-inline-size: 340px;
  white-space: normal;
  vertical-align: top;
}

.build-log-cell {
  max-inline-size: 500px;
  min-inline-size: 260px;
  vertical-align: top;
}

.build-actions-cell {
  min-inline-size: 180px;
  vertical-align: top;
}

.build-log-pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  max-block-size: 180px;
  overflow: auto;
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
    'Courier New', monospace;
  font-size: 0.75rem;
  line-height: 1.35;
}
</style>
