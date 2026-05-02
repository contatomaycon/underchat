<script lang="ts" setup>
import { useChatStore } from '@/@webcore/stores/chat';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { ListChatsResult } from '@core/schema/chat/listChats/response.schema';
import { ViewWorkerConfigForChatResponse } from '@core/schema/chat/viewWorkerConfigForChat/response.schema';
import { limitCharacters } from '@core/common/functions/limitCharacters';
import { formatWhatsAppPreviewToHtml } from '@core/common/functions/whatsAppTextFormat';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import { formatDateToMonthShort } from '@/@webcore/utils/formatters';
import { useI18n } from 'vue-i18n';
import { useTheme } from 'vuetify';
import { EChatStatus } from '@core/common/enums/EChatStatus';

const { t } = useI18n();
const { global } = useTheme();

const chatStore = useChatStore();
const channelsStore = useChannelsStore();

const emit = defineEmits<{
  (e: 'checkbox-change', checked: boolean): void;
}>();

const props = withDefaults(
  defineProps<{
    user: ListChatsResult;
    disabled?: boolean;
    showChatbotTypeIndicator?: boolean;
    showCheckbox?: boolean;
    checked?: boolean;
    checkboxDisabled?: boolean;
  }>(),
  {
    showChatbotTypeIndicator: false,
    showCheckbox: false,
    checked: false,
    checkboxDisabled: false,
  }
);

const isChatContactActive = computed(() => {
  return chatStore.activeChat?.chat_id === props.user.chat_id;
});

const workerName = computed(() => props.user?.worker?.name ?? '');
const workerConfigForChat = ref<ViewWorkerConfigForChatResponse>(null);
const OPERATOR_REPLY_PENDING_ALERT_DEFAULT_TIME_MINUTES = 15;
const operatorReplyPendingNow = ref(Date.now());
let operatorReplyPendingTicker: ReturnType<typeof setInterval> | null = null;

const getAttendantFirstName = (fullName: string | null | undefined): string => {
  if (!fullName?.trim()) {
    return '';
  }

  const trimmed = fullName.trim();
  const parts = trimmed.split(/\s+/).filter((part) => part.length > 0);

  if (parts.length === 0) {
    return '';
  }

  if (parts.length === 1) {
    return parts[0];
  }

  const firstName = parts[0];
  if (firstName.trim()) {
    return firstName;
  }

  return parts[1] || '';
};

const attendantFirstName = computed(() => {
  return getAttendantFirstName(props.user?.user?.name);
});

const hasAttendant = computed(() => {
  return Boolean(props.user?.user?.name);
});

const attendantLabel = computed(() => {
  if (!attendantFirstName.value) {
    return '';
  }

  return limitCharacters(10, attendantFirstName.value);
});

const chatbotTypeLabel = computed(() => {
  if (!props.showChatbotTypeIndicator || !props.user?.status) return null;
  const s = props.user.status;
  if (s === EChatStatus.ura) return t('chatbot_type_input');
  if (s === EChatStatus.ura_output) return t('chatbot_type_output');
  if (s === EChatStatus.ura_schedule) return t('chatbot_type_schedule');
  if (s === EChatStatus.ura_webhook) return t('chatbot_type_webhook');
  return null;
});

const previewMessageHtml = computed(() => {
  return formatWhatsAppPreviewToHtml(props.user?.summary?.last_message, 35);
});

const chatLabels = computed(() => {
  if (!props.user.label) return [];
  if (Array.isArray(props.user.label)) {
    return props.user.label;
  }
  return [];
});

const isChatLabel = computed(() => {
  return chatLabels.value.length > 0;
});

const chatLabelForList = computed<{
  label: string;
  color: string;
} | null>(() => {
  if (chatLabels.value.length > 0) {
    const firstLabel = chatLabels.value[0];
    return {
      label: firstLabel.label,
      color: firstLabel.color,
    };
  }

  const contactId = props.user.contact?.id;
  if (contactId) {
    const contact = chatStore.chatContacts[contactId];
    if (contact?.label_templates && contact.label_templates.length > 0) {
      const firstLabel = contact.label_templates[0];
      return {
        label: firstLabel.label,
        color: firstLabel.color,
      };
    }
  }

  return null;
});

