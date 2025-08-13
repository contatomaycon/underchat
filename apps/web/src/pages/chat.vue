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
import { getOffsetTop } from '@core/common/functions/getOffsetTop';
import { Picker, EmojiIndex } from 'emoji-mart-vue-fast/src';
import data from 'emoji-mart-vue-fast/data/all.json';
import 'emoji-mart-vue-fast/css/emoji-mart.css';

const emojiIndex = new EmojiIndex(data);

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
const composerRef = ref();

const fileDocRef = ref<HTMLInputElement | null>(null);
const filePhotoRef = ref<HTMLInputElement | null>(null);
const fileVideoRef = ref<HTMLInputElement | null>(null);
const fileAudioRef = ref<HTMLInputElement | null>(null);
const isEmojiOpen = ref(false);

const hasContent = computed(() => !!msg.value && msg.value.trim().length > 0);

const scrollToBottomInChatLog = () => {
  if (!chatLogPS.value) return;

  const scrollEl = chatLogPS.value.$el || chatLogPS.value;
  if (!scrollEl) return;

  scrollEl.scrollTop = scrollEl.scrollHeight;
};

const scrollToMessageById = async (id?: string) => {
  await nextTick();

  const container: HTMLElement = chatLogPS.value?.$el || chatLogPS.value;
  if (!container) return;

  if (!id) {
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    chatLogPS.value?.update?.();

    return;
  }

  const target =
    (container.querySelector(`[data-message-id="${id}"]`) as HTMLElement) ||
    (document.getElementById(`msg-${id}`) as HTMLElement);

  if (target) {
    const top = getOffsetTop(container, target) - 60;

    container.scrollTo({ top, behavior: 'auto' });

    requestAnimationFrame(() => {
      container.scrollTo({ top, behavior: 'smooth' });
      chatLogPS.value?.update?.();
    });

    return;
  }

  container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  chatLogPS.value?.update?.();
};

const highlightAndScrollToMessage = (id: string) => {
  if (!id || !chatLogPS.value) return;

  const container: HTMLElement = chatLogPS.value.$el || chatLogPS.value;
  const target =
    (container.querySelector(`[data-message-id="${id}"]`) as HTMLElement) ||
    (document.getElementById(`msg-${id}`) as HTMLElement);

  if (!target) return;

  const top = getOffsetTop(container, target) - 60;
  container.scrollTo({ top, behavior: 'auto' });

  requestAnimationFrame(() => container.scrollTo({ top, behavior: 'smooth' }));

  nextTick(() => (chatLogPS.value?.update ? chatLogPS.value.update() : null));

  target.classList.remove('message-target-flash');
  target.offsetWidth;
  target.classList.add('message-target-flash');
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

    if (chatStore.messageReply?.message_id) {
      inputCreateMessage.message_quoted_id = chatStore.messageReply.message_id;
      inputCreateMessage.type = EMessageType.text_quoted;
    }

    await chatStore.createMessage(inputCreateMessage);
  }

  msg.value = '';
  linkPreview.value = null;

  chatStore.clearMessageReply();

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

const openAttach = (
  type: 'document' | 'photo' | 'video' | 'audio' | 'contact'
) => {
  switch (type) {
    case 'document':
      fileDocRef.value?.click();
      break;
    case 'photo':
      filePhotoRef.value?.click();
      break;
    case 'video':
      fileVideoRef.value?.click();
      break;
    case 'audio':
      fileAudioRef.value?.click();
      break;
    case 'contact':
      window.dispatchEvent(new CustomEvent('open-contact-picker'));
      break;
  }
};

const onPickDoc = (e: Event) => {
  /* TODO: enviar documento */
};
const onPickPhoto = (e: Event) => {
  /* TODO: enviar foto */
};
const onPickVideo = (e: Event) => {
  /* TODO: enviar vídeo */
};
const onPickAudio = (e: Event) => {
  /* TODO: enviar áudio */
};

const onEmojiSelect = (e: any) => {
  const ch = e?.native || e?.skins?.[0]?.native || '';

  if (ch) {
    msg.value = (msg.value || '') + ch;
    nextTick(() => window.dispatchEvent(new CustomEvent('focus-composer')));
  }
};

const onRecordAudio = () => {
  window.dispatchEvent(new CustomEvent('start-recording-audio'));
};

const onSendText = () => sendMessage();

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

const focusComposer = () => {
  setTimeout(() => {
    const el = composerRef.value?.$el?.querySelector(
      'textarea'
    ) as HTMLTextAreaElement | null;
    el?.focus({ preventScroll: false });
  }, 120);
};

const onScrollToMessageEvt = (e: Event) => {
  const id = (e as CustomEvent<string>).detail;
  if (id) highlightAndScrollToMessage(id);
};

onMounted(async () => {
  if (chatStore.user?.account_id) {
    await onMessage(
      chatAccountCentrifugo(chatStore.user.account_id),
      (data: IChatMessage) => {
        if (chatStore.activeChat?.chat_id !== data.chat_id) {
          return;
        }

        chatStore.addMessageActiveChat(data);

        scrollToMessageById(data.message_id);
        window.dispatchEvent(new CustomEvent('focus-composer'));
      }
    );
    await onMessage(
      chatQueueAccountCentrifugo(chatStore.user.account_id),
      (data: IChat) => {
        chatStore.addChat(data);
      }
    );

    window.addEventListener('focus-composer', focusComposer);
    window.addEventListener(
      'scroll-to-message',
      onScrollToMessageEvt as EventListener
    );
  }
});

