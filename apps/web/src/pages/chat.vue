<script lang="ts" setup>
import { PerfectScrollbar } from 'vue3-perfect-scrollbar';
import { useDisplay, useTheme } from 'vuetify';
import { themes } from '@/plugins/vuetify/theme';
import ChatActiveChatUserProfileSidebarContent from '@/components/chat/ChatActiveChatUserProfileSidebarContent.vue';
import ChatLeftSidebarContent from '@/components/chat/ChatLeftSidebarContent.vue';
import ChatLog from '@/components/chat/ChatLog.vue';
import ChatUserProfileSidebarContent from '@/components/chat/ChatUserProfileSidebarContent.vue';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { ListChatsResponse } from '@core/schema/chat/listChats/response.schema';
import { useChatStore } from '@/@webcore/stores/chat';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import { ListMessageChatsQuery } from '@core/schema/chat/listMessageChats/request.schema';

definePage({
  meta: {
    layoutWrapperClasses: 'layout-content-height-fixed',
    permissions: [EGeneralPermissions.full_access],
  },
});

const chatStore = useChatStore();
const { name } = useTheme();
const vuetifyDisplays = useDisplay();

const contact_id = ref('contact-id');

const { isLeftSidebarOpen } = useResponsiveLeftSidebar(
  vuetifyDisplays.smAndDown
);

const from = ref(0);
const size = ref(100);
const chatLogPS = ref();
const q = ref('');
const msg = ref('');
const avatar = ref(false);
const isUserProfileSidebarOpen = ref(false);
const isActiveChatUserProfileSidebarOpen = ref(false);
const refInputEl = ref<HTMLElement>();

const scrollToBottomInChatLog = () => {
  if (!chatLogPS.value) return;

  const scrollEl = chatLogPS.value.$el || chatLogPS.value;

  if (!scrollEl) return;

  scrollEl.scrollTop = scrollEl.scrollHeight;
};

const startConversation = () => {
  if (vuetifyDisplays.mdAndUp.value) return;
  isLeftSidebarOpen.value = true;
};

const sendMessage = async () => {
  if (!msg.value) return;

  msg.value = '';

  nextTick(() => {
    scrollToBottomInChatLog();
  });
};

const openChat = async (chatId: ListChatsResponse['chat_id']) => {
  chatStore.setActiveChat(chatId);

  const requestQueue: ListMessageChatsQuery = {
    from: from.value,
    size: size.value,
  };

  await chatStore.getChatById(requestQueue);

  if (vuetifyDisplays.smAndDown.value) isLeftSidebarOpen.value = false;

  nextTick(() => {
    scrollToBottomInChatLog();
  });
};

const chatContentContainerBg = computed(() => {
  let color = 'transparent';

  if (themes) color = themes?.[name.value].colors?.background as string;

  return color;
});
</script>

