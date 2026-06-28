<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { InternalChatNotificationSettingsData } from '@core/schema/internalChat/notificationSettings/response.schema';
import type { InternalChatNotificationSettingsRequest } from '@core/schema/internalChat/notificationSettings/request.schema';

const model = defineModel<boolean>({ default: false });

const props = withDefaults(
  defineProps<{
    settings: InternalChatNotificationSettingsData | null;
    loading?: boolean;
    saving?: boolean;
  }>(),
  {
    loading: false,
    saving: false,
  }
);

const emit = defineEmits<{
  (e: 'save', value: InternalChatNotificationSettingsRequest): void;
}>();

const { t } = useI18n();
type NotificationSettingKey =
  keyof Required<InternalChatNotificationSettingsRequest>;
type NotificationOption = {
  key: NotificationSettingKey;
  icon: string;
  title: string;
  subtitle: string;
};

const draft = reactive<Required<InternalChatNotificationSettingsRequest>>({
  notifications_internal_chat: true,
  notifications_internal_chat_direct: true,
  notifications_internal_chat_group: true,
  notifications_internal_chat_sound: true,
  notifications_internal_chat_vibrate: false,
  notifications_internal_chat_toast: true,
  notifications_internal_chat_browser: true,
  notifications_internal_chat_push: true,
});

const isDisabled = computed(() => props.loading || props.saving);
const childOptionsDisabled = computed(
  () => isDisabled.value || !draft.notifications_internal_chat
);

const channelOptions = computed<NotificationOption[]>(() => [
  {
    key: 'notifications_internal_chat_direct',
    icon: 'tabler-message-circle',
    title: t('internal_chat_notification_direct'),
    subtitle: t('internal_chat_notification_direct_description'),
  },
  {
    key: 'notifications_internal_chat_group',
    icon: 'tabler-users-group',
    title: t('internal_chat_notification_group'),
    subtitle: t('internal_chat_notification_group_description'),
  },
]);

const deliveryOptions = computed<NotificationOption[]>(() => [
  {
    key: 'notifications_internal_chat_sound',
    icon: 'tabler-volume',
    title: t('internal_chat_notification_sound'),
    subtitle: t('internal_chat_notification_sound_description'),
  },
  {
    key: 'notifications_internal_chat_toast',
    icon: 'tabler-layout-bottombar',
    title: t('internal_chat_notification_toast'),
    subtitle: t('internal_chat_notification_toast_description'),
  },
  {
    key: 'notifications_internal_chat_browser',
    icon: 'tabler-browser',
    title: t('internal_chat_notification_browser'),
    subtitle: t('internal_chat_notification_browser_description'),
  },
  {
    key: 'notifications_internal_chat_push',
    icon: 'tabler-device-mobile-message',
    title: t('internal_chat_notification_push'),
    subtitle: t('internal_chat_notification_push_description'),
  },
]);

function syncDraft() {
  const settings = props.settings;

  draft.notifications_internal_chat =
    settings?.notifications_internal_chat !== false;
  draft.notifications_internal_chat_direct =
    settings?.notifications_internal_chat_direct !== false;
  draft.notifications_internal_chat_group =
    settings?.notifications_internal_chat_group !== false;
  draft.notifications_internal_chat_sound =
    settings?.notifications_internal_chat_sound !== false;
  draft.notifications_internal_chat_vibrate =
    settings?.notifications_internal_chat_vibrate === true;
  draft.notifications_internal_chat_toast =
    settings?.notifications_internal_chat_toast !== false;
  draft.notifications_internal_chat_browser =
    settings?.notifications_internal_chat_browser !== false;
  draft.notifications_internal_chat_push =
    settings?.notifications_internal_chat_push !== false;
}

function closeDialog() {
  if (props.saving) return;
  model.value = false;
}

function saveSettings() {
  emit('save', { ...draft });
}

watch(
  () => [props.settings, model.value],
  () => {
    if (model.value) {
      syncDraft();
    }
  },
  { immediate: true }
);
</script>

