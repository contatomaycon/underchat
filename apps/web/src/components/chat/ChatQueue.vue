<script lang="ts" setup>
import { useChatStore } from '@/@webcore/stores/chat';
import { ListChatsResponse } from '@core/schema/chat/listChats/response.schema';
import { limitCharacters } from '@core/common/functions/limitCharacters';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';

const chatStore = useChatStore();

const props = defineProps<{
  user: ListChatsResponse;
}>();

const isChatContactActive = computed(() => {
  return chatStore.activeChat?.chat_id === props.user.chat_id;
});
</script>

<template>
  <li
    :key="chatStore.listQueue.length"
    class="chat-contact cursor-pointer d-flex align-center"
    :class="{ 'chat-contact-active': isChatContactActive }"
  >
    <VAvatar size="40" :variant="!props.user.photo ? 'tonal' : undefined">
      <VImg
        v-if="props.user.photo"
        :src="props.user.photo"
        :alt="props.user.name ?? ''"
      />
      <span v-else>{{ avatarText(props.user.name) }}</span>
    </VAvatar>
    <div class="flex-grow-1 ms-4 overflow-hidden">
      <p class="text-base text-high-emphasis mb-0">
        {{ limitCharacters(props.user.name, 20) }}
      </p>
      <p class="mb-0 text-truncate text-body-2">
        {{ formatPhoneBR(props.user.phone) }}
      </p>
      <p class="mb-0 text-truncate text-body-2 text-end">
        <i>{{ limitCharacters(props.user.summary.last_message, 35, '...') }}</i>
      </p>
    </div>
    <div
      v-if="props.user.summary.last_date"
      class="d-flex flex-column align-self-start"
    >
      <div class="text-body-2 text-disabled whitespace-no-wrap">
        {{ formatDateToMonthShort(props.user.summary.last_date, $t) }}
      </div>
      <VBadge
        v-if="props.user.summary.unread_count"
        color="error"
        inline
        :content="props.user.summary.unread_count"
        class="ms-auto"
      />
    </div>
  </li>
</template>

<style lang="scss">
@use '@webcore/scss/template/mixins' as templateMixins;
@use '@styles/variables/vuetify.scss';
@use '@webcore/scss/base/mixins';
@use 'vuetify/lib/styles/tools/states' as vuetifyStates;

.chat-contact {
  border-radius: vuetify.$border-radius-root;
  padding-block: 8px;
  padding-inline: 12px;

  @include mixins.before-pseudo;
  @include vuetifyStates.states($active: false);

  &.chat-contact-active {
    @include templateMixins.custom-elevation(var(--v-theme-primary), 'sm');

    background: rgb(var(--v-theme-primary));
    color: #fff;

    --v-theme-on-background: #fff;
  }

  .v-badge--bordered .v-badge__badge::after {
    color: #fff;
  }
}
</style>