<template>
  <VLayout class="chat-app-layout" style="z-index: 0">
    <!-- 👉 user profile sidebar -->
    <VNavigationDrawer
      v-model="isUserProfileSidebarOpen"
      data-allow-mismatch
      temporary
      touchless
      absolute
      class="user-profile-sidebar"
      location="start"
      width="370"
    >
      <ChatUserProfileSidebarContent
        @close="isUserProfileSidebarOpen = false"
      />
    </VNavigationDrawer>

    <!-- 👉 Active Chat sidebar -->
    <VNavigationDrawer
      v-model="isActiveChatUserProfileSidebarOpen"
      data-allow-mismatch
      width="374"
      absolute
      temporary
      location="end"
      touchless
      class="active-chat-user-profile-sidebar"
    >
      <ChatActiveChatUserProfileSidebarContent
        @close="isActiveChatUserProfileSidebarOpen = false"
      />
    </VNavigationDrawer>

    <!-- 👉 Left sidebar   -->
    <VNavigationDrawer
      v-model="isLeftSidebarOpen"
      data-allow-mismatch
      absolute
      touchless
      location="start"
      width="370"
      :temporary="$vuetify.display.smAndDown"
      class="chat-list-sidebar"
      :permanent="$vuetify.display.mdAndUp"
    >
      <ChatLeftSidebarContent
        v-model:is-drawer-open="isLeftSidebarOpen"
        v-model:search="q"
        @open-chat="openChat"
        @show-user-profile="isUserProfileSidebarOpen = true"
        @close="isLeftSidebarOpen = false"
      />
    </VNavigationDrawer>

    <VMain class="chat-content-container">
      <div v-if="chatStore.activeChat" class="d-flex flex-column h-100">
        <div
          class="active-chat-header d-flex align-center text-medium-emphasis bg-surface"
        >
          <IconBtn class="d-md-none me-3" @click="isLeftSidebarOpen = true">
            <VIcon icon="tabler-menu-2" />
          </IconBtn>

          <div
            class="d-flex align-center cursor-pointer"
            @click="isActiveChatUserProfileSidebarOpen = true"
          >
            <VAvatar
              size="40"
              :variant="!chatStore.activeChat.photo ? 'tonal' : undefined"
              class="cursor-pointer"
            >
              <VImg
                v-if="chatStore.activeChat.photo"
                :src="chatStore.activeChat.photo"
                :alt="chatStore.activeChat.name ?? ''"
              />
              <span v-else>{{ avatarText(chatStore.activeChat.name) }}</span>
            </VAvatar>

            <div class="flex-grow-1 ms-4 overflow-hidden">
              <div class="text-h6 mb-0 font-weight-regular">
                {{ chatStore.activeChat.name }}
              </div>
              <p class="text-truncate mb-0 text-body-2">
                {{ formatPhoneBR(chatStore.activeChat.phone) }}
              </p>
            </div>
          </div>

          <VSpacer />

          <div class="d-sm-flex align-center d-none text-medium-emphasis">
            <IconBtn>
              <VIcon icon="tabler-search" />
            </IconBtn>
            <IconBtn>
              <VIcon icon="tabler-dots-vertical" />
            </IconBtn>
          </div>
        </div>

        <VDivider />

        <PerfectScrollbar
          ref="chatLogPS"
          tag="ul"
          :options="{ wheelPropagation: false }"
          class="flex-grow-1"
        >
          <ChatLog />
        </PerfectScrollbar>

        <VForm
          class="chat-log-message-form mb-5 mx-5"
          @submit.prevent="sendMessage"
        >
          <VTextField
            :key="contact_id"
            v-model="msg"
            variant="solo"
            density="default"
            class="chat-message-input"
            :placeholder="$t('write_your_message')"
            autofocus
          >
            <template #append-inner>
              <div class="d-flex gap-1">
                <IconBtn>
                  <VIcon icon="tabler-microphone" size="22" />
                </IconBtn>
                <IconBtn @click="refInputEl?.click()">
                  <VIcon icon="tabler-paperclip" size="22" />
                </IconBtn>
                <div class="d-none d-md-block">
                  <VBtn append-icon="tabler-send" @click="sendMessage">
                    {{ $t('send') }}
                  </VBtn>
                </div>
                <IconBtn class="d-block d-md-none" @click="sendMessage">
                  <VIcon icon="tabler-send" />
                </IconBtn>
              </div>
            </template>
          </VTextField>

          <input
            ref="refInputEl"
            type="file"
            name="file"
            accept=".jpeg,.png,.jpg,GIF"
            hidden
          />
        </VForm>
      </div>

      <div v-else class="d-flex h-100 align-center justify-center flex-column">
        <VAvatar size="98" variant="tonal" color="primary" class="mb-4">
          <VIcon size="50" class="rounded-0" icon="tabler-message-2" />
        </VAvatar>
        <VBtn
          v-if="$vuetify.display.smAndDown"
          rounded="pill"
          @click="startConversation"
        >
          {{ $t('start_conversation') }}
        </VBtn>

        <p
          v-else
          style="max-inline-size: 40ch; text-wrap: balance"
          class="text-center text-disabled"
        >
          {{ $t('select_a_contact') }}
        </p>
      </div>
    </VMain>
  </VLayout>
</template>

<style lang="scss">
@use '@styles/variables/vuetify';
@use '@webcore/scss/base/mixins';
@use '@layouts/styles/mixins' as layoutsMixins;

// Variables
$chat-app-header-height: 76px;

// Placeholders
%chat-header {
  display: flex;
  align-items: center;
  min-block-size: $chat-app-header-height;
  padding-inline: 1.5rem;
}

.chat-start-conversation-btn {
  cursor: default;
}

.chat-app-layout {
  border-radius: vuetify.$card-border-radius;

  @include mixins.elevation(vuetify.$card-elevation);

  $sel-chat-app-layout: &;

  @at-root {
    .skin--bordered {
      @include mixins.bordered-skin($sel-chat-app-layout);
    }
  }

  .active-chat-user-profile-sidebar,
  .user-profile-sidebar {
    .v-navigation-drawer__content {
      display: flex;
      flex-direction: column;
    }
  }

  .chat-list-header,
  .active-chat-header {
    @extend %chat-header;
  }

  .chat-list-sidebar {
    .v-navigation-drawer__content {
      display: flex;
      flex-direction: column;
    }
  }
}

.chat-content-container {
  /* stylelint-disable-next-line value-keyword-case */
  background-color: v-bind(chatContentContainerBg);

  // Adjust the padding so text field height stays 48px
  .chat-message-input {
    .v-field__input {
      font-size: 0.9375rem !important;
      line-height: 1.375rem !important;
      padding-block: 0.6rem 0.5rem;
    }

    .v-field__append-inner {
      align-items: center;
      padding-block-start: 0;
    }

    .v-field--appended {
      padding-inline-end: 8px;
    }
  }
}

.chat-user-profile-badge {
  .v-badge__badge {
    /* stylelint-disable liberty/use-logical-spec */
    min-width: 12px !important;
    height: 0.75rem;
    /* stylelint-enable liberty/use-logical-spec */
  }
}
</style>
