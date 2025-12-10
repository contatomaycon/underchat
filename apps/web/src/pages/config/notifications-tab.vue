<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '@/@webcore/stores/settings';
import { useNotificationsStore } from '@/@webcore/stores/notifications';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { ListNotificationsResponse } from '@core/schema/notifications/listNotifications/response.schema';
import { UpdateNotificationsRequest } from '@core/schema/notifications/updateNotifications/request.schema';
import { ListWorkersResponse } from '@core/schema/notifications/listWorkers/response.schema';
import TablePagination from '@/@webcore/components/TablePagination.vue';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';

const { t } = useI18n();
const settingsStore = useSettingsStore();
const notificationsStore = useNotificationsStore();
useSnackbarCleanup(settingsStore);

const loading = ref(false);
const notifications = ref<ListNotificationsResponse | null>(null);
const workers = ref<ListWorkersResponse>([]);

const isWorkerModalOpen = ref(false);
const selectedNotificationType = ref<
  | 'two_factor'
  | 'plan_new'
  | 'plan_renewal'
  | 'plan_expiration'
  | 'plan_cancellation'
  | null
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

const isPlanNewActive = computed(() => {
  return (
    notifications.value?.plan_new_notification !== null &&
    (notifications.value?.plan_new_notification?.whatsapp?.worker_id !== null ||
      notifications.value?.plan_new_notification?.email?.message !== null)
  );
});