onUnmounted(async () => {
  if (chatStore.user?.account_id) {
    await unsubscribe(chatAccountCentrifugo(chatStore.user.account_id));
    await unsubscribe(chatQueueAccountCentrifugo(chatStore.user.account_id));
    window.removeEventListener('focus-composer', focusComposer);
    window.removeEventListener(
      'scroll-to-message',
      onScrollToMessageEvt as EventListener
    );
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
          <ReplyPreview v-if="chatStore.messageReply" />

          <VTextarea
            ref="composerRef"
            :key="contact_id"
            v-model="msg"
            variant="solo"
            density="comfortable"
            class="chat-message-input whats-composer"
            :placeholder="$t('write_your_message')"
            :auto-grow="true"
            rows="1"
            :max-rows="8"
            @keydown.enter.exact.prevent="onSendText"
          >
            <template #prepend-inner>
              <VMenu
                offset="8"
                :close-on-content-click="true"
                location="top start"
              >
                <template #activator="{ props }">
                  <IconBtn
                    v-bind="props"
                    class="composer-btn"
                    aria-label="Anexar"
                  >
                    <VIcon size="22">tabler-plus</VIcon>
                  </IconBtn>
                </template>

                <VList
                  density="comfortable"
                  min-width="220"
                  class="attach-menu"
                >
                  <VListItem @click="openAttach('document')">
                    <template #prepend
                      ><VIcon size="20">tabler-file</VIcon></template
                    >
                    <VListItemTitle>Documentos</VListItemTitle>
                  </VListItem>
                  <VListItem @click="openAttach('photo')">
                    <template #prepend
                      ><VIcon size="20">tabler-photo</VIcon></template
                    >
                    <VListItemTitle>Fotos</VListItemTitle>
                  </VListItem>
                  <VListItem @click="openAttach('video')">
                    <template #prepend
                      ><VIcon size="20">tabler-video</VIcon></template
                    >
                    <VListItemTitle>Vídeos</VListItemTitle>
                  </VListItem>
                  <VListItem @click="openAttach('audio')">
                    <template #prepend
                      ><VIcon size="20">tabler-headphones</VIcon></template
                    >
                    <VListItemTitle>Áudio</VListItemTitle>
                  </VListItem>
                  <VListItem @click="openAttach('contact')">
                    <template #prepend
                      ><VIcon size="20">tabler-user</VIcon></template
                    >
                    <VListItemTitle>Contato</VListItemTitle>
                  </VListItem>
                </VList>
              </VMenu>

              <VMenu
                v-model="isEmojiOpen"
                location="top start"
                :close-on-content-click="false"
                offset="8"
              >
                <template #activator="{ props }">
                  <IconBtn
                    v-bind="props"
                    class="composer-btn"
                    aria-label="Emoji"
                  >
                    <VIcon size="22">tabler-mood-smile</VIcon>
                  </IconBtn>
                </template>

                <div class="emoji-picker-wrap">
                  <Picker
                    :data="emojiIndex"
                    :per-line="8"
                    :show-preview="false"
                    :show-search="true"
                    :show-skin-tones="false"
                    @select="onEmojiSelect"
                  />
                </div>
              </VMenu>
            </template>

            <!-- DIREITA: ÁUDIO (default) OU ENVIAR (se tiver texto) -->
            <template #append-inner>
              <div class="d-flex align-center gap-1">
                <IconBtn
                  v-if="!hasContent"
                  class="composer-btn mic-btn"
                  aria-label="Gravar áudio"
                  @click="onRecordAudio"
                >
                  <VIcon size="22">tabler-microphone</VIcon>
                </IconBtn>

                <VBtn
                  v-else
                  class="send-btn"
                  icon
                  color="success"
                  variant="flat"
                  rounded="pill"
                  aria-label="Enviar mensagem"
                  @click="onSendText"
                >
                  <VIcon size="22">tabler-send</VIcon>
                </VBtn>
              </div>
            </template>
          </VTextarea>

          <input
            ref="fileDocRef"
            type="file"
            hidden
            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            @change="onPickDoc"
          />
          <input
            ref="filePhotoRef"
            type="file"
            hidden
            accept="image/*"
            @change="onPickPhoto"
          />
          <input
            ref="fileVideoRef"
            type="file"
            hidden
            accept="video/*"
            @change="onPickVideo"
          />
          <input
            ref="fileAudioRef"
            type="file"
            hidden
            accept="audio/*"
            @change="onPickAudio"
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
  padding-top: 0.8rem !important;
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

.message-target-flash {
  animation: messageTargetFlash 1.1s ease;
}
@keyframes messageTargetFlash {
  0% {
    background-color: rgba(var(--v-theme-primary), 0.16);
  }
  100% {
    background-color: transparent;
  }
}
</style>
