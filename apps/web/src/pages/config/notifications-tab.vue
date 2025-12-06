<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '@/@webcore/stores/settings';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { ListNotificationsResponse } from '@core/schema/notifications/listNotifications/response.schema';
import { UpdateNotificationsRequest } from '@core/schema/notifications/updateNotifications/request.schema';
import { ListWorkersResponse } from '@core/schema/notifications/listWorkers/response.schema';

const { t } = useI18n();
const settingsStore = useSettingsStore();
useSnackbarCleanup(settingsStore);

const loading = ref(false);
const notifications = ref<ListNotificationsResponse | null>(null);
const workers = ref<ListWorkersResponse>([]);
const workerSearchQuery = ref('');

const isWorkerModalOpen = ref(false);
const selectedNotificationType = ref<
  'two_factor' | 'plan' | 'plan_expiration' | null
>(null);
const selectedWorkerId = ref<string | null>(null);
const isSaving = ref(false);

const isTwoFactorActive = computed(() => {
  return (
    notifications.value?.two_factor_notification !== null &&
    notifications.value?.two_factor_notification?.worker_id !== null
  );
});

const isPlanActive = computed(() => {
  return (
    notifications.value?.plan_notification !== null &&
    notifications.value?.plan_notification?.worker_id !== null
  );
});

const isPlanExpirationActive = computed(() => {
  return (
    notifications.value?.plan_expiration_reminder !== null &&
    notifications.value?.plan_expiration_reminder?.worker_id !== null
  );
});

const twoFactorWorkerName = computed(() => {
  return notifications.value?.two_factor_notification?.name || null;
});

const planWorkerName = computed(() => {
  return notifications.value?.plan_notification?.name || null;
});

const planExpirationWorkerName = computed(() => {
  return notifications.value?.plan_expiration_reminder?.name || null;
});

const filteredWorkers = computed(() => {
  if (!workerSearchQuery.value) {
    return workers.value;
  }

  const query = workerSearchQuery.value.toLowerCase();
  return workers.value.filter(
    (worker) =>
      worker.name.toLowerCase().includes(query) ||
      (worker.number && worker.number.toLowerCase().includes(query))
  );
});

const hasWorkers = computed(() => workers.value.length > 0);
const hasFilteredWorkers = computed(() => filteredWorkers.value.length > 0);

const loadNotifications = async () => {
  loading.value = true;
  const result = await settingsStore.getNotifications();
  if (result) {
    notifications.value = result;
  }
  loading.value = false;
};

const loadWorkers = async () => {
  const result = await settingsStore.getWorkers();
  if (result) {
    workers.value = result;
  }
};

const openWorkerModal = async (
  type: 'two_factor' | 'plan' | 'plan_expiration'
) => {
  selectedNotificationType.value = type;
  selectedWorkerId.value = null;
  workerSearchQuery.value = '';

  if (type === 'two_factor') {
    selectedWorkerId.value =
      notifications.value?.two_factor_notification?.worker_id || null;
  } else if (type === 'plan') {
    selectedWorkerId.value =
      notifications.value?.plan_notification?.worker_id || null;
  } else if (type === 'plan_expiration') {
    selectedWorkerId.value =
      notifications.value?.plan_expiration_reminder?.worker_id || null;
  }

  await loadWorkers();
  isWorkerModalOpen.value = true;
};

const closeWorkerModal = () => {
  isWorkerModalOpen.value = false;
  selectedNotificationType.value = null;
  selectedWorkerId.value = null;
};

const saveNotification = async () => {
  if (!selectedNotificationType.value) return;

  try {
    isSaving.value = true;

    const updateData: UpdateNotificationsRequest = {};

    if (selectedNotificationType.value === 'two_factor') {
      updateData.two_factor_notification = selectedWorkerId.value;
    } else if (selectedNotificationType.value === 'plan') {
      updateData.plan_notification = selectedWorkerId.value;
    } else if (selectedNotificationType.value === 'plan_expiration') {
      updateData.plan_expiration_reminder = selectedWorkerId.value;
    }

    const result = await settingsStore.updateNotifications(updateData);
    if (result) {
      notifications.value = {
        notification_id: result.notification_id,
        two_factor_notification: result.two_factor_notification,
        plan_notification: result.plan_notification,
        plan_expiration_reminder: result.plan_expiration_reminder,
        created_at: result.created_at,
        updated_at: result.updated_at,
      };
      closeWorkerModal();
    }
  } finally {
    isSaving.value = false;
  }
};

