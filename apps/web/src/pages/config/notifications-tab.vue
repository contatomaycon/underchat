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

type NotificationTypeKey =
  | 'two_factor'
  | 'plan_new'
  | 'plan_renewal'
  | 'plan_expiration'
  | 'plan_cancellation'
  | 'recurring_payment_failure'
  | 'test_plan_new'
  | 'test_plan_expiration';

type NotificationConfig = NonNullable<
  ListNotificationsResponse['two_factor_notification']
>;

const { t } = useI18n();
const settingsStore = useSettingsStore();
const notificationsStore = useNotificationsStore();
useSnackbarCleanup(settingsStore);

const loading = ref(false);
const notifications = ref<ListNotificationsResponse | null>(null);
const workers = ref<ListWorkersResponse>([]);

const isWorkerModalOpen = ref(false);
const selectedNotificationType = ref<NotificationTypeKey | null>(null);
const selectedWorkerId = ref<string | null>(null);
const whatsappEnabled = ref(false);
const whatsappMessage = ref<string>('');
const emailEnabled = ref(false);
const emailSubject = ref<string>('');
const emailMessage = ref<string>('');
const isSaving = ref(false);

const getNotificationByType = (
  type: NotificationTypeKey
): NotificationConfig | null => {
  const notificationMap: Record<
    NotificationTypeKey,
    NotificationConfig | null | undefined
  > = {
    two_factor: notifications.value?.two_factor_notification,
    plan_new: notifications.value?.plan_new_notification,
    plan_renewal: notifications.value?.plan_renewal_notification,
    plan_expiration: notifications.value?.plan_expiration_reminder,
    plan_cancellation: notifications.value?.plan_cancellation_notification,
    recurring_payment_failure:
      notifications.value?.recurring_payment_failure_notification,
    test_plan_new: notifications.value?.test_plan_new_notification,
    test_plan_expiration: notifications.value?.test_plan_expiration_reminder,
  };

  return notificationMap[type] ?? null;
};

const isWhatsappChannelActive = (
  notification: NotificationConfig | null | undefined,
  type?: NotificationTypeKey
) => {
  return !!(
    notification?.whatsapp?.enabled === true &&
    notification.whatsapp.worker_id &&
    (type === 'two_factor' || notification.whatsapp.message)
  );
};

const isEmailChannelActive = (
  notification: NotificationConfig | null | undefined,
  type?: NotificationTypeKey
) => {
  if (type === 'two_factor') {
    return false;
  }

  return !!(
    notification?.email?.enabled === true && notification.email.message
  );
};

const isNotificationActive = (
  notification: NotificationConfig | null | undefined,
  type?: NotificationTypeKey
) => {
  return (
    isWhatsappChannelActive(notification, type) ||
    isEmailChannelActive(notification, type)
  );
};

const getChannelColor = (isActive: boolean) => {
  return isActive ? 'success' : 'error';
};

const getChannelSummary = (type: NotificationTypeKey) => {
  const notification = getNotificationByType(type);
  const whatsappActive = isWhatsappChannelActive(notification, type);
  const emailActive = isEmailChannelActive(notification, type);

  const channels = [
    {
      key: 'whatsapp',
      icon: 'tabler-brand-whatsapp',
      label: t('whatsapp'),
      active: whatsappActive,
    },
    {
      key: 'email',
      icon: 'tabler-mail',
      label: t('email'),
      active: emailActive,
    },
  ];

  if (type === 'two_factor') {
    return channels.slice(0, 1);
  }
  return channels;
};

const isTwoFactorActive = computed(() => {
  return isNotificationActive(
    notifications.value?.two_factor_notification,
    'two_factor'
  );
});

const isPlanNewActive = computed(() => {
  return isNotificationActive(
    notifications.value?.plan_new_notification,
    'plan_new'
  );
});

const isPlanRenewalActive = computed(() => {
  return isNotificationActive(
    notifications.value?.plan_renewal_notification,
    'plan_renewal'
  );
});

