<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ChatNotificationSettingsData } from '@core/schema/chat/notificationSettings/response.schema';
import type { ChatNotificationSettingsRequest } from '@core/schema/chat/notificationSettings/request.schema';

const model = defineModel<boolean>({ default: false });

const props = withDefaults(
  defineProps<{
    settings: ChatNotificationSettingsData | null;
    loading?: boolean;
    saving?: boolean;
  }>(),
  {
    loading: false,
    saving: false,
  }
);

const emit = defineEmits<{
  (e: 'save', value: ChatNotificationSettingsRequest): void;
}>();

const { t } = useI18n();

type NotificationSettingKey = keyof Required<ChatNotificationSettingsRequest>;
type NotificationOption = {
  key: NotificationSettingKey;
  icon: string;
  title: string;
  subtitle: string;
};

const draft = reactive<Required<ChatNotificationSettingsRequest>>({
  notifications: true,
  notifications_sound: true,
  notifications_vibrate: false,
  notifications_toast: true,
  notifications_browser: true,
  notifications_push: true,
  notifications_message_queue: false,
  notifications_message_in_chat: true,
  notifications_message_chatbot: false,
  notifications_transfer: true,
});

const isDisabled = computed(() => props.loading || props.saving);
const childOptionsDisabled = computed(
  () => isDisabled.value || !draft.notifications
);

const messageOptions = computed<NotificationOption[]>(() => [
  {
    key: 'notifications_message_queue',
    icon: 'tabler-clock',
    title: t('chat_notification_message_queue'),
    subtitle: t('chat_notification_message_queue_description'),
  },
  {
    key: 'notifications_message_in_chat',
    icon: 'tabler-user-check',
    title: t('chat_notification_message_in_chat'),
    subtitle: t('chat_notification_message_in_chat_description'),
  },
  {
    key: 'notifications_message_chatbot',
    icon: 'tabler-message-chatbot',
    title: t('chat_notification_message_chatbot'),
    subtitle: t('chat_notification_message_chatbot_description'),
  },
]);

const movementOptions = computed<NotificationOption[]>(() => [
  {
    key: 'notifications_transfer',
    icon: 'tabler-transfer',
    title: t('chat_notification_transfer'),
    subtitle: t('chat_notification_transfer_description'),
  },
]);

const deliveryOptions = computed<NotificationOption[]>(() => [
  {
    key: 'notifications_sound',
    icon: 'tabler-volume',
    title: t('chat_notification_sound'),
    subtitle: t('chat_notification_sound_description'),
  },
  {
    key: 'notifications_toast',
    icon: 'tabler-layout-bottombar',
    title: t('chat_notification_toast'),
    subtitle: t('chat_notification_toast_description'),
  },
  {
    key: 'notifications_browser',
    icon: 'tabler-browser',
    title: t('chat_notification_browser'),
    subtitle: t('chat_notification_browser_description'),
  },
  {
    key: 'notifications_push',
    icon: 'tabler-device-mobile-message',
    title: t('chat_notification_push'),
    subtitle: t('chat_notification_push_description'),
  },
]);

function syncDraft() {
  const settings = props.settings;

  draft.notifications = settings?.notifications !== false;
  draft.notifications_sound = settings?.notifications_sound !== false;
  draft.notifications_vibrate = settings?.notifications_vibrate === true;
  draft.notifications_toast = settings?.notifications_toast !== false;
  draft.notifications_browser = settings?.notifications_browser !== false;
  draft.notifications_push = settings?.notifications_push !== false;
  draft.notifications_message_queue =
    settings?.notifications_message_queue === true;
  draft.notifications_message_in_chat =
    settings?.notifications_message_in_chat !== false;
  draft.notifications_message_chatbot =
    settings?.notifications_message_chatbot === true;
  draft.notifications_transfer = settings?.notifications_transfer !== false;
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
  <VDialog v-model="model" max-width="560">
    <DialogCloseBtn :disabled="saving" @click="closeDialog" />

    <VCard class="chat-notification-dialog">
      <VCardItem class="pb-2">
        <template #prepend>
          <VAvatar color="primary" variant="tonal" size="42">
            <VIcon size="22">tabler-bell</VIcon>
          </VAvatar>
        </template>

        <VCardTitle>{{ t('chat_notification_title') }}</VCardTitle>
        <VCardSubtitle>
          {{ t('chat_notification_description') }}
        </VCardSubtitle>
      </VCardItem>

      <VDivider />

      <VCardText class="chat-notification-body">
        <div v-if="loading" class="chat-notification-loading">
          <VProgressCircular indeterminate color="primary" size="28" />
        </div>

        <template v-else>
          <div class="chat-notification-option">
            <div class="chat-notification-option-icon">
              <VIcon size="20">tabler-bell-ringing</VIcon>
            </div>
            <div class="chat-notification-option-text">
              <p class="chat-notification-option-title">
                {{ t('chat_notification_master') }}
              </p>
              <p class="chat-notification-option-subtitle">
                {{ t('chat_notification_master_description') }}
              </p>
            </div>
            <VSwitch
              v-model="draft.notifications"
              color="primary"
              hide-details
              inset
              :disabled="isDisabled"
            />
          </div>

          <div class="chat-notification-section">
            <span class="chat-notification-section-title">
              {{ t('chat_notification_messages') }}
            </span>

            <div
              v-for="option in messageOptions"
              :key="option.key"
              class="chat-notification-option"
            >
              <div class="chat-notification-option-icon">
                <VIcon size="20">{{ option.icon }}</VIcon>
              </div>
              <div class="chat-notification-option-text">
                <p class="chat-notification-option-title">
                  {{ option.title }}
                </p>
                <p class="chat-notification-option-subtitle">
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

          <div class="chat-notification-section">
            <span class="chat-notification-section-title">
              {{ t('chat_notification_movements') }}
            </span>

            <div
              v-for="option in movementOptions"
              :key="option.key"
              class="chat-notification-option"
            >
              <div class="chat-notification-option-icon">
                <VIcon size="20">{{ option.icon }}</VIcon>
              </div>
              <div class="chat-notification-option-text">
                <p class="chat-notification-option-title">
                  {{ option.title }}
                </p>
                <p class="chat-notification-option-subtitle">
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

          <div class="chat-notification-section">
            <span class="chat-notification-section-title">
              {{ t('internal_chat_notification_delivery') }}
            </span>

            <div
              v-for="option in deliveryOptions"
              :key="option.key"
              class="chat-notification-option"
            >
              <div class="chat-notification-option-icon">
                <VIcon size="20">{{ option.icon }}</VIcon>
              </div>
              <div class="chat-notification-option-text">
                <p class="chat-notification-option-title">
                  {{ option.title }}
                </p>
                <p class="chat-notification-option-subtitle">
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
.chat-notification-dialog {
  border-radius: 8px;
}

.chat-notification-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.chat-notification-loading {
  min-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.chat-notification-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chat-notification-section-title {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
}

.chat-notification-option {
  min-height: 68px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
}

.chat-notification-option-icon {
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

.chat-notification-option-text {
  flex: 1 1 auto;
  min-width: 0;
}

.chat-notification-option-title,
.chat-notification-option-subtitle {
  margin: 0;
}

.chat-notification-option-title {
  color: rgb(var(--v-theme-on-surface));
  font-weight: 700;
  line-height: 1.2;
}

.chat-notification-option-subtitle {
  margin-top: 3px;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.82rem;
  line-height: 1.28;
}
</style>