const remainingChatLabels = computed(() => {
  if (chatLabels.value.length <= 1) return [];
  return chatLabels.value.slice(1);
});

const remainingChatLabelsText = computed(() => {
  return remainingChatLabels.value.map((lt) => lt.label).join(', ');
});

const contactLabelTemplates = computed(() => {
  const contactId = props.user.contact?.id;
  if (!contactId) return [];
  const contact = chatStore.chatContacts[contactId];
  return contact?.label_templates ?? [];
});

const remainingLabels = computed(() => {
  if (contactLabelTemplates.value.length <= 1) return [];
  return contactLabelTemplates.value.slice(1);
});

const remainingLabelsText = computed(() => {
  return remainingLabels.value.map((lt) => lt.label).join(', ');
});

const sectorName = computed(() => {
  return props.user?.sector?.name ?? null;
});

const sectorColor = computed(() => {
  return props.user?.sector?.color ?? null;
});

const isHexColor = (s: string): boolean => {
  return /^#([0-9A-F]{6}|[0-9A-F]{3})$/i.test(s);
};

const isDarkMode = computed(() => global.name.value === 'dark');

const backgroundColor = (s: string | null): string => {
  if (!s) return 'rgba(var(--v-theme-secondary), 0.12)';
  if (!isHexColor(s)) return 'rgba(var(--v-theme-secondary), 0.12)';

  let hex = s.substring(1);
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }

  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);

  const opacity = isDarkMode.value ? 0.2 : 0.12;

  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
};

const textColor = (s: string | null): string => {
  if (!s) return 'rgb(var(--v-theme-secondary))';
  if (!isHexColor(s)) return 'rgb(var(--v-theme-secondary))';

  let hex = s.substring(1);
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }

  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);

  const opacity = isDarkMode.value ? 0.2 : 0.12;

  const backgroundR = isDarkMode.value ? 30 : 255;
  const backgroundG = isDarkMode.value ? 30 : 255;
  const backgroundB = isDarkMode.value ? 30 : 255;

  const finalR = Math.round(r * opacity + backgroundR * (1 - opacity));
  const finalG = Math.round(g * opacity + backgroundG * (1 - opacity));
  const finalB = Math.round(b * opacity + backgroundB * (1 - opacity));

  const yiq = (finalR * 299 + finalG * 587 + finalB * 114) / 1000;

  return yiq >= 128 ? '#4A4A4A' : '#FFFFFF';
};

const showWorkerNameLabel = computed(() => {
  return Boolean(workerConfigForChat.value?.show_worker_name);
});

const operatorReplyPendingSince = computed(() => {
  return props.user?.summary?.operator_reply_pending_since ?? null;
});

const operatorReplyPendingThresholdMinutes = computed(() => {
  const configured =
    workerConfigForChat.value?.operator_reply_pending_alert_time_minutes;
  if (!configured || configured < 1) {
    return OPERATOR_REPLY_PENDING_ALERT_DEFAULT_TIME_MINUTES;
  }
  return configured;
});

const operatorReplyPendingThresholdMs = computed(() => {
  return operatorReplyPendingThresholdMinutes.value * 60 * 1000;
});

const operatorReplyPendingElapsedMs = computed(() => {
  const pendingSince = operatorReplyPendingSince.value;
  if (!pendingSince) {
    return 0;
  }

  const pendingSinceMs = new Date(pendingSince).getTime();
  if (!Number.isFinite(pendingSinceMs)) {
    return 0;
  }

  return Math.max(operatorReplyPendingNow.value - pendingSinceMs, 0);
});

const isOperatorReplyPendingAlertTriggered = computed(() => {
  if (props.user?.status !== EChatStatus.in_chat) {
    return false;
  }

  if (!workerConfigForChat.value?.operator_reply_pending_alert_enabled) {
    return false;
  }

  if (!operatorReplyPendingSince.value) {
    return false;
  }

  return operatorReplyPendingElapsedMs.value >= operatorReplyPendingThresholdMs.value;
});

const operatorReplyPendingAlertLabel = computed(() => {
  return t('chat_operator_reply_pending_alert_chip');
});