const isPlanExpirationActive = computed(() => {
  return isNotificationActive(
    notifications.value?.plan_expiration_reminder,
    'plan_expiration'
  );
});

const isPlanCancellationActive = computed(() => {
  return isNotificationActive(
    notifications.value?.plan_cancellation_notification,
    'plan_cancellation'
  );
});

const isRecurringPaymentFailureActive = computed(() => {
  return isNotificationActive(
    notifications.value?.recurring_payment_failure_notification,
    'recurring_payment_failure'
  );
});

const isTestPlanNewActive = computed(() => {
  return isNotificationActive(
    notifications.value?.test_plan_new_notification,
    'test_plan_new'
  );
});

const isTestPlanExpirationActive = computed(() => {
  return isNotificationActive(
    notifications.value?.test_plan_expiration_reminder,
    'test_plan_expiration'
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

const recurringPaymentFailureWorkerName = computed(() => {
  return (
    notifications.value?.recurring_payment_failure_notification?.whatsapp
      ?.name || null
  );
});

const testPlanNewWorkerName = computed(() => {
  return (
    notifications.value?.test_plan_new_notification?.whatsapp?.name || null
  );
});

const testPlanExpirationWorkerName = computed(() => {
  return (
    notifications.value?.test_plan_expiration_reminder?.whatsapp?.name || null
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

const openWorkerModal = async (type: NotificationTypeKey) => {
  selectedNotificationType.value = type;
  selectedWorkerId.value = null;
  whatsappEnabled.value = false;
  whatsappMessage.value = '';
  emailEnabled.value = false;
  emailSubject.value = '';
  emailMessage.value = '';

  const notification = getNotificationByType(type);
  selectedWorkerId.value = notification?.whatsapp?.worker_id || null;
  whatsappEnabled.value = notification?.whatsapp?.enabled ?? false;
  whatsappMessage.value =
    type === 'two_factor' ? '' : notification?.whatsapp?.message || '';
  emailEnabled.value =
    type === 'two_factor' ? false : (notification?.email?.enabled ?? false);
  emailSubject.value =
    type === 'two_factor' ? '' : notification?.email?.subject || '';
  emailMessage.value =
    type === 'two_factor' ? '' : notification?.email?.message || '';

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
  whatsappEnabled.value = false;
  whatsappMessage.value = '';
  emailEnabled.value = false;
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
      updateData.two_factor_message_whatsapp = null;
      updateData.two_factor_whatsapp_enabled = whatsappEnabled.value;
      updateData.two_factor_message_email = null;
      updateData.two_factor_email_subject = null;
      updateData.two_factor_email_enabled = false;
    } else if (selectedNotificationType.value === 'plan_new') {
      updateData.plan_new_notification = selectedWorkerId.value;
      updateData.plan_new_message_whatsapp = whatsappMessage.value || null;
      updateData.plan_new_whatsapp_enabled = whatsappEnabled.value;
      updateData.plan_new_message_email = emailMessage.value || null;
      updateData.plan_new_email_subject = emailSubject.value || null;
      updateData.plan_new_email_enabled = emailEnabled.value;
    } else if (selectedNotificationType.value === 'plan_renewal') {
      updateData.plan_renewal_notification = selectedWorkerId.value;
      updateData.plan_renewal_message_whatsapp = whatsappMessage.value || null;
      updateData.plan_renewal_whatsapp_enabled = whatsappEnabled.value;
      updateData.plan_renewal_message_email = emailMessage.value || null;
      updateData.plan_renewal_email_subject = emailSubject.value || null;
      updateData.plan_renewal_email_enabled = emailEnabled.value;
    } else if (selectedNotificationType.value === 'plan_expiration') {
      updateData.plan_expiration_reminder = selectedWorkerId.value;
      updateData.plan_expiration_message_whatsapp =
        whatsappMessage.value || null;
      updateData.plan_expiration_whatsapp_enabled = whatsappEnabled.value;
      updateData.plan_expiration_message_email = emailMessage.value || null;
      updateData.plan_expiration_email_subject = emailSubject.value || null;
      updateData.plan_expiration_email_enabled = emailEnabled.value;
    } else if (selectedNotificationType.value === 'plan_cancellation') {
      updateData.plan_cancellation_notification = selectedWorkerId.value;
      updateData.plan_cancellation_message_whatsapp =
        whatsappMessage.value || null;
      updateData.plan_cancellation_whatsapp_enabled = whatsappEnabled.value;
      updateData.plan_cancellation_message_email = emailMessage.value || null;
      updateData.plan_cancellation_email_subject = emailSubject.value || null;
      updateData.plan_cancellation_email_enabled = emailEnabled.value;
    } else if (selectedNotificationType.value === 'recurring_payment_failure') {
      updateData.recurring_payment_failure_notification =
        selectedWorkerId.value;
      updateData.recurring_payment_failure_message_whatsapp =
        whatsappMessage.value || null;
      updateData.recurring_payment_failure_whatsapp_enabled =
        whatsappEnabled.value;
      updateData.recurring_payment_failure_message_email =
        emailMessage.value || null;
      updateData.recurring_payment_failure_email_subject =
        emailSubject.value || null;
      updateData.recurring_payment_failure_email_enabled = emailEnabled.value;
    } else if (selectedNotificationType.value === 'test_plan_new') {
      updateData.test_plan_new_notification = selectedWorkerId.value;
      updateData.test_plan_new_message_whatsapp = whatsappMessage.value || null;
      updateData.test_plan_new_whatsapp_enabled = whatsappEnabled.value;
      updateData.test_plan_new_message_email = emailMessage.value || null;
      updateData.test_plan_new_email_subject = emailSubject.value || null;
      updateData.test_plan_new_email_enabled = emailEnabled.value;
    } else if (selectedNotificationType.value === 'test_plan_expiration') {
      updateData.test_plan_expiration_reminder = selectedWorkerId.value;
      updateData.test_plan_expiration_message_whatsapp =
        whatsappMessage.value || null;
      updateData.test_plan_expiration_whatsapp_enabled = whatsappEnabled.value;
      updateData.test_plan_expiration_message_email =
        emailMessage.value || null;
      updateData.test_plan_expiration_email_subject =
        emailSubject.value || null;
      updateData.test_plan_expiration_email_enabled = emailEnabled.value;
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
        recurring_payment_failure_notification:
          result.recurring_payment_failure_notification,
        test_plan_new_notification: result.test_plan_new_notification,
        test_plan_expiration_reminder: result.test_plan_expiration_reminder,
        created_at: result.created_at,
        updated_at: result.updated_at,
      };
      closeWorkerModal();
    }
  } finally {
    isSaving.value = false;
  }
};

const removeNotification = async (type: NotificationTypeKey) => {
  try {
    isSaving.value = true;

    const updateData: UpdateNotificationsRequest = {};

    if (type === 'two_factor') {
      updateData.two_factor_notification = null;
      updateData.two_factor_message_whatsapp = null;
      updateData.two_factor_whatsapp_enabled = false;
      updateData.two_factor_message_email = null;
      updateData.two_factor_email_subject = null;
      updateData.two_factor_email_enabled = false;
    } else if (type === 'plan_new') {
      updateData.plan_new_notification = null;
    } else if (type === 'plan_renewal') {
      updateData.plan_renewal_notification = null;
    } else if (type === 'plan_expiration') {
      updateData.plan_expiration_reminder = null;
    } else if (type === 'plan_cancellation') {
      updateData.plan_cancellation_notification = null;
    } else if (type === 'recurring_payment_failure') {
      updateData.recurring_payment_failure_notification = null;
    } else if (type === 'test_plan_new') {
      updateData.test_plan_new_notification = null;
    } else if (type === 'test_plan_expiration') {
      updateData.test_plan_expiration_reminder = null;
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
        recurring_payment_failure_notification:
          result.recurring_payment_failure_notification,
        test_plan_new_notification: result.test_plan_new_notification,
        test_plan_expiration_reminder: result.test_plan_expiration_reminder,
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
    RECURRING_PAYMENT_FAILURE: t('recurring_payment_failure_notification'),
    TEST_PLAN_NEW: t('test_plan_new_notification'),
    TEST_PLAN_EXPIRATION: t('test_plan_expiration_reminder'),
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
    RECURRING_PAYMENT_FAILURE: 'error',
    TEST_PLAN_NEW: 'success',
    TEST_PLAN_EXPIRATION: 'warning',
  };
  return colorMap[typeName] || 'default';
};

const selectedNotificationTypeLabel = computed(() => {
  if (!selectedNotificationType.value) {
    return '';
  }

  const labelMap: Record<string, string> = {
    two_factor: t('two_factor_notification'),
    plan_new: t('plan_new_notification'),
    plan_renewal: t('plan_renewal_notification'),
    plan_expiration: t('plan_expiration_reminder'),
    plan_cancellation: t('plan_cancellation_notification'),
    recurring_payment_failure: t('recurring_payment_failure_notification'),
    test_plan_new: t('test_plan_new_notification'),
    test_plan_expiration: t('test_plan_expiration_reminder'),
  };

  return labelMap[selectedNotificationType.value] || '';
});

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
    <VRow>
      <VCol cols="12">
        <VCard>
          <VCardTitle class="text-h6 pa-6 pb-4">
            {{ $t('notifications') }}
          </VCardTitle>

          <VDivider />

          <VCardText>
            <VRow v-if="loading" align="stretch">
              <VCol
                v-for="i in 8"
                :key="`skeleton-${i}`"
                cols="12"
                md="3"
                class="d-flex"
              >
                <VCard
                  variant="outlined"
                  class="notification-card flex-grow-1 d-flex flex-column"
                >
                  <VCardText class="d-flex flex-column flex-grow-1">
                    <div class="d-flex align-center justify-space-between mb-2">
                      <div class="d-flex align-center gap-2">
                        <VSkeletonLoader type="avatar" width="24" height="24" />
                        <VSkeletonLoader type="text" width="150" height="20" />
                      </div>
                      <VSkeletonLoader type="chip" width="80" height="24" />
                    </div>
                    <VSkeletonLoader
                      type="text"
                      width="120"
                      height="16"
                      class="mt-2"
                    />
                  </VCardText>
                </VCard>
              </VCol>
            </VRow>

            <VRow v-else align="stretch">
              <VCol cols="12" md="3" class="d-flex">
                <VCard
                  variant="outlined"
                  class="notification-card flex-grow-1 d-flex flex-column"
                  :class="{
                    'notification-card--active': isTwoFactorActive,
                  }"
                  @click="openWorkerModal('two_factor')"
                >
                  <VCardText class="d-flex flex-column flex-grow-1">
                    <div class="d-flex align-start justify-space-between mb-2">
                      <div class="d-flex align-start gap-2 flex-grow-1">
                        <VIcon
                          icon="tabler-shield-lock"
                          :color="isTwoFactorActive ? 'success' : 'error'"
                          class="mt-1"
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
                    <div class="notification-channel-summary mt-3">
                      <VChip
                        v-for="channel in getChannelSummary('two_factor')"
                        :key="channel.key"
                        :color="getChannelColor(channel.active)"
                        size="x-small"
                        variant="tonal"
                      >
                        <VIcon :icon="channel.icon" start size="14" />
                        {{ channel.label }}:
                        {{ channel.active ? $t('active') : $t('deactivated') }}
                      </VChip>
                    </div>
                  </VCardText>
                </VCard>
              </VCol>

              <VCol cols="12" md="3" class="d-flex">
                <VCard
                  variant="outlined"
                  class="notification-card flex-grow-1 d-flex flex-column"
                  :class="{
                    'notification-card--active': isPlanNewActive,
                  }"
                  @click="openWorkerModal('plan_new')"
                >
                  <VCardText class="d-flex flex-column flex-grow-1">
                    <div class="d-flex align-start justify-space-between mb-2">
                      <div class="d-flex align-start gap-2 flex-grow-1">
                        <VIcon
                          icon="tabler-package"
                          :color="isPlanNewActive ? 'success' : 'error'"
                          class="mt-1"
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
                    <div class="notification-channel-summary mt-3">
                      <VChip
                        v-for="channel in getChannelSummary('plan_new')"
                        :key="channel.key"
                        :color="getChannelColor(channel.active)"
                        size="x-small"
                        variant="tonal"
                      >
                        <VIcon :icon="channel.icon" start size="14" />
                        {{ channel.label }}:
                        {{ channel.active ? $t('active') : $t('deactivated') }}
                      </VChip>
                    </div>
                  </VCardText>
                </VCard>
              </VCol>

              <VCol cols="12" md="3" class="d-flex">
                <VCard
                  variant="outlined"
                  class="notification-card flex-grow-1 d-flex flex-column"
                  :class="{
                    'notification-card--active': isPlanRenewalActive,
                  }"
                  @click="openWorkerModal('plan_renewal')"
                >
                  <VCardText class="d-flex flex-column flex-grow-1">
                    <div class="d-flex align-start justify-space-between mb-2">
                      <div class="d-flex align-start gap-2 flex-grow-1">
                        <VIcon
                          icon="tabler-refresh"
                          :color="isPlanRenewalActive ? 'success' : 'error'"
                          class="mt-1"
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
                    <div class="notification-channel-summary mt-3">
                      <VChip
                        v-for="channel in getChannelSummary('plan_renewal')"
                        :key="channel.key"
                        :color="getChannelColor(channel.active)"
                        size="x-small"
                        variant="tonal"
                      >
                        <VIcon :icon="channel.icon" start size="14" />
                        {{ channel.label }}:
                        {{ channel.active ? $t('active') : $t('deactivated') }}
                      </VChip>
                    </div>
                  </VCardText>
                </VCard>
              </VCol>

              <VCol cols="12" md="3" class="d-flex">
                <VCard
                  variant="outlined"
                  class="notification-card flex-grow-1 d-flex flex-column"
                  :class="{
                    'notification-card--active': isPlanExpirationActive,
                  }"
                  @click="openWorkerModal('plan_expiration')"
                >
                  <VCardText class="d-flex flex-column flex-grow-1">
                    <div class="d-flex align-start justify-space-between mb-2">
                      <div class="d-flex align-start gap-2 flex-grow-1">
                        <VIcon
                          icon="tabler-clock"
                          :color="isPlanExpirationActive ? 'success' : 'error'"
                          class="mt-1"
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
                    <div class="notification-channel-summary mt-3">
                      <VChip
                        v-for="channel in getChannelSummary('plan_expiration')"
                        :key="channel.key"
                        :color="getChannelColor(channel.active)"
                        size="x-small"
                        variant="tonal"
                      >
                        <VIcon :icon="channel.icon" start size="14" />
                        {{ channel.label }}:
                        {{ channel.active ? $t('active') : $t('deactivated') }}
                      </VChip>
                    </div>
                  </VCardText>
                </VCard>
              </VCol>

              <VCol cols="12" md="3" class="d-flex">
                <VCard
                  variant="outlined"
                  class="notification-card flex-grow-1 d-flex flex-column"
                  :class="{
                    'notification-card--active': isPlanCancellationActive,
                  }"
                  @click="openWorkerModal('plan_cancellation')"
                >
                  <VCardText class="d-flex flex-column flex-grow-1">
                    <div class="d-flex align-start justify-space-between mb-2">
                      <div class="d-flex align-start gap-2 flex-grow-1">
                        <VIcon
                          icon="tabler-ban"
                          :color="
                            isPlanCancellationActive ? 'success' : 'error'
                          "
                          class="mt-1"
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
                    <div class="notification-channel-summary mt-3">
                      <VChip
                        v-for="channel in getChannelSummary(
                          'plan_cancellation'
                        )"
                        :key="channel.key"
                        :color="getChannelColor(channel.active)"
                        size="x-small"
                        variant="tonal"
                      >
                        <VIcon :icon="channel.icon" start size="14" />
                        {{ channel.label }}:
                        {{ channel.active ? $t('active') : $t('deactivated') }}
                      </VChip>
                    </div>
                  </VCardText>
                </VCard>
              </VCol>

              <VCol cols="12" md="3" class="d-flex">
                <VCard
                  variant="outlined"
                  class="notification-card flex-grow-1 d-flex flex-column"
                  :class="{
                    'notification-card--active':
                      isRecurringPaymentFailureActive,
                  }"
                  @click="openWorkerModal('recurring_payment_failure')"
                >
                  <VCardText class="d-flex flex-column flex-grow-1">
                    <div class="d-flex align-start justify-space-between mb-2">
                      <div class="d-flex align-start gap-2 flex-grow-1">
                        <VIcon
                          icon="tabler-alert-circle"
                          :color="
                            isRecurringPaymentFailureActive
                              ? 'success'
                              : 'error'
                          "
                          class="mt-1"
                        />
                        <span class="font-weight-medium">
                          {{ $t('recurring_payment_failure_notification') }}
                        </span>
                      </div>
                      <VChip
                        :color="
                          isRecurringPaymentFailureActive ? 'success' : 'error'
                        "
                        size="small"
                        variant="tonal"
                      >
                        {{
                          isRecurringPaymentFailureActive
                            ? $t('active')
                            : $t('deactivated')
                        }}
                      </VChip>
                    </div>
                    <div
                      v-if="recurringPaymentFailureWorkerName"
                      class="text-body-2 text-medium-emphasis"
                    >
                      {{ $t('channel') }}:
                      {{ recurringPaymentFailureWorkerName }}
                    </div>
                    <div v-else class="text-body-2 text-medium-emphasis">
                      {{ $t('not_configured') }}
                    </div>
                    <div class="notification-channel-summary mt-3">
                      <VChip
                        v-for="channel in getChannelSummary(
                          'recurring_payment_failure'
                        )"
                        :key="channel.key"
                        :color="getChannelColor(channel.active)"
                        size="x-small"
                        variant="tonal"
                      >
                        <VIcon :icon="channel.icon" start size="14" />
                        {{ channel.label }}:
                        {{ channel.active ? $t('active') : $t('deactivated') }}
                      </VChip>
                    </div>
                  </VCardText>
                </VCard>
              </VCol>

              <VCol cols="12" md="3" class="d-flex">
                <VCard
                  variant="outlined"
                  class="notification-card flex-grow-1 d-flex flex-column"
                  :class="{
                    'notification-card--active': isTestPlanNewActive,
                  }"
                  @click="openWorkerModal('test_plan_new')"
                >
                  <VCardText class="d-flex flex-column flex-grow-1">
                    <div class="d-flex align-start justify-space-between mb-2">
                      <div class="d-flex align-start gap-2 flex-grow-1">
                        <VIcon
                          icon="tabler-flask"
                          :color="isTestPlanNewActive ? 'success' : 'error'"
                          class="mt-1"
                        />
                        <span class="font-weight-medium">
                          {{ $t('test_plan_new_notification') }}
                        </span>
                      </div>
                      <VChip
                        :color="isTestPlanNewActive ? 'success' : 'error'"
                        size="small"
                        variant="tonal"
                      >
                        {{
                          isTestPlanNewActive ? $t('active') : $t('deactivated')
                        }}
                      </VChip>
                    </div>
                    <div
                      v-if="testPlanNewWorkerName"
                      class="text-body-2 text-medium-emphasis"
                    >
                      {{ $t('channel') }}: {{ testPlanNewWorkerName }}
                    </div>
                    <div v-else class="text-body-2 text-medium-emphasis">
                      {{ $t('not_configured') }}
                    </div>
                    <div class="notification-channel-summary mt-3">
                      <VChip
                        v-for="channel in getChannelSummary('test_plan_new')"
                        :key="channel.key"
                        :color="getChannelColor(channel.active)"
                        size="x-small"
                        variant="tonal"
                      >
                        <VIcon :icon="channel.icon" start size="14" />
                        {{ channel.label }}:
                        {{ channel.active ? $t('active') : $t('deactivated') }}
                      </VChip>
                    </div>
                  </VCardText>
                </VCard>
              </VCol>

              <VCol cols="12" md="3" class="d-flex">
                <VCard
                  variant="outlined"
                  class="notification-card flex-grow-1 d-flex flex-column"
                  :class="{
                    'notification-card--active': isTestPlanExpirationActive,
                  }"
                  @click="openWorkerModal('test_plan_expiration')"
                >
                  <VCardText class="d-flex flex-column flex-grow-1">
                    <div class="d-flex align-start justify-space-between mb-2">
                      <div class="d-flex align-start gap-2 flex-grow-1">
                        <VIcon
                          icon="tabler-clock-hour-4"
                          :color="
                            isTestPlanExpirationActive ? 'success' : 'error'
                          "
                          class="mt-1"
                        />
                        <span class="font-weight-medium">
                          {{ $t('test_plan_expiration_reminder') }}
                        </span>
                      </div>
                      <VChip
                        :color="
                          isTestPlanExpirationActive ? 'success' : 'error'
                        "
                        size="small"
                        variant="tonal"
                      >
                        {{
                          isTestPlanExpirationActive
                            ? $t('active')
                            : $t('deactivated')
                        }}
                      </VChip>
                    </div>
                    <div
                      v-if="testPlanExpirationWorkerName"
                      class="text-body-2 text-medium-emphasis"
                    >
                      {{ $t('channel') }}: {{ testPlanExpirationWorkerName }}
                    </div>
                    <div v-else class="text-body-2 text-medium-emphasis">
                      {{ $t('not_configured') }}
                    </div>
                    <div class="notification-channel-summary mt-3">
                      <VChip
                        v-for="channel in getChannelSummary(
                          'test_plan_expiration'
                        )"
                        :key="channel.key"
                        :color="getChannelColor(channel.active)"
                        size="x-small"
                        variant="tonal"
                      >
                        <VIcon :icon="channel.icon" start size="14" />
                        {{ channel.label }}:
                        {{ channel.active ? $t('active') : $t('deactivated') }}
                      </VChip>
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
          <span>{{ selectedNotificationTypeLabel }}</span>
          <IconBtn @click="closeWorkerModal">
            <VIcon>tabler-x</VIcon>
          </IconBtn>
        </VCardTitle>

        <VDivider />

        <VCardText class="pt-6">
          <div class="mb-6">
            <div class="d-flex align-center justify-space-between mb-4">
              <div class="d-flex align-center gap-2">
                <VIcon icon="tabler-brand-whatsapp" color="success" />
                <span class="text-h6">{{ $t('whatsapp') }}</span>
              </div>
              <VSwitch
                v-model="whatsappEnabled"
                color="success"
                density="compact"
                hide-details
                inset
              />
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
              :disabled="!whatsappEnabled || !hasWorkers"
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

            <template v-if="selectedNotificationType !== 'two_factor'">
              <VLabel class="text-body-2 mb-1 mt-4"
                >{{ $t('message') }}:</VLabel
              >
              <VTextarea
                v-model="whatsappMessage"
                variant="outlined"
                rows="4"
                :placeholder="$t('notification_message_placeholder')"
                :disabled="!whatsappEnabled || !hasWorkers || !selectedWorkerId"
              />
            </template>
          </div>

          <VDivider
            v-if="selectedNotificationType !== 'two_factor'"
            class="my-6"
          />

          <div v-if="selectedNotificationType !== 'two_factor'">
            <div class="d-flex align-center justify-space-between mb-4">
              <div class="d-flex align-center gap-2">
                <VIcon icon="tabler-mail" color="primary" />
                <span class="text-h6">{{ $t('email') }}</span>
              </div>
              <VSwitch
                v-model="emailEnabled"
                color="primary"
                density="compact"
                hide-details
                inset
              />
            </div>

            <VLabel class="text-body-2 mb-1">{{ $t('email_subject') }}:</VLabel>
            <VTextField
              v-model="emailSubject"
              variant="outlined"
              :placeholder="$t('email_subject_placeholder')"
              :disabled="!emailEnabled"
            />

            <VLabel class="text-body-2 mb-1 mt-4"
              >{{ $t('email_message') }}:</VLabel
            >
            <VTextarea
              v-model="emailMessage"
              variant="outlined"
              rows="4"
              :placeholder="$t('email_message_placeholder')"
              :disabled="!emailEnabled"
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
            v-if="
              selectedNotificationType &&
              selectedNotificationType !== 'two_factor'
            "
            variant="outlined"
            color="info"
            class="mt-4"
          >
            <VCardText class="pa-4">
              <div class="text-body-2 font-weight-medium mb-2">
                {{ $t('allowed_parameters') }}:
              </div>
              <div
                v-if="selectedNotificationType === 'plan_new'"
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
              <div
                v-else-if="
                  selectedNotificationType === 'recurring_payment_failure'
                "
                class="text-body-2"
              >
                <div>• {{ $t('plan') }}: {{ formatParameter('plan') }}</div>
                <div>• {{ $t('name') }}: {{ formatParameter('name') }}</div>
                <div>• {{ $t('value') }}: {{ formatParameter('value') }}</div>
              </div>
              <div
                v-else-if="selectedNotificationType === 'test_plan_new'"
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
                v-else-if="selectedNotificationType === 'test_plan_expiration'"
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
                  isPlanCancellationActive) ||
                (selectedNotificationType === 'recurring_payment_failure' &&
                  isRecurringPaymentFailureActive) ||
                (selectedNotificationType === 'test_plan_new' &&
                  isTestPlanNewActive) ||
                (selectedNotificationType === 'test_plan_expiration' &&
                  isTestPlanExpirationActive))
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
  height: 100%;
}

.notification-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transform: translateY(-2px);
}

.notification-card--active {
  border-color: rgb(var(--v-theme-success)) !important;
  background-color: rgba(var(--v-theme-success), 0.05);
}

.notification-card :deep(.v-card-text) {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
}

.notification-card
  :deep(.v-card-text > .d-flex.align-start.justify-space-between) {
  gap: 0.75rem;
}

.notification-card
  :deep(
    .v-card-text > .d-flex.align-start.justify-space-between > .flex-grow-1
  ) {
  min-width: 0;
}

.notification-card
  :deep(.v-card-text > .d-flex.align-start.justify-space-between > .v-chip) {
  flex: 0 0 auto;
  align-self: flex-start;
}

.notification-card
  :deep(
    .v-card-text
      > .d-flex.align-start.justify-space-between
      > .v-chip
      .v-chip__content
  ) {
  overflow: visible;
  white-space: nowrap;
}

.notification-card :deep(.font-weight-medium) {
  word-wrap: break-word;
  overflow-wrap: break-word;
  white-space: normal;
  line-height: 1.4;
}

.notification-channel-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
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
