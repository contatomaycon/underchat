<script lang="ts" setup>
import { useChatStore } from '@/@webcore/stores/chat';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { ListChatsResult } from '@core/schema/chat/listChats/response.schema';
import { limitCharacters } from '@core/common/functions/limitCharacters';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import { formatDateToMonthShort } from '@/@webcore/utils/formatters';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

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
        'chat-has-label': showWorkerNameLabel && workerName,
      }"
      :aria-disabled="props.disabled ? 'true' : undefined"
    >
      <div
        v-if="showWorkerNameLabel && workerName"
        class="chat-worker-label text-caption"
      >
        {{ workerName }}
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
    margin-top: 1.125rem;
  }
}

.chat-worker-label {
  position: absolute;
  top: 0;
  left: 0;
  transform: translateY(-100%);
  padding: 2px 10px;
  border-radius: 0 vuetify.$border-radius-root 0 0;
  background-color: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
  max-width: 160px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
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