const loadWorkerConfig = async (workerId?: string | null) => {
  if (!workerId) {
    workerConfigForChat.value = null;
    return;
  }

  const config = await channelsStore.fetchWorkerConfigForChat(workerId);
  workerConfigForChat.value = config;
};

onMounted(() => {
  operatorReplyPendingTicker = setInterval(() => {
    operatorReplyPendingNow.value = Date.now();
  }, 30000);
  void loadWorkerConfig(props.user?.worker?.id);
});

watch(
  () => props.user?.worker?.id,
  (newId) => {
    void loadWorkerConfig(newId);
  }
);

onBeforeUnmount(() => {
  if (operatorReplyPendingTicker) {
    clearInterval(operatorReplyPendingTicker);
    operatorReplyPendingTicker = null;
  }
});
</script>

<template>
  <ul class="chat-list">
    <li
      :key="chatStore.listQueue.length"
      class="chat cursor-pointer d-flex align-center"
      :class="{
        'chat-active': isChatContactActive,
        'chat-disabled': props.disabled,
        'chat-with-checkbox': props.showCheckbox,
        'chat-has-label':
          (showWorkerNameLabel && workerName) || chatLabelForList,
        'chat-has-sector': sectorName,
        'chat-has-attendant': attendantFirstName && hasAttendant,
        'chat-pending-reply-alert': isOperatorReplyPendingAlertTriggered,
      }"
      :aria-disabled="props.disabled ? 'true' : undefined"
    >
      <div v-if="props.showCheckbox" class="chat-checkbox-wrapper" @click.stop>
        <VCheckboxBtn
          :model-value="props.checked"
          :disabled="props.checkboxDisabled"
          density="compact"
          @update:model-value="emit('checkbox-change', Boolean($event))"
          @click.stop
        />
      </div>
      <div
        v-if="(showWorkerNameLabel && workerName) || chatLabelForList"
        class="chat-worker-label-wrapper"
      >
        <div
          v-if="showWorkerNameLabel && workerName"
          class="chat-worker-label text-caption"
          :class="{
            'chat-worker-label--with-tag': chatLabelForList,
            'chat-worker-label--standalone': !chatLabelForList,
          }"
        >
          {{ workerName }}
        </div>
        <div
          v-if="chatLabelForList"
          class="chat-label-tag text-caption"
          :class="{
            'chat-label-tag--standalone': !(showWorkerNameLabel && workerName),
            'chat-label-tag--with-worker': showWorkerNameLabel && workerName,
            'chat-label-tag--with-count':
              (isChatLabel && chatLabels.length > 1) ||
              (!isChatLabel &&
                contactLabelTemplates.length > 1 &&
                props.user.contact?.id),
          }"
          :style="{
            backgroundColor: chatLabelForList.color,
          }"
          :title="chatLabelForList.label"
        >
          {{ chatLabelForList.label }}
        </div>
        <span
          v-if="isChatLabel && chatLabels.length > 1"
          class="chat-label-count-wrapper"
        >
          <VTooltip
            v-if="remainingChatLabelsText"
            location="top"
            transition="scale-transition"
            activator="parent"
          >
            <span>{{ remainingChatLabelsText }}</span>
          </VTooltip>
          <VChip class="chat-label-count text-caption" size="x-small">
            +{{ chatLabels.length - 1 }}
          </VChip>
        </span>
        <span
          v-if="
            !isChatLabel &&
            contactLabelTemplates.length > 1 &&
            props.user.contact?.id
          "
          class="chat-label-count-wrapper"
        >
          <VTooltip
            v-if="remainingLabelsText"
            location="top"
            transition="scale-transition"
            activator="parent"
          >
            <span>{{ remainingLabelsText }}</span>
          </VTooltip>
          <VChip class="chat-label-count text-caption" size="x-small">
            +{{ contactLabelTemplates.length - 1 }}
          </VChip>
        </span>
      </div>
      <div
        v-if="sectorName"
        class="chat-sector-label text-caption"
        :style="{
          backgroundColor: backgroundColor(sectorColor),
          color: textColor(sectorColor),
        }"
      >
        {{ sectorName }}
      </div>
      <div
        v-if="attendantFirstName && hasAttendant"
        class="chat-attendant-label text-caption"
        :title="props.user?.user?.name ?? attendantFirstName"
      >
        {{ attendantLabel }}
      </div>
      <VAvatar
        size="40"
        :variant="
          !(props.user.contact?.photo ?? props.user.photo) ? 'tonal' : undefined
        "
      >
        <VImg
          v-if="props.user.contact?.photo ?? props.user.photo"
          :src="props.user.contact?.photo ?? props.user.photo ?? ''"
          :alt="props.user.contact?.name ?? props.user.name ?? ''"
        />
        <VImg
          v-else
          :src="'/images/svg/avatar-default.svg'"
          :alt="props.user.contact?.name ?? props.user.name ?? ''"
        />
      </VAvatar>
      <div class="flex-grow-1 ms-4 overflow-hidden min-w-0">
        <div class="chat-name-row d-flex align-center gap-1 mb-0">
          <p class="chat-name text-base text-high-emphasis mb-0 text-truncate">
            {{
              limitCharacters(20, props.user?.contact?.name ?? props.user?.name)
            }}
          </p>
          <VChip
            v-if="props.user?.contact?.name"
            size="x-small"
            variant="tonal"
            color="primary"
            class="contact-label"
          >
            {{ $t('contact_label') }}
          </VChip>
          <VChip
            v-if="isOperatorReplyPendingAlertTriggered"
            size="x-small"
            color="error"
            variant="flat"
            class="operator-reply-pending-chip"
          >
            {{ operatorReplyPendingAlertLabel }}
          </VChip>
        </div>
        <p class="mb-0 text-truncate text-body-2">
          {{
            props.user?.contact?.name && props.user?.contact?.phone
              ? props.user.contact.phone_ddi
                ? `+${props.user.contact.phone_ddi} ${props.user.contact.phone}`
                : props.user.contact.phone
              : formatPhoneBR(props.user?.phone)
          }}
        </p>
        <p
          v-if="
            props.user?.summary?.last_message &&
            props.user?.summary?.unread_count &&
            props.user.summary.unread_count > 0
          "
          class="mb-0 text-body-2 text-medium-emphasis chat-message-preview chat-message-preview--italic"
        >
          <span v-html="previewMessageHtml" />
        </p>
        <div
          v-if="showChatbotTypeIndicator && chatbotTypeLabel"
          class="chatbot-type-footer d-flex align-center gap-1 mt-1"
        >
          <span class="chatbot-type-footer__item">{{ chatbotTypeLabel }}</span>
        </div>
      </div>
      <div
        v-if="props.user?.summary?.last_date"
        class="d-flex flex-column align-self-start"
      >
        <div class="text-body-2 text-disabled whitespace-no-wrap">
          {{ formatDateToMonthShort(props.user.summary.last_date, t) }}
        </div>
        <VBadge
          v-if="
            props.user?.summary?.unread_count &&
            props.user.summary.unread_count > 0
          "
          color="error"
          :content="props.user.summary.unread_count"
          inline
          class="ms-auto mt-1"
        />
      </div>
    </li>
  </ul>
