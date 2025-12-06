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

const isWorkerModalOpen = ref(false);
const selectedNotificationType = ref<
  'two_factor' | 'plan' | 'plan_expiration' | null
>(null);
const selectedWorkerId = ref<string | null>(null);
const whatsappMessage = ref<string>('');
const emailSubject = ref<string>('');
const emailMessage = ref<string>('');
const isSaving = ref(false);

const isTwoFactorActive = computed(() => {
  return (
    notifications.value?.two_factor_notification !== null &&
    (notifications.value?.two_factor_notification?.whatsapp?.worker_id !==
      null ||
      notifications.value?.two_factor_notification?.email?.message !== null)
  );
});

const isPlanActive = computed(() => {
  return (
    notifications.value?.plan_notification !== null &&
    (notifications.value?.plan_notification?.whatsapp?.worker_id !== null ||
      notifications.value?.plan_notification?.email?.message !== null)
  );
});

const isPlanExpirationActive = computed(() => {
  return (
    notifications.value?.plan_expiration_reminder !== null &&
    (notifications.value?.plan_expiration_reminder?.whatsapp?.worker_id !==
      null ||
      notifications.value?.plan_expiration_reminder?.email?.message !== null)
  );
});

const twoFactorWorkerName = computed(() => {
  return notifications.value?.two_factor_notification?.whatsapp?.name || null;
});

const planWorkerName = computed(() => {
  return notifications.value?.plan_notification?.whatsapp?.name || null;
});

const planExpirationWorkerName = computed(() => {
  return notifications.value?.plan_expiration_reminder?.whatsapp?.name || null;
});

const hasWorkers = computed(() => workers.value.length > 0);

const formatParameter = (param: string) => {
  return `{{${param}}}`;
};

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
  whatsappMessage.value = '';
  emailSubject.value = '';
  emailMessage.value = '';

  if (type === 'two_factor') {
    selectedWorkerId.value =
      notifications.value?.two_factor_notification?.whatsapp?.worker_id || null;
    whatsappMessage.value =
      notifications.value?.two_factor_notification?.whatsapp?.message || '';
    emailSubject.value =
      notifications.value?.two_factor_notification?.email?.subject || '';
    emailMessage.value =
      notifications.value?.two_factor_notification?.email?.message || '';
  } else if (type === 'plan') {
    selectedWorkerId.value =
      notifications.value?.plan_notification?.whatsapp?.worker_id || null;
    whatsappMessage.value =
      notifications.value?.plan_notification?.whatsapp?.message || '';
    emailSubject.value =
      notifications.value?.plan_notification?.email?.subject || '';
    emailMessage.value =
      notifications.value?.plan_notification?.email?.message || '';
  } else if (type === 'plan_expiration') {
    selectedWorkerId.value =
      notifications.value?.plan_expiration_reminder?.whatsapp?.worker_id ||
      null;
    whatsappMessage.value =
      notifications.value?.plan_expiration_reminder?.whatsapp?.message || '';
    emailSubject.value =
      notifications.value?.plan_expiration_reminder?.email?.subject || '';
    emailMessage.value =
      notifications.value?.plan_expiration_reminder?.email?.message || '';
  }

  await loadWorkers();
  isWorkerModalOpen.value = true;
};

const filterWorkers = (value: string, query: string, item: any) => {
  const searchQuery = query.toLowerCase();
  return (
    item.raw.name.toLowerCase().includes(searchQuery) ||
    (item.raw.number && item.raw.number.toLowerCase().includes(searchQuery))
  );
};

const closeWorkerModal = () => {
  isWorkerModalOpen.value = false;
  selectedNotificationType.value = null;
  selectedWorkerId.value = null;
  whatsappMessage.value = '';
  emailSubject.value = '';
  emailMessage.value = '';
};