const removeNotification = async (
  type: 'two_factor' | 'plan' | 'plan_expiration'
) => {
  try {
    isSaving.value = true;

    const updateData: UpdateNotificationsRequest = {};

    if (type === 'two_factor') {
      updateData.two_factor_notification = null;
    } else if (type === 'plan') {
      updateData.plan_notification = null;
    } else if (type === 'plan_expiration') {
      updateData.plan_expiration_reminder = null;
    }

    const result = await settingsStore.updateNotifications(updateData);
    if (result) {
      notifications.value = {
        notification_id: result.notification_id,
        two_factor_notification: result.two_factor_notification,
        plan_notification: result.plan_notification,
        plan_expiration_reminder: result.plan_expiration_reminder,
        created_at: result.created_at,
        updated_at: result.updated_at,
      };
    }
  } finally {
    isSaving.value = false;
  }
};

onMounted(() => {
  loadNotifications();
});
</script>

<template>
  <div>
    <VRow v-if="loading">
      <VCol cols="12" class="text-center">
        <VProgressCircular indeterminate color="primary" />
      </VCol>
    </VRow>

    <VRow v-else>
      <VCol cols="12">
        <VCard>
          <VCardTitle class="text-h6 pa-6 pb-4">
            {{ $t('notifications') }}
          </VCardTitle>

          <VDivider />

          <VCardText>
            <VRow>
              <VCol cols="12" md="4">
                <VCard
                  variant="outlined"
                  class="notification-card"
                  :class="{
                    'notification-card--active': isTwoFactorActive,
                  }"
                  @click="openWorkerModal('two_factor')"
                >
                  <VCardText>
                    <div class="d-flex align-center justify-space-between mb-2">
                      <div class="d-flex align-center gap-2">
                        <VIcon
                          icon="tabler-shield-lock"
                          :color="isTwoFactorActive ? 'success' : 'error'"
                        />
                        <span class="font-weight-medium">
                          {{ $t('two_factor_notification') }}
                        </span>
                      </div>
                      <VChip
                        :color="isTwoFactorActive ? 'success' : 'error'"
                        size="small"
                        variant="tonal"
                      >
                        {{
                          isTwoFactorActive ? $t('active') : $t('deactivated')
                        }}
                      </VChip>
                    </div>
                    <div
                      v-if="twoFactorWorkerName"
                      class="text-body-2 text-medium-emphasis"
                    >
                      {{ $t('worker') }}: {{ twoFactorWorkerName }}
                    </div>
                    <div v-else class="text-body-2 text-medium-emphasis">
                      {{ $t('not_configured') }}
                    </div>
                  </VCardText>
                </VCard>
              </VCol>

              <VCol cols="12" md="4">
                <VCard
                  variant="outlined"
                  class="notification-card"
                  :class="{
                    'notification-card--active': isPlanActive,
                  }"
                  @click="openWorkerModal('plan')"
                >
                  <VCardText>
                    <div class="d-flex align-center justify-space-between mb-2">
                      <div class="d-flex align-center gap-2">
                        <VIcon
                          icon="tabler-package"
                          :color="isPlanActive ? 'success' : 'error'"
                        />
                        <span class="font-weight-medium">
                          {{ $t('plan_notification') }}
                        </span>
                      </div>
                      <VChip
                        :color="isPlanActive ? 'success' : 'error'"
                        size="small"
                        variant="tonal"
                      >
                        {{ isPlanActive ? $t('active') : $t('deactivated') }}
                      </VChip>
                    </div>
                    <div
                      v-if="planWorkerName"
                      class="text-body-2 text-medium-emphasis"
                    >
                      {{ $t('worker') }}: {{ planWorkerName }}
                    </div>
                    <div v-else class="text-body-2 text-medium-emphasis">
                      {{ $t('not_configured') }}
                    </div>
                  </VCardText>
                </VCard>
              </VCol>

              <VCol cols="12" md="4">
                <VCard
                  variant="outlined"
                  class="notification-card"
                  :class="{
                    'notification-card--active': isPlanExpirationActive,
                  }"
                  @click="openWorkerModal('plan_expiration')"
                >
                  <VCardText>
                    <div class="d-flex align-center justify-space-between mb-2">
                      <div class="d-flex align-center gap-2">
                        <VIcon
                          icon="tabler-clock"
                          :color="isPlanExpirationActive ? 'success' : 'error'"
                        />
                        <span class="font-weight-medium">
                          {{ $t('plan_expiration_reminder') }}
                        </span>
                      </div>
                      <VChip
                        :color="isPlanExpirationActive ? 'success' : 'error'"
                        size="small"
                        variant="tonal"
                      >
                        {{
                          isPlanExpirationActive
                            ? $t('active')
                            : $t('deactivated')
                        }}
                      </VChip>
                    </div>
                    <div
                      v-if="planExpirationWorkerName"
                      class="text-body-2 text-medium-emphasis"
                    >
                      {{ $t('worker') }}: {{ planExpirationWorkerName }}
                    </div>
                    <div v-else class="text-body-2 text-medium-emphasis">
                      {{ $t('not_configured') }}
                    </div>
                  </VCardText>
                </VCard>
              </VCol>
            </VRow>
          </VCardText>
        </VCard>
      </VCol>
    </VRow>

    <VDialog v-model="isWorkerModalOpen" max-width="600" persistent>
      <VCard>
        <VCardTitle class="d-flex align-center justify-space-between">
          <span>
            {{
              selectedNotificationType === 'two_factor'
                ? $t('two_factor_notification')
                : selectedNotificationType === 'plan'
                  ? $t('plan_notification')
                  : $t('plan_expiration_reminder')
            }}
          </span>
          <IconBtn @click="closeWorkerModal">
            <VIcon>tabler-x</VIcon>
          </IconBtn>
        </VCardTitle>

        <VDivider />

        <VCardText class="pt-6">
          <div v-if="!hasWorkers" class="text-center py-4">
            <VIcon
              icon="tabler-info-circle"
              size="48"
              color="warning"
              class="mb-2"
            />
            <div class="text-body-1 text-medium-emphasis">
              {{ $t('no_workers_available') }}
            </div>
          </div>

          <template v-else>
            <AppTextField
              v-model="workerSearchQuery"
              :placeholder="$t('search') + '...'"
              prepend-inner-icon="tabler-search"
              single-line
              hide-details
              dense
              outlined
              class="mb-4"
            />

            <VSelect
              v-model="selectedWorkerId"
              :items="filteredWorkers"
              item-title="name"
              item-value="id"
              :placeholder="$t('select_worker')"
              variant="outlined"
              clearable
              :label="$t('worker')"
              :disabled="!hasFilteredWorkers"
            >
              <template #no-data>
                <div class="text-center py-4">
                  <div class="text-body-2 text-medium-emphasis">
                    {{ $t('no_results_found') }}
                  </div>
                </div>
              </template>
              <template #item="{ props: itemProps, item }">
                <VListItem v-bind="itemProps">
                  <template #prepend>
                    <VIcon icon="tabler-device-mobile" class="me-2" />
                  </template>
                  <VListItemTitle>{{ item.raw.name }}</VListItemTitle>
                  <VListItemSubtitle v-if="item.raw.number">
                    {{ item.raw.number }}
                  </VListItemSubtitle>
                </VListItem>
              </template>
            </VSelect>
          </template>
        </VCardText>

        <VCardText class="d-flex justify-space-between flex-wrap gap-3">
          <VBtn
            v-if="
              selectedNotificationType &&
              ((selectedNotificationType === 'two_factor' &&
                isTwoFactorActive) ||
                (selectedNotificationType === 'plan' && isPlanActive) ||
                (selectedNotificationType === 'plan_expiration' &&
                  isPlanExpirationActive))
            "
            color="error"
            variant="tonal"
            :loading="isSaving"
            :disabled="isSaving"
            @click="
              selectedNotificationType &&
              removeNotification(selectedNotificationType)
            "
          >
            {{ $t('remove') }}
          </VBtn>
          <VSpacer />
          <VBtn
            variant="tonal"
            color="secondary"
            :disabled="isSaving"
            @click="closeWorkerModal"
          >
            {{ $t('cancel') }}
          </VBtn>
          <VBtn
            color="primary"
            :loading="isSaving"
            :disabled="isSaving"
            @click="saveNotification"
          >
            {{ $t('save') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VDialog>

    <VSnackbar
      v-model="settingsStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="settingsStore.snackbar.color"
    >
      {{ settingsStore.snackbar.message }}
    </VSnackbar>
  </div>
</template>

<style scoped>
.notification-card {
  cursor: pointer;
  transition: all 0.2s ease;
}

.notification-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transform: translateY(-2px);
}

.notification-card--active {
  border-color: rgb(var(--v-theme-success)) !important;
  background-color: rgba(var(--v-theme-success), 0.05);
}
</style>