<template>
  <VDialog v-model="model" max-width="540">
    <DialogCloseBtn :disabled="saving" @click="closeDialog" />

    <VCard class="internal-chat-notification-dialog">
      <VCardItem class="pb-2">
        <template #prepend>
          <VAvatar color="primary" variant="tonal" size="42">
            <VIcon size="22">tabler-bell</VIcon>
          </VAvatar>
        </template>

        <VCardTitle>{{ t('internal_chat_notification_title') }}</VCardTitle>
        <VCardSubtitle>
          {{ t('internal_chat_notification_description') }}
        </VCardSubtitle>
      </VCardItem>

      <VDivider />

      <VCardText class="internal-chat-notification-body">
        <div v-if="loading" class="internal-chat-notification-loading">
          <VProgressCircular indeterminate color="primary" size="28" />
        </div>

        <template v-else>
          <div class="internal-chat-notification-option">
            <div class="internal-chat-notification-option-icon">
              <VIcon size="20">tabler-bell-ringing</VIcon>
            </div>
            <div class="internal-chat-notification-option-text">
              <p class="internal-chat-notification-option-title">
                {{ t('internal_chat_notification_master') }}
              </p>
              <p class="internal-chat-notification-option-subtitle">
                {{ t('internal_chat_notification_master_description') }}
              </p>
            </div>
            <VSwitch
              v-model="draft.notifications_internal_chat"
              color="primary"
              hide-details
              inset
              :disabled="isDisabled"
            />
          </div>

          <div class="internal-chat-notification-section">
            <span class="internal-chat-notification-section-title">
              {{ t('internal_chat_notification_channels') }}
            </span>

            <div
              v-for="option in channelOptions"
              :key="option.key"
              class="internal-chat-notification-option"
            >
              <div class="internal-chat-notification-option-icon">
                <VIcon size="20">{{ option.icon }}</VIcon>
              </div>
              <div class="internal-chat-notification-option-text">
                <p class="internal-chat-notification-option-title">
                  {{ option.title }}
                </p>
                <p class="internal-chat-notification-option-subtitle">
                  {{ option.subtitle }}
                </p>
              </div>
              <VSwitch
                v-model="draft[option.key]"
                color="primary"
                hide-details
                inset
                :disabled="childOptionsDisabled"
              />
            </div>
          </div>

          <div class="internal-chat-notification-section">
            <span class="internal-chat-notification-section-title">
              {{ t('internal_chat_notification_delivery') }}
            </span>

            <div
              v-for="option in deliveryOptions"
              :key="option.key"
              class="internal-chat-notification-option"
            >
              <div class="internal-chat-notification-option-icon">
                <VIcon size="20">{{ option.icon }}</VIcon>
              </div>
              <div class="internal-chat-notification-option-text">
                <p class="internal-chat-notification-option-title">
                  {{ option.title }}
                </p>
                <p class="internal-chat-notification-option-subtitle">
                  {{ option.subtitle }}
                </p>
              </div>
              <VSwitch
                v-model="draft[option.key]"
                color="primary"
                hide-details
                inset
                :disabled="childOptionsDisabled"
              />
            </div>
          </div>
        </template>
      </VCardText>

      <VDivider />

      <VCardActions class="justify-end pa-4">
        <VBtn
          color="secondary"
          variant="tonal"
          :disabled="saving"
          @click="closeDialog"
        >
          {{ t('cancel') }}
        </VBtn>
        <VBtn
          color="primary"
          variant="flat"
          :loading="saving"
          :disabled="loading"
          @click="saveSettings"
        >
          {{ t('save') }}
        </VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>

<style scoped lang="scss">
.internal-chat-notification-dialog {
  border-radius: 8px;
}

.internal-chat-notification-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.internal-chat-notification-loading {
  min-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.internal-chat-notification-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.internal-chat-notification-section-title {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
}

.internal-chat-notification-option {
  min-height: 68px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
}

.internal-chat-notification-option-icon {
  flex: 0 0 36px;
  inline-size: 36px;
  block-size: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
}

.internal-chat-notification-option-text {
  flex: 1 1 auto;
  min-width: 0;
}

.internal-chat-notification-option-title,
.internal-chat-notification-option-subtitle {
  margin: 0;
}

.internal-chat-notification-option-title {
  color: rgb(var(--v-theme-on-surface));
  font-weight: 700;
  line-height: 1.2;
}

.internal-chat-notification-option-subtitle {
  margin-top: 3px;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.82rem;
  line-height: 1.28;
}
</style>
