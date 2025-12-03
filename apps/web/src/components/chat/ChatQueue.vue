<script lang="ts" setup>
import { useChatStore } from '@/@webcore/stores/chat';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { ListChatsResult } from '@core/schema/chat/listChats/response.schema';
import { limitCharacters } from '@core/common/functions/limitCharacters';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import { formatDateToMonthShort } from '@/@webcore/utils/formatters';
import { useI18n } from 'vue-i18n';
import { useTheme } from 'vuetify';

const { t } = useI18n();
const { global } = useTheme();

const chatStore = useChatStore();
const channelsStore = useChannelsStore();

const props = defineProps<{
  user: ListChatsResult;
  disabled?: boolean;
}>();

const isChatContactActive = computed(() => {
  return chatStore.activeChat?.chat_id === props.user.chat_id;
});

const workerName = computed(() => props.user?.worker?.name ?? '');
const showWorkerNameLabel = ref(false);

const chatLabelForList = computed<{
  label: string;
  color: string;
} | null>(() => {
  const chatLabel = props.user.label as
    | { label?: string | null; color?: string | null }
    | null
    | undefined;

  if (chatLabel?.label && chatLabel.color) {
    return {
      label: chatLabel.label,
      color: chatLabel.color,
    };
  }

  const contactId = props.user.contact?.id;
  if (contactId) {
    const contact = chatStore.chatContacts[contactId];
    if (contact?.label_template) {
      return {
        label: contact.label_template.label,
        color: contact.label_template.color,
      };
    }
  }

  return null;
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

watch(
  () => props.user.contact?.id,
  (contactId) => {
    if (contactId) {
      void chatStore.getChatContactById(contactId);
    }
  },
  { immediate: true }
);

const loadWorkerConfig = async (workerId?: string | null) => {
  if (!workerId) {
    showWorkerNameLabel.value = false;
    return;
  }

  const config = await channelsStore.fetchWorkerConfigForChat(workerId);
  showWorkerNameLabel.value = Boolean(config?.show_worker_name);
};

onMounted(() => {
  void loadWorkerConfig(props.user?.worker?.id);
});

watch(
  () => props.user?.worker?.id,
  (newId) => {
    void loadWorkerConfig(newId);
  }
);
</script>

<template>
  <ul class="chat-list">
    <li
      :key="chatStore.listQueue.length"
      class="chat cursor-pointer d-flex align-center"
      :class="{
        'chat-active': isChatContactActive,
        'chat-disabled': props.disabled,
        'chat-has-label':
          (showWorkerNameLabel && workerName) || chatLabelForList,
        'chat-has-sector': sectorName,
      }"
      :aria-disabled="props.disabled ? 'true' : undefined"
    >
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
          }"
          :style="{
            backgroundColor: chatLabelForList.color,
          }"
          :title="chatLabelForList.label"
        >
          {{ chatLabelForList.label }}
        </div>
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
        <div class="d-flex align-center gap-1 mb-0">
          <p class="text-base text-high-emphasis mb-0 text-truncate">
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
          {{ limitCharacters(35, props.user.summary.last_message, '...') }}
        </p>
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
  border-radius: vuetify.$border-radius-root;
  padding-block: 8px;
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
</style>