const saveNotification = async () => {
  if (!selectedNotificationType.value) return;

  try {
    isSaving.value = true;

    const updateData: UpdateNotificationsRequest = {};

    if (selectedNotificationType.value === 'two_factor') {
      updateData.two_factor_notification = selectedWorkerId.value;
      updateData.two_factor_message_whatsapp = whatsappMessage.value || null;
      updateData.two_factor_message_email = emailMessage.value || null;
      updateData.two_factor_email_subject = emailSubject.value || null;
    } else if (selectedNotificationType.value === 'plan') {
      updateData.plan_notification = selectedWorkerId.value;
      updateData.plan_message_whatsapp = whatsappMessage.value || null;
      updateData.plan_message_email = emailMessage.value || null;
      updateData.plan_email_subject = emailSubject.value || null;
    } else if (selectedNotificationType.value === 'plan_expiration') {
      updateData.plan_expiration_reminder = selectedWorkerId.value;
      updateData.plan_expiration_message_whatsapp =
        whatsappMessage.value || null;
      updateData.plan_expiration_message_email = emailMessage.value || null;
      updateData.plan_expiration_email_subject = emailSubject.value || null;
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
                      {{ $t('channel') }}: {{ twoFactorWorkerName }}
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
                      {{ $t('channel') }}: {{ planWorkerName }}
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
                      {{ $t('channel') }}: {{ planExpirationWorkerName }}
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
            <div class="mb-6">
              <div class="d-flex align-center gap-2 mb-4">
                <VIcon icon="tabler-brand-whatsapp" color="success" />
                <span class="text-h6">{{ $t('whatsapp') }}</span>
              </div>

              <VAutocomplete
                v-model="selectedWorkerId"
                :items="workers"
                item-title="name"
                item-value="id"
                :placeholder="$t('select_channel')"
                variant="outlined"
                clearable
                :label="$t('channel')"
                :filter="filterWorkers"
                prepend-inner-icon="tabler-search"
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
              </VAutocomplete>

              <VTextarea
                v-model="whatsappMessage"
                :label="$t('message')"
                variant="outlined"
                rows="4"
                class="mt-4"
                :placeholder="$t('notification_message_placeholder')"
              />
            </div>

            <VDivider class="my-6" />

            <div>
              <div class="d-flex align-center gap-2 mb-4">
                <VIcon icon="tabler-mail" color="primary" />
                <span class="text-h6">{{ $t('email') }}</span>
              </div>

              <VTextField
                v-model="emailSubject"
                :label="$t('email_subject')"
                variant="outlined"
                :placeholder="$t('email_subject_placeholder')"
              />

              <VTextarea
                v-model="emailMessage"
                :label="$t('email_message')"
                variant="outlined"
                rows="4"
                class="mt-4"
                :placeholder="$t('email_message_placeholder')"
              />
            </div>

            <VCard
              v-if="selectedNotificationType"
              variant="outlined"
              color="info"
              class="mt-4"
            >
              <VCardText class="pa-4">
                <div class="text-body-2 font-weight-medium mb-2">
                  {{ $t('allowed_parameters') }}:
                </div>
                <div
                  v-if="selectedNotificationType === 'two_factor'"
                  class="text-body-2"
                >
                  <div>• {{ $t('code') }}: {{ formatParameter('code') }}</div>
                  <div>• {{ $t('name') }}: {{ formatParameter('name') }}</div>
                </div>
                <div
                  v-else-if="selectedNotificationType === 'plan'"
                  class="text-body-2"
                >
                  <div>• {{ $t('plan') }}: {{ formatParameter('plan') }}</div>
                  <div>• {{ $t('name') }}: {{ formatParameter('name') }}</div>
                  <div>
                    • {{ $t('expiration_date') }}:
                    {{ formatParameter('expiration_date') }}
                  </div>
                  <div>• {{ $t('value') }}: {{ formatParameter('value') }}</div>
                </div>
                <div
                  v-else-if="selectedNotificationType === 'plan_expiration'"
                  class="text-body-2"
                >
                  <div>• {{ $t('plan') }}: {{ formatParameter('plan') }}</div>
                  <div>• {{ $t('name') }}: {{ formatParameter('name') }}</div>
                  <div>
                    • {{ $t('expiration_date') }}:
                    {{ formatParameter('expiration_date') }}
                  </div>
                  <div>• {{ $t('value') }}: {{ formatParameter('value') }}</div>
                </div>
              </VCardText>
            </VCard>
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
