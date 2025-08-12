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
import { onMessage, unsubscribe } from '@/@webcore/centrifugo';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { CreateMessageChatsBody } from '@core/schema/chat/createMessageChats/request.schema';
import { EMessageType } from '@core/common/enums/EMessageType';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { IChat } from '@core/common/interfaces/IChat';
import { extractFirstUrl } from '@core/common/functions/extractFirstUrl';
import { ViewLinkPreviewResponse } from '@core/schema/chat/viewLinkPreview/response.schema';
import { refDebounced } from '@vueuse/core';

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
const isUserProfileSidebarOpen = ref(false);
const isActiveChatUserProfileSidebarOpen = ref(false);
const refInputEl = ref<HTMLElement>();
const linkPreview = ref<ViewLinkPreviewResponse | null>(null);

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

  if (chatStore.activeChat?.worker?.id) {
    const inputCreateMessage: CreateMessageChatsBody = {
      type: EMessageType.text,
      message: msg.value,
      link_preview: linkPreview.value?.title
        ? (linkPreview.value as ViewLinkPreviewResponse)
        : undefined,
    };

    await chatStore.createMessage(inputCreateMessage);
  }

  msg.value = '';
  linkPreview.value = null;

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

  if (vuetifyDisplays.smAndDown.value) {
    isLeftSidebarOpen.value = false;
  }

  nextTick(() => {
    scrollToBottomInChatLog();
  });
};

const chatContentContainerBg = computed(() => {
  let color = 'transparent';

  if (themes) {
    color = themes?.[name.value].colors?.background as string;
  }

  return color;
});

const previewDomain = computed(() => {
  const u =
    linkPreview.value?.['canonical-url'] ||
    linkPreview.value?.['matched-text'] ||
    '';

  if (!u) return '';

  try {
    return new URL(u).host;
  } catch {
    return u;
  }
});

const previewHref = computed(() => {
  return (
    linkPreview.value?.['canonical-url'] ||
    linkPreview.value?.['matched-text'] ||
    ''
  );
});

const previewImage = computed(() => {
  const p = linkPreview.value;
  if (!p) {
    return null;
  }

  const cand =
    p.highQualityThumbnail || p.originalThumbnailUrl || p.jpegThumbnail || '';

  if (!cand) return null;
  if (cand.startsWith('http')) return cand;

  return `data:image/jpeg;base64,${cand}`;
});

const debouncedMsg = refDebounced(msg, 500);
watch(
  debouncedMsg,
  async (val) => {
    const firstUrl = extractFirstUrl(val as string);
    if (firstUrl) {
      const linkPreviewResponse = await chatStore.generateLinkPreview({
        url: firstUrl,
      });

      if (linkPreviewResponse?.title !== 'Error') {
        linkPreview.value = linkPreviewResponse as ViewLinkPreviewResponse;
      }

      return;
    }

    linkPreview.value = null;
  },
  { immediate: true }
);

onMounted(async () => {
  if (chatStore.user?.account_id) {
    await onMessage(
      chatAccountCentrifugo(chatStore.user.account_id),
      (data: IChatMessage) => {
        if (chatStore.activeChat?.chat_id !== data.chat_id) return;
        chatStore.addMessageActiveChat(data);
      }
    );
    await onMessage(
      chatQueueAccountCentrifugo(chatStore.user.account_id),
      (data: IChat) => {
        chatStore.addChat(data);
      }
    );
  }
});

onUnmounted(async () => {
  if (chatStore.user?.account_id) {
    await unsubscribe(chatAccountCentrifugo(chatStore.user.account_id));
    await unsubscribe(chatQueueAccountCentrifugo(chatStore.user.account_id));
  }
});
</script>

<template>
  <VLayout class="chat-app-layout" style="z-index: 0">
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

        <Transition name="fade">
          <div v-if="linkPreview" class="mx-5 mt-3">
            <VCard class="link-preview-card">
              <VBtn
                class="link-preview-close"
                icon
                size="24"
                variant="text"
                @click="linkPreview = null"
              >
                <VIcon size="18" icon="tabler-x" />
              </VBtn>
              <div class="d-flex gap-3">
                <VAvatar size="56" :rounded="8" variant="tonal">
                  <VImg v-if="previewImage" :src="previewImage" />
                </VAvatar>
                <div class="flex-grow-1 overflow-hidden">
                  <div class="text-caption text-medium-emphasis">
                    {{ previewDomain }}
                  </div>
                  <div class="text-subtitle-1 font-weight-medium text-truncate">
                    {{ linkPreview?.title }}
                  </div>
                  <div
                    class="text-body-2 text-medium-emphasis two-line-ellipsis"
                  >
                    {{ linkPreview?.description }}
                  </div>
                  <div class="mt-2">
                    <a
                      v-if="previewHref"
                      :href="previewHref"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-primary text-body-2"
                    >
                      {{ previewHref }}
                    </a>
                  </div>
                </div>
              </div>
            </VCard>
          </div>
        </Transition>

        <VForm
          class="chat-log-message-form mb-5 mx-5"
          @submit.prevent="sendMessage"
        >
          <VTextarea
            :key="contact_id"
            v-model="msg"
            variant="solo"
            density="default"
            class="chat-message-input"
            :placeholder="$t('write_your_message')"
            :auto-grow="true"
            rows="1"
            :max-rows="8"
            autofocus
            @keydown.enter.exact.prevent="sendMessage"
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
          </VTextarea>

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

$chat-app-header-height: 76px;

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

.chat-message-input textarea {
  resize: none;
  overflow: hidden;
  line-height: 1.5rem;
  padding-top: 1rem !important;
  padding-bottom: 0.5rem !important;
}

.chat-content-container {
  background-color: v-bind(chatContentContainerBg);

  .chat-message-input {
    .v-field__input {
      font-size: 0.9375rem !important;
      line-height: 1.375rem !important;
      padding-block: 0.6rem 0.5rem;
      white-space: pre-wrap;
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
    min-width: 12px !important;
    height: 0.75rem;
  }
}

.link-preview-card {
  position: relative;
  padding: 14px;
  margin-bottom: 0.5rem;
}

.link-preview-close {
  position: absolute;
  top: 6px;
  right: 6px;
  min-width: 28px !important;
  width: 28px !important;
  height: 28px !important;
}

.two-line-ellipsis {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