</template>

<style lang="scss">
@use '@webcore/scss/template/mixins' as templateMixins;
@use '@styles/variables/vuetify.scss';
@use '@webcore/scss/base/mixins';
@use 'vuetify/lib/styles/tools/states' as vuetifyStates;

.chat-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.chat {
  --chat-attendant-label-size: 28px;
  border-radius: vuetify.$border-radius-root;
  padding-block: 16px;
  padding-inline: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  position: relative;
  border-top-left-radius: 0;
  margin-bottom: 0;

  @include mixins.before-pseudo;
  @include vuetifyStates.states($active: false);

  &.chat-active {
    @include templateMixins.custom-elevation(var(--v-theme-primary), 'sm');
    background: rgb(var(--v-theme-primary));
    color: #fff;
    --v-theme-on-background: #fff;
  }

  .v-badge--bordered .v-badge__badge::after {
    color: #fff;
  }

  &.chat-disabled {
    cursor: not-allowed;
    opacity: 0.6;
    pointer-events: none;
  }

  &.chat-has-label {
    margin-top: 1.5rem;
  }

  &.chat-has-sector {
    margin-bottom: 1.5rem;
  }

  &.chat-has-attendant {
    padding-inline-end: calc(12px + var(--chat-attendant-label-size));
  }

  &.chat-with-checkbox {
    padding-inline-start: 44px;
  }

  &.chat-pending-reply-alert:not(.chat-active) {
    border-color: rgba(var(--v-theme-error), 0.55);
    box-shadow: inset 0 0 0 1px rgba(var(--v-theme-error), 0.2);
    background: linear-gradient(
      180deg,
      rgba(var(--v-theme-error), 0.05) 0%,
      rgba(var(--v-theme-surface), 1) 58%
    );
  }
}