const isPlanRenewalActive = computed(() => {
  return (
    notifications.value?.plan_renewal_notification !== null &&
    (notifications.value?.plan_renewal_notification?.whatsapp?.worker_id !==
      null ||
      notifications.value?.plan_renewal_notification?.email?.message !== null)
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

const isPlanCancellationActive = computed(() => {
  return (
    notifications.value?.plan_cancellation_notification !== null &&
    (notifications.value?.plan_cancellation_notification?.whatsapp
      ?.worker_id !== null ||
      notifications.value?.plan_cancellation_notification?.email?.message !==
        null)
  );
});

const twoFactorWorkerName = computed(() => {
  return notifications.value?.two_factor_notification?.whatsapp?.name || null;
});

const planNewWorkerName = computed(() => {
  return notifications.value?.plan_new_notification?.whatsapp?.name || null;
});

const planRenewalWorkerName = computed(() => {
  return notifications.value?.plan_renewal_notification?.whatsapp?.name || null;
});

const planExpirationWorkerName = computed(() => {
  return notifications.value?.plan_expiration_reminder?.whatsapp?.name || null;
});

const planCancellationWorkerName = computed(() => {
  return (
    notifications.value?.plan_cancellation_notification?.whatsapp?.name || null
  );
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
  type:
    | 'two_factor'
    | 'plan_new'
    | 'plan_renewal'
    | 'plan_expiration'
    | 'plan_cancellation'
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
  } else if (type === 'plan_new') {
    selectedWorkerId.value =
      notifications.value?.plan_new_notification?.whatsapp?.worker_id || null;
    whatsappMessage.value =
      notifications.value?.plan_new_notification?.whatsapp?.message || '';
    emailSubject.value =
      notifications.value?.plan_new_notification?.email?.subject || '';
    emailMessage.value =
      notifications.value?.plan_new_notification?.email?.message || '';
  } else if (type === 'plan_renewal') {
    selectedWorkerId.value =
      notifications.value?.plan_renewal_notification?.whatsapp?.worker_id ||
      null;
    whatsappMessage.value =
      notifications.value?.plan_renewal_notification?.whatsapp?.message || '';
    emailSubject.value =
      notifications.value?.plan_renewal_notification?.email?.subject || '';
    emailMessage.value =
      notifications.value?.plan_renewal_notification?.email?.message || '';
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
  } else if (type === 'plan_cancellation') {
    selectedWorkerId.value =
      notifications.value?.plan_cancellation_notification?.whatsapp
        ?.worker_id || null;
    whatsappMessage.value =
      notifications.value?.plan_cancellation_notification?.whatsapp?.message ||
      '';
    emailSubject.value =
      notifications.value?.plan_cancellation_notification?.email?.subject || '';
    emailMessage.value =
      notifications.value?.plan_cancellation_notification?.email?.message || '';
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
    } else if (selectedNotificationType.value === 'plan_new') {
      updateData.plan_new_notification = selectedWorkerId.value;
      updateData.plan_new_message_whatsapp = whatsappMessage.value || null;
      updateData.plan_new_message_email = emailMessage.value || null;
      updateData.plan_new_email_subject = emailSubject.value || null;
    } else if (selectedNotificationType.value === 'plan_renewal') {
      updateData.plan_renewal_notification = selectedWorkerId.value;
      updateData.plan_renewal_message_whatsapp = whatsappMessage.value || null;
      updateData.plan_renewal_message_email = emailMessage.value || null;
      updateData.plan_renewal_email_subject = emailSubject.value || null;
    } else if (selectedNotificationType.value === 'plan_expiration') {
      updateData.plan_expiration_reminder = selectedWorkerId.value;
      updateData.plan_expiration_message_whatsapp =
        whatsappMessage.value || null;
      updateData.plan_expiration_message_email = emailMessage.value || null;
      updateData.plan_expiration_email_subject = emailSubject.value || null;
    } else if (selectedNotificationType.value === 'plan_cancellation') {
      updateData.plan_cancellation_notification = selectedWorkerId.value;
      updateData.plan_cancellation_message_whatsapp =
        whatsappMessage.value || null;
      updateData.plan_cancellation_message_email = emailMessage.value || null;
      updateData.plan_cancellation_email_subject = emailSubject.value || null;
    }

    const result = await settingsStore.updateNotifications(updateData);
    if (result) {
      notifications.value = {
        notification_id: result.notification_id,
        two_factor_notification: result.two_factor_notification,
        plan_new_notification: result.plan_new_notification,
        plan_renewal_notification: result.plan_renewal_notification,
        plan_expiration_reminder: result.plan_expiration_reminder,
        plan_cancellation_notification: result.plan_cancellation_notification,
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
  type:
    | 'two_factor'
    | 'plan_new'
    | 'plan_renewal'
    | 'plan_expiration'
    | 'plan_cancellation'
) => {
  try {
    isSaving.value = true;

    const updateData: UpdateNotificationsRequest = {};

    if (type === 'two_factor') {
      updateData.two_factor_notification = null;
    } else if (type === 'plan_new') {
      updateData.plan_new_notification = null;
    } else if (type === 'plan_renewal') {
      updateData.plan_renewal_notification = null;
    } else if (type === 'plan_expiration') {
      updateData.plan_expiration_reminder = null;
    } else if (type === 'plan_cancellation') {
      updateData.plan_cancellation_notification = null;
    }

    const result = await settingsStore.updateNotifications(updateData);
    if (result) {
      notifications.value = {
        notification_id: result.notification_id,
        two_factor_notification: result.two_factor_notification,
        plan_new_notification: result.plan_new_notification,
        plan_renewal_notification: result.plan_renewal_notification,
        plan_expiration_reminder: result.plan_expiration_reminder,
        plan_cancellation_notification: result.plan_cancellation_notification,
        created_at: result.created_at,
        updated_at: result.updated_at,
      };
    }
  } finally {
    isSaving.value = false;
  }
};

const options = ref({
  page: 1,
  itemsPerPage: 10,
});

const query = computed(() => ({
  current_page: options.value.page,
  per_page: options.value.itemsPerPage,
}));

const formatNotificationId = (uuid: string): string => {
  if (!uuid) return '-';
  return uuid.slice(-8).toUpperCase();
};

const formatDate = (date: string | null): string => {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatPhone = (phone: string | null): string => {
  if (!phone) return '-';

  // Tenta formatar com formatPhoneBR primeiro (para números com DDI 55)
  const formattedBR = formatPhoneBR(phone);
  if (formattedBR !== phone.replaceAll(/\D/g, '')) {
    return formattedBR;
  }

  // Se não formatou, formata como número brasileiro sem DDI
  const numbers = phone.replaceAll(/\D/g, '').slice(0, 11);

  if (numbers.length <= 2) {
    return numbers;
  }
  if (numbers.length <= 6) {
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  }
  if (numbers.length <= 10) {
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 6)}-${numbers.slice(6)}`;
  }
  return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
};

const getNotificationTypeLabel = (typeName: string): string => {
  const typeMap: Record<string, string> = {
    TWO_FACTOR: t('two_factor_notification'),
    PLAN_NEW: t('plan_new_notification'),
    PLAN_RENEWAL: t('plan_renewal_notification'),
    PLAN_EXPIRATION: t('plan_expiration_reminder'),
    PLAN_CANCELLATION: t('plan_cancellation_notification'),
  };
  return typeMap[typeName] || typeName;
};

const getNotificationTypeColor = (typeName: string): string => {
  const colorMap: Record<string, string> = {
    TWO_FACTOR: 'primary',
    PLAN_NEW: 'success',
    PLAN_RENEWAL: 'info',
    PLAN_EXPIRATION: 'warning',
    PLAN_CANCELLATION: 'error',
  };
  return colorMap[typeName] || 'default';
};

const handleTableChange = (o: { page: number; itemsPerPage: number }) => {
  options.value.page = o.page;
  options.value.itemsPerPage = o.itemsPerPage;
};

const whatsappModal = ref(false);
const emailModal = ref(false);
const selectedWhatsappMessage = ref<string | null>(null);
const selectedEmailMessage = ref<string | null>(null);
const selectedEmailSubject = ref<string | null>(null);

const openWhatsappModal = (message: string | null) => {
  selectedWhatsappMessage.value = message;
  whatsappModal.value = true;
};

const openEmailModal = (message: string | null, subject: string | null) => {
  selectedEmailMessage.value = message;
  selectedEmailSubject.value = subject;
  emailModal.value = true;
};

const closeWhatsappModal = () => {
  whatsappModal.value = false;
  selectedWhatsappMessage.value = null;
};

const closeEmailModal = () => {
  emailModal.value = false;
  selectedEmailMessage.value = null;
  selectedEmailSubject.value = null;
};

watch(
  query,
  async (q) => {
    await notificationsStore.getSentNotifications(q);
  },
  { immediate: true, deep: true }
);

onMounted(async () => {
  await loadNotifications();
  await notificationsStore.getSentNotifications(query.value);
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
                    'notification-card--active': isPlanNewActive,
                  }"
                  @click="openWorkerModal('plan_new')"
                >
                  <VCardText>
                    <div class="d-flex align-center justify-space-between mb-2">
                      <div class="d-flex align-center gap-2">
                        <VIcon
                          icon="tabler-package"
                          :color="isPlanNewActive ? 'success' : 'error'"
                        />
                        <span class="font-weight-medium">
                          {{ $t('plan_new_notification') }}
                        </span>
                      </div>
                      <VChip
                        :color="isPlanNewActive ? 'success' : 'error'"
                        size="small"
                        variant="tonal"
                      >
                        {{ isPlanNewActive ? $t('active') : $t('deactivated') }}
                      </VChip>
                    </div>
                    <div
                      v-if="planNewWorkerName"
                      class="text-body-2 text-medium-emphasis"
                    >
                      {{ $t('channel') }}: {{ planNewWorkerName }}
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
                    'notification-card--active': isPlanRenewalActive,
                  }"
                  @click="openWorkerModal('plan_renewal')"
                >
                  <VCardText>
                    <div class="d-flex align-center justify-space-between mb-2">
                      <div class="d-flex align-center gap-2">
                        <VIcon
                          icon="tabler-refresh"
                          :color="isPlanRenewalActive ? 'success' : 'error'"
                        />
                        <span class="font-weight-medium">
                          {{ $t('plan_renewal_notification') }}
                        </span>
                      </div>
                      <VChip
                        :color="isPlanRenewalActive ? 'success' : 'error'"
                        size="small"
                        variant="tonal"
                      >
                        {{
                          isPlanRenewalActive ? $t('active') : $t('deactivated')
                        }}
                      </VChip>
                    </div>
                    <div
                      v-if="planRenewalWorkerName"
                      class="text-body-2 text-medium-emphasis"
                    >
                      {{ $t('channel') }}: {{ planRenewalWorkerName }}
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

              <VCol cols="12" md="4">
                <VCard
                  variant="outlined"
                  class="notification-card"
                  :class="{
                    'notification-card--active': isPlanCancellationActive,
                  }"
                  @click="openWorkerModal('plan_cancellation')"
                >
                  <VCardText>
                    <div class="d-flex align-center justify-space-between mb-2">
                      <div class="d-flex align-center gap-2">
                        <VIcon
                          icon="tabler-ban"
                          :color="
                            isPlanCancellationActive ? 'success' : 'error'
                          "
                        />
                        <span class="font-weight-medium">
                          {{ $t('plan_cancellation_notification') }}
                        </span>
                      </div>
                      <VChip
                        :color="isPlanCancellationActive ? 'success' : 'error'"
                        size="small"
                        variant="tonal"
                      >
                        {{
                          isPlanCancellationActive
                            ? $t('active')
                            : $t('deactivated')
                        }}
                      </VChip>
                    </div>
                    <div
                      v-if="planCancellationWorkerName"
                      class="text-body-2 text-medium-emphasis"
                    >
                      {{ $t('channel') }}: {{ planCancellationWorkerName }}
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

    <VRow class="mt-4">
      <VCol cols="12">
        <VCard>
          <VCardTitle class="text-h6 pa-6 pb-4">
            {{ $t('sent_notifications') }}
          </VCardTitle>

          <VDivider />

          <VCardText>
            <VDataTableServer
              class="data-table"
              v-model:page="options.page"
              v-model:items-per-page="options.itemsPerPage"
              :headers="[
                {
                  title: 'ID',
                  key: 'id',
                  sortable: false,
                },
                {
                  title: $t('notification_type'),
                  key: 'notification_type',
                  sortable: false,
                },
                {
                  title: $t('account'),
                  key: 'account',
                  sortable: false,
                },
                {
                  title: $t('channel'),
                  key: 'worker',
                  sortable: false,
                },
                {
                  title: $t('name'),
                  key: 'name',
                  sortable: false,
                },
                {
                  title: $t('email'),
                  key: 'email',
                  sortable: false,
                },
                {
                  title: $t('phone'),
                  key: 'phone',
                  sortable: false,
                },
                {
                  title: $t('date'),
                  key: 'date',
                  sortable: false,
                },
                {
                  title: $t('actions'),
                  key: 'actions',
                  sortable: false,
                  align: 'end',
                },
              ]"
              :items="notificationsStore.sentNotificationsList"
              :items-length="notificationsStore.sentNotificationsPagings.total"
              :loading="notificationsStore.loading"
              @update:options="handleTableChange"
              :loading-text="$t('loading_text')"
            >
              <template #item.id="{ item }">
                <VTooltip>
                  <template #activator="{ props }">
                    <span v-bind="props" class="text-caption font-mono">
                      {{ formatNotificationId(item.id) }}
                    </span>
                  </template>
                  <span>{{ item.id }}</span>
                </VTooltip>
              </template>

              <template #item.notification_type="{ item }">
                <VChip
                  v-if="item.notification_type?.name"
                  :color="getNotificationTypeColor(item.notification_type.name)"
                  size="small"
                  variant="tonal"
                >
                  {{ getNotificationTypeLabel(item.notification_type.name) }}
                </VChip>
                <span v-else class="text-medium-emphasis">-</span>
              </template>

              <template #item.account="{ item }">
                {{ item.account?.name || '-' }}
              </template>

              <template #item.worker="{ item }">
                {{ item.worker?.name || '-' }}
              </template>

              <template #item.name="{ item }">
                {{ item.name || '-' }}
              </template>

              <template #item.email="{ item }">
                {{ item.email || '-' }}
              </template>

              <template #item.phone="{ item }">
                {{ formatPhone(item.phone) }}
              </template>

              <template #item.date="{ item }">
                {{ formatDate(item.date) }}
              </template>

              <template #item.actions="{ item }">
                <div class="d-flex align-center gap-2">
                  <VBtn
                    v-if="item.message_whatsapp"
                    icon
                    variant="text"
                    size="small"
                    @click="openWhatsappModal(item.message_whatsapp)"
                  >
                    <VIcon icon="tabler-brand-whatsapp" size="20" />
                    <VTooltip activator="parent" location="top">
                      {{ $t('view_whatsapp_message') }}
                    </VTooltip>
                  </VBtn>
                  <VBtn
                    v-if="item.message_email"
                    icon
                    variant="text"
                    size="small"
                    @click="
                      openEmailModal(item.message_email, item.email_subject)
                    "
                  >
                    <VIcon icon="tabler-mail" size="20" />
                    <VTooltip activator="parent" location="top">
                      {{ $t('view_email_message') }}
                    </VTooltip>
                  </VBtn>
                </div>
              </template>

              <template #no-data>
                <div class="text-center py-8">
                  <VIcon icon="tabler-bell-off" size="48" class="mb-4" />
                  <p class="text-body-1">
                    {{ $t('no_sent_notifications_found') }}
                  </p>
                </div>
              </template>

              <template #bottom>
                <TablePagination
                  v-model:page="options.page"
                  :items-per-page="options.itemsPerPage"
                  :total-items="
                    notificationsStore.sentNotificationsPagings.total
                  "
                />
              </template>
            </VDataTableServer>
          </VCardText>
        </VCard>
      </VCol>
    </VRow>

    <VDialog v-model="whatsappModal" max-width="600">
      <VCard>
        <VCardTitle class="d-flex align-center justify-space-between">
          <span>{{ $t('whatsapp_message') }}</span>
          <IconBtn @click="closeWhatsappModal">
            <VIcon>tabler-x</VIcon>
          </IconBtn>
        </VCardTitle>

        <VDivider />

        <VCardText class="pt-6">
          <div class="text-body-1" style="white-space: pre-wrap">
            {{ selectedWhatsappMessage || '-' }}
          </div>
        </VCardText>
      </VCard>
    </VDialog>

    <VDialog v-model="emailModal" max-width="800">
      <VCard>
        <VCardTitle class="d-flex align-center justify-space-between">
          <span>{{ $t('email_message') }}</span>
          <IconBtn @click="closeEmailModal">
            <VIcon>tabler-x</VIcon>
          </IconBtn>
        </VCardTitle>

        <VDivider />

        <VCardText class="pt-6">
          <div v-if="selectedEmailSubject" class="mb-4">
            <div class="text-caption text-medium-emphasis mb-1">
              {{ $t('subject') }}
            </div>
            <div class="text-body-1 font-weight-medium">
              {{ selectedEmailSubject }}
            </div>
          </div>
          <div
            v-if="selectedEmailMessage"
            v-html="selectedEmailMessage"
            class="email-preview"
          ></div>
          <div v-else class="text-body-1">-</div>
        </VCardText>
      </VCard>
    </VDialog>

    <VDialog v-model="isWorkerModalOpen" max-width="600" persistent>
      <VCard>
        <VCardTitle class="d-flex align-center justify-space-between">
          <span>
            {{
              selectedNotificationType === 'two_factor'
                ? $t('two_factor_notification')
                : selectedNotificationType === 'plan_new'
                  ? $t('plan_new_notification')
                  : selectedNotificationType === 'plan_renewal'
                    ? $t('plan_renewal_notification')
                    : selectedNotificationType === 'plan_expiration'
                      ? $t('plan_expiration_reminder')
                      : $t('plan_cancellation_notification')
            }}
          </span>
          <IconBtn @click="closeWorkerModal">
            <VIcon>tabler-x</VIcon>
          </IconBtn>
        </VCardTitle>

        <VDivider />

        <VCardText class="pt-6">
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
              :filter="filterWorkers"
              :disabled="!hasWorkers"
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

            <VLabel class="text-body-2 mb-1 mt-4">{{ $t('message') }}:</VLabel>
            <VTextarea
              v-model="whatsappMessage"
              variant="outlined"
              rows="4"
              :placeholder="$t('notification_message_placeholder')"
              :disabled="!hasWorkers || !selectedWorkerId"
            />
          </div>

          <VDivider class="my-6" />

          <div>
            <div class="d-flex align-center gap-2 mb-4">
              <VIcon icon="tabler-mail" color="primary" />
              <span class="text-h6">{{ $t('email') }}</span>
            </div>

            <VLabel class="text-body-2 mb-1">{{ $t('email_subject') }}:</VLabel>
            <VTextField
              v-model="emailSubject"
              variant="outlined"
              :placeholder="$t('email_subject_placeholder')"
            />

            <VLabel class="text-body-2 mb-1 mt-4"
              >{{ $t('email_message') }}:</VLabel
            >
            <VTextarea
              v-model="emailMessage"
              variant="outlined"
              rows="4"
              :placeholder="$t('email_message_placeholder')"
            />

            <VCard v-if="emailMessage" variant="outlined" class="mt-4">
              <VCardTitle class="text-body-2 pa-3 pb-2">
                {{ $t('email_preview') }}
              </VCardTitle>
              <VDivider />
              <VCardText class="pa-4">
                <div
                  v-if="emailSubject"
                  class="mb-4 pb-4"
                  style="
                    border-bottom: 1px solid
                      rgba(var(--v-theme-on-surface), 0.12);
                  "
                >
                  <div class="text-caption text-medium-emphasis mb-1">
                    {{ $t('subject') }}:
                  </div>
                  <div class="text-body-1 font-weight-medium">
                    {{ emailSubject }}
                  </div>
                </div>
                <div
                  v-if="emailMessage"
                  v-html="emailMessage"
                  class="email-preview-content"
                ></div>
                <div v-else class="text-body-2 text-medium-emphasis">
                  {{ $t('no_email_preview_available') }}
                </div>
              </VCardText>
            </VCard>
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
                v-else-if="selectedNotificationType === 'plan_new'"
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
                v-else-if="selectedNotificationType === 'plan_renewal'"
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
              <div
                v-else-if="selectedNotificationType === 'plan_cancellation'"
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
        </VCardText>

        <VCardText class="d-flex justify-space-between flex-wrap gap-3">
          <VBtn
            v-if="
              selectedNotificationType &&
              ((selectedNotificationType === 'two_factor' &&
                isTwoFactorActive) ||
                (selectedNotificationType === 'plan_new' && isPlanNewActive) ||
                (selectedNotificationType === 'plan_renewal' &&
                  isPlanRenewalActive) ||
                (selectedNotificationType === 'plan_expiration' &&
                  isPlanExpirationActive) ||
                (selectedNotificationType === 'plan_cancellation' &&
                  isPlanCancellationActive))
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

.email-preview {
  max-width: 100%;
  overflow-x: auto;
}

.email-preview :deep(img) {
  max-width: 100%;
  height: auto;
}

.email-preview :deep(table) {
  max-width: 100%;
  overflow-x: auto;
}

.email-preview-content {
  max-width: 100%;
  overflow-x: auto;
}

.email-preview-content :deep(img) {
  max-width: 100%;
  height: auto;
}

.email-preview-content :deep(table) {
  max-width: 100%;
  overflow-x: auto;
}

.email-preview-content :deep(*) {
  max-width: 100%;
}

.data-table {
  :deep(.v-table__wrapper > table > thead) {
    background-color: rgba(var(--v-theme-on-surface), 0.04);
  }

  :deep(.v-table__wrapper > table > thead > tr > th) {
    background-color: transparent;
    color: rgb(var(--v-theme-primary));
    font-weight: 700;
    border-bottom: 1px solid rgba(var(--v-theme-primary), 0.25);
  }

  :deep(
    .v-table__wrapper > table > thead > tr > th .v-data-table-header__content
  ) {
    color: inherit;
  }
}
</style>