.chat.chat-active.chat-pending-reply-alert {
  box-shadow: 0 0 0 2px rgba(var(--v-theme-error), 0.65);
}

.chat-checkbox-wrapper {
  position: absolute;
  left: 8px;
  top: 8px;
  z-index: 4;
}

.chat-sector-label {
  position: absolute;
  bottom: 0;
  left: 0;
  transform: translateY(100%);
  width: 100%;
  padding: 2px 10px;
  border-radius: 0 0 vuetify.$border-radius-root vuetify.$border-radius-root;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
  z-index: 3;
  text-align: center;
}

.chat-attendant-label {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  transform: none;
  width: var(--chat-attendant-label-size);
  padding-block: 6px;
  padding-inline: 4px;
  border-radius: 0 vuetify.$border-radius-root vuetify.$border-radius-root 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
  z-index: 2;
  color: rgb(var(--v-theme-on-surface));
  background-color: rgba(var(--v-theme-on-surface), 0.06);
  border-left: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  writing-mode: vertical-rl;
  text-orientation: mixed;
  display: flex;
  align-items: center;
  justify-content: center;
}

.chat.chat-active .chat-attendant-label {
  background-color: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}

.chat-worker-label-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  transform: translateY(-100%);
  display: inline-flex;
  max-width: 100%;
  z-index: 2;
}

.chat-worker-label {
  padding: 2px 10px;
  border-radius: 0 vuetify.$border-radius-root 0 0;
  background-color: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
  max-width: 160px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;

  &.chat-worker-label--with-tag {
    border-radius: vuetify.$border-radius-root 0 0 0;
  }

  &.chat-worker-label--standalone {
    border-radius: vuetify.$border-radius-root vuetify.$border-radius-root 0 0;
  }
}

.chat-label-tag {
  padding: 2px 10px;
  border-radius: 0 vuetify.$border-radius-root 0 0;
  color: #fff;
  max-width: 140px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;

  &.chat-label-tag--standalone {
    border-radius: vuetify.$border-radius-root vuetify.$border-radius-root 0 0;
  }

  &.chat-label-tag--with-worker {
    border-radius: 0 vuetify.$border-radius-root 0 0;
    border-top-left-radius: 0;
  }
}

.chat-message-preview {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;

  &--italic {
    font-style: italic;
  }
}

.contact-label {
  font-size: 0.625rem !important;
  height: 16px !important;
  opacity: 0.7;
  flex-shrink: 0;
}

.chat-name-row {
  min-width: 0;
}

.chat-name {
  flex: 1 1 auto;
  min-width: 0;
}

.operator-reply-pending-chip {
  letter-spacing: 0;
  font-weight: 700;
  flex-shrink: 0;
}

.chatbot-type-footer {
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  padding-top: 4px;
  min-height: 0;
}

.chatbot-type-footer__item {
  font-size: 0.625rem;
  line-height: 1;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.chat.chat-active .chatbot-type-footer {
  border-top-color: rgba(255, 255, 255, 0.2);
}

.chat.chat-active .chatbot-type-footer__item {
  color: rgba(255, 255, 255, 0.75);
}

.chat-label-count-wrapper {
  display: inline-flex;
  align-items: center;
  margin-left: 0;
}

.chat-label-tag--with-count {
  border-top-right-radius: 0 !important;
  border-bottom-right-radius: 0 !important;
}

.chat-label-count {
  height: 18px;
  min-width: auto;
  padding: 0 6px;
  font-size: 11px;
  background-color: rgba(var(--v-theme-on-surface), 0.12) !important;
  color: rgb(var(--v-theme-on-surface)) !important;
  border-top-left-radius: 0 !important;
  border-bottom-left-radius: 0 !important;
  margin-left: 0 !important;
}
</style>
